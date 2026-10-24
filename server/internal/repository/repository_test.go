package repository

import (
	"context"
	"testing"

	"archcanvas/internal/config"
	"archcanvas/internal/database"
	"archcanvas/internal/domain"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := database.InitSQLite(config.Database{
		Path: ":memory:",
	})
	if err != nil {
		t.Fatalf("failed to initialize test database: %v", err)
	}
	return db
}

func TestProjectRepository_CRUDAndCascade(t *testing.T) {
	db := setupTestDB(t)
	repo := NewProjectRepository(db)
	ctx := context.Background()

	// 1. Create
	p, err := repo.Create(ctx, "测试电商架构", "电商多租户系统设计")
	if err != nil {
		t.Fatalf("Create project failed: %v", err)
	}
	if p.ID == "" || p.Name != "测试电商架构" {
		t.Fatalf("unexpected project created: %+v", p)
	}

	// 2. GetByID
	fetched, err := repo.GetByID(ctx, p.ID)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}
	if fetched.Name != p.Name || fetched.Description != p.Description {
		t.Fatalf("fetched project mismatch: got %+v, want %+v", fetched, p)
	}

	// 3. Update
	updated, err := repo.Update(ctx, p.ID, "测试电商架构v2", "重构描述")
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if updated.Name != "测试电商架构v2" || updated.Description != "重构描述" {
		t.Fatalf("updated mismatch: %+v", updated)
	}

	// 4. SaveConceptualDesign
	err = repo.SaveConceptualDesign(ctx, p.ID, `{"nodes":[{"id":"c1","name":"User"}]}`)
	if err != nil {
		t.Fatalf("SaveConceptualDesign failed: %v", err)
	}
	refetched, _ := repo.GetByID(ctx, p.ID)
	if refetched.ConceptualDesign != `{"nodes":[{"id":"c1","name":"User"}]}` {
		t.Fatalf("conceptual design mismatch: %s", refetched.ConceptualDesign)
	}

	// 5. List
	list, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 project in list, got %d", len(list))
	}

	// 6. Delete
	err = repo.Delete(ctx, p.ID)
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	_, err = repo.GetByID(ctx, p.ID)
	if err == nil {
		t.Fatalf("expected error after delete, got nil")
	}
}

func TestERDesignRepository_SaveAndGet(t *testing.T) {
	db := setupTestDB(t)
	projectRepo := NewProjectRepository(db)
	erRepo := NewERDesignRepository(db)
	ctx := context.Background()

	p, err := projectRepo.Create(ctx, "ER建模测试", "测试物理表存储")
	if err != nil {
		t.Fatalf("create project failed: %v", err)
	}

	posX := 120.5
	posY := 240.0
	isJunction := false

	entities := []domain.Entity{
		{
			ID:      "ent_user",
			Name:    "users",
			Comment: "系统核心用户表",
			Position: &domain.Position{
				X: posX,
				Y: posY,
			},
			Attributes: []domain.Attribute{
				{
					ID:           "attr_1",
					Name:         "id",
					Comment:      "主键",
					DBType:       "BIGINT",
					CodeType:     "int64",
					IsPrimaryKey: true,
				},
				{
					ID:           "attr_2",
					Name:         "username",
					Comment:      "账号",
					DBType:       "VARCHAR(64)",
					CodeType:     "string",
					IsUnique:     true,
				},
			},
			Indexes: []domain.IndexDefinition{
				{
					Name:     "idx_users_username",
					Columns:  []string{"username"},
					IsUnique: true,
				},
			},
			IsJunctionTable: &isJunction,
		},
		{
			ID:      "ent_order",
			Name:    "orders",
			Comment: "订单记录表",
			Attributes: []domain.Attribute{
				{
					ID:           "attr_3",
					Name:         "id",
					DBType:       "BIGINT",
					CodeType:     "int64",
					IsPrimaryKey: true,
				},
				{
					ID:       "attr_4",
					Name:     "user_id",
					DBType:   "BIGINT",
					CodeType: "int64",
				},
			},
		},
	}

	relations := []domain.Relation{
		{
			ID:             "rel_user_orders",
			SourceEntityID: "ent_user",
			TargetEntityID: "ent_order",
			RelationTypeID: "one_to_many",
		},
	}

	// 1. 保存实体与关系
	savedDesign, err := erRepo.SaveByProjectID(ctx, p.ID, entities, relations)
	if err != nil {
		t.Fatalf("SaveByProjectID failed: %v", err)
	}
	if len(savedDesign.Entities) != 2 || len(savedDesign.Relations) != 1 {
		t.Fatalf("saved design count mismatch: %+v", savedDesign)
	}

	// 2. 查询并验证完整性
	fetchedDesign, err := erRepo.GetByProjectID(ctx, p.ID)
	if err != nil {
		t.Fatalf("GetByProjectID failed: %v", err)
	}
	if len(fetchedDesign.Entities) != 2 {
		t.Fatalf("expected 2 entities, got %d", len(fetchedDesign.Entities))
	}
	if len(fetchedDesign.Relations) != 1 {
		t.Fatalf("expected 1 relation, got %d", len(fetchedDesign.Relations))
	}

	// 校验属性与索引解析
	var userEnt *domain.Entity
	for i := range fetchedDesign.Entities {
		if fetchedDesign.Entities[i].Name == "users" {
			userEnt = &fetchedDesign.Entities[i]
			break
		}
	}
	if userEnt == nil {
		t.Fatalf("missing users entity in fetched design")
	}
	if len(userEnt.Attributes) != 2 {
		t.Fatalf("expected 2 attributes on users, got %d", len(userEnt.Attributes))
	}
	if len(userEnt.Indexes) != 1 || userEnt.Indexes[0].Name != "idx_users_username" {
		t.Fatalf("user index not preserved: %+v", userEnt.Indexes)
	}
	if userEnt.Position == nil || userEnt.Position.X != posX {
		t.Fatalf("user position mismatch: %+v", userEnt.Position)
	}

	// 3. 边界检验：空 projectID
	_, err = erRepo.GetByProjectID(ctx, "")
	if err != ErrProjectIDRequired {
		t.Fatalf("expected ErrProjectIDRequired, got: %v", err)
	}
	_, err = erRepo.SaveByProjectID(ctx, "", entities, relations)
	if err != ErrProjectIDRequired {
		t.Fatalf("expected ErrProjectIDRequired on save, got: %v", err)
	}
}

