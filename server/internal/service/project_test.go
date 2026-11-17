package service

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"archcanvas/internal/config"
	"archcanvas/internal/database"
	"archcanvas/internal/domain"
	"archcanvas/internal/model"
	"archcanvas/internal/repository"

	"gorm.io/gorm"
)

func setupFileBackedProjectService(t *testing.T) (*ProjectService, *gorm.DB) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "concurrent_service.db")
	db, err := database.InitSQLite(config.Database{Path: dbPath})
	if err != nil {
		t.Fatalf("InitSQLite failed: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})

	svc := NewProjectService(
		repository.NewProjectRepository(db),
		repository.NewERDesignRepository(db),
		repository.NewMessageRepository(db),
		nil,
	)
	return svc, db
}

func TestProjectService_ConcurrentFileBackedSQLiteSaves(t *testing.T) {
	svc, _ := setupFileBackedProjectService(t)
	ctx := context.Background()

	proj, err := svc.CreateProject(ctx, "高并发压测项目", "验证 _txlock=immediate 防 SQLITE_BUSY")
	if err != nil {
		t.Fatalf("CreateProject failed: %v", err)
	}

	const workers = 12
	var wg sync.WaitGroup
	errCh := make(chan error, workers*2)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			design := domain.ERDesign{
				Entities: []domain.Entity{
					{
						Name:    "orders",
						Comment: fmt.Sprintf("订单表_v%d", workerID),
						Attributes: []domain.Attribute{
							{Name: "id", DBType: "BIGINT", CodeType: "uint64", IsPrimaryKey: true},
							{Name: "order_no", DBType: "VARCHAR(64)", CodeType: "string", IsUnique: true},
							{Name: "amount", DBType: "DECIMAL(10,2)", CodeType: "float64"},
						},
					},
				},
				Relations: []domain.Relation{},
			}
			if _, err := svc.SaveERDesign(ctx, proj.ID, design); err != nil {
				errCh <- fmt.Errorf("worker %d SaveERDesign failed: %w", workerID, err)
				return
			}
			if _, err := svc.GetProject(ctx, proj.ID); err != nil {
				errCh <- fmt.Errorf("worker %d GetProject failed: %w", workerID, err)
			}
		}(i)
	}

	wg.Wait()
	close(errCh)

	for err := range errCh {
		t.Error(err)
	}

	detail, err := svc.GetProject(ctx, proj.ID)
	if err != nil {
		t.Fatalf("final GetProject failed: %v", err)
	}
	if detail.ERDesign == nil || len(detail.ERDesign.Entities) != 1 {
		t.Fatalf("expected 1 persisted entity, got %+v", detail.ERDesign)
	}
}

func TestProjectService_UpdatePreservesDescriptionAndReadOnlyMessages(t *testing.T) {
	svc, db := setupFileBackedProjectService(t)
	ctx := context.Background()

	proj, err := svc.CreateProject(ctx, "原始项目名", "不可丢失的详细架构说明")
	if err != nil {
		t.Fatalf("CreateProject failed: %v", err)
	}

	// 1. 重命名传 nil description 时必须完整保留既有描述
	renamed, err := svc.UpdateProject(ctx, proj.ID, "更新后项目名", nil)
	if err != nil {
		t.Fatalf("UpdateProject(nil desc) failed: %v", err)
	}
	if renamed.Description != "不可丢失的详细架构说明" {
		t.Fatalf("expected description preserved, got %q", renamed.Description)
	}

	// 2. 显式传入新描述时正常更新
	newDesc := "全新架构说明"
	updated, err := svc.UpdateProject(ctx, proj.ID, "更新后项目名", &newDesc)
	if err != nil {
		t.Fatalf("UpdateProject(non-nil desc) failed: %v", err)
	}
	if updated.Description != newDesc {
		t.Fatalf("expected updated description %q, got %q", newDesc, updated.Description)
	}

	// 3. 查询不存在项目的消息列表不得产生孤儿会话写入副作用
	msgs, err := svc.ListProjectMessageDTOs(ctx, "01960000-0000-7000-8000-nonexistent01")
	if err != nil {
		t.Fatalf("ListProjectMessageDTOs failed: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("expected 0 messages, got %d", len(msgs))
	}
	var convCount int64
	if err := db.Model(&model.Conversation{}).Count(&convCount).Error; err != nil {
		t.Fatalf("count conversations failed: %v", err)
	}
	if convCount != 0 {
		t.Fatalf("GET messages must not create orphan conversations, got count=%d", convCount)
	}

	// 4. 查询不存在项目必须精准返回 gorm.ErrRecordNotFound
	_, err = svc.GetProject(ctx, "01960000-0000-7000-8000-nonexistent02")
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected gorm.ErrRecordNotFound, got %v", err)
	}
}