func TestMessageRepository_ConversationAndMessages(t *testing.T) {
	db := setupTestDB(t)
	projectRepo := NewProjectRepository(db)
	msgRepo := NewMessageRepository(db)
	ctx := context.Background()

	p, err := projectRepo.Create(ctx, "消息测试项目", "")
	if err != nil {
		t.Fatalf("create project failed: %v", err)
	}

	// 1. 获取或创建会话 (幂等性测试)
	conv1, err := msgRepo.GetOrCreateConversation(ctx, p.ID)
	if err != nil {
		t.Fatalf("GetOrCreateConversation failed: %v", err)
	}
	conv2, err := msgRepo.GetOrCreateConversation(ctx, p.ID)
	if err != nil {
		t.Fatalf("GetOrCreateConversation (2) failed: %v", err)
	}
	if conv1.ID != conv2.ID {
		t.Fatalf("conversation should be idempotent: %s != %s", conv1.ID, conv2.ID)
	}

	// 2. 插入消息
	m1, err := msgRepo.CreateMessage(ctx, conv1.ID, "user", "帮我设计一个用户表")
	if err != nil {
		t.Fatalf("CreateMessage 1 failed: %v", err)
	}
	m2, err := msgRepo.CreateMessage(ctx, conv1.ID, "assistant", "好的，已为您推导出 users 表。")
	if err != nil {
		t.Fatalf("CreateMessage 2 failed: %v", err)
	}

	// 3. 查询消息时序
	list, err := msgRepo.ListMessagesByProject(ctx, p.ID)
	if err != nil {
		t.Fatalf("ListMessagesByProject failed: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(list))
	}
	if list[0].ID != m1.ID || list[1].ID != m2.ID {
		t.Fatalf("message order mismatch: %+v", list)
	}

	// 4. 清空消息
	err = msgRepo.ClearMessagesByProject(ctx, p.ID)
	if err != nil {
		t.Fatalf("ClearMessagesByProject failed: %v", err)
	}
	clearedList, err := msgRepo.ListMessagesByProject(ctx, p.ID)
	if err != nil {
		t.Fatalf("ListMessagesByProject after clear failed: %v", err)
	}
	if len(clearedList) != 0 {
		t.Fatalf("expected 0 messages after clear, got %d", len(clearedList))
	}
}

func TestRepositories_NilSafety(t *testing.T) {
	ctx := context.Background()

	var pRepo *ProjectRepository
	if _, err := pRepo.List(ctx); err == nil {
		t.Errorf("expected error on nil ProjectRepository.List")
	}
	if _, err := pRepo.GetByID(ctx, "id"); err == nil {
		t.Errorf("expected error on nil ProjectRepository.GetByID")
	}
	if _, err := pRepo.Create(ctx, "a", "b"); err == nil {
		t.Errorf("expected error on nil ProjectRepository.Create")
	}
	if err := pRepo.Delete(ctx, "id"); err == nil {
		t.Errorf("expected error on nil ProjectRepository.Delete")
	}
	if _, err := pRepo.Update(ctx, "id", "a", "b"); err == nil {
		t.Errorf("expected error on nil ProjectRepository.Update")
	}
	if err := pRepo.SaveConceptualDesign(ctx, "id", "{}"); err == nil {
		t.Errorf("expected error on nil ProjectRepository.SaveConceptualDesign")
	}

	var erRepo *ERDesignRepository
	if _, err := erRepo.GetByProjectID(ctx, "id"); err == nil {
		t.Errorf("expected error on nil ERDesignRepository.GetByProjectID")
	}
	if _, err := erRepo.SaveByProjectID(ctx, "id", nil, nil); err == nil {
		t.Errorf("expected error on nil ERDesignRepository.SaveByProjectID")
	}

	var mRepo *MessageRepository
	if _, err := mRepo.GetOrCreateConversation(ctx, "id"); err == nil {
		t.Errorf("expected error on nil MessageRepository.GetOrCreateConversation")
	}
	if _, err := mRepo.CreateMessage(ctx, "id", "role", "text"); err == nil {
		t.Errorf("expected error on nil MessageRepository.CreateMessage")
	}
	if _, err := mRepo.ListMessagesByProject(ctx, "id"); err == nil {
		t.Errorf("expected error on nil MessageRepository.ListMessagesByProject")
	}
	if err := mRepo.ClearMessagesByProject(ctx, "id"); err == nil {
		t.Errorf("expected error on nil MessageRepository.ClearMessagesByProject")
	}
}
