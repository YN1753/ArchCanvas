package repository

import (
	"context"
	"path/filepath"
	"sync"
	"testing"

	"archcanvas/internal/config"
	"archcanvas/internal/database"
	"archcanvas/internal/domain"
	"archcanvas/internal/model"
)

func TestSaveByProjectID_UpdatesIsJunctionTable(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := database.InitSQLite(config.Database{Path: dbPath})
	if err != nil {
		t.Fatalf("init db: %v", err)
	}
	repo := NewERDesignRepository(db)

	ctx := context.Background()
	projectID := "01900000-0000-7000-8000-000000000001"
	if err := db.Create(&model.Project{ID: projectID, Name: "Test"}).Error; err != nil {
		t.Fatalf("create project: %v", err)
	}

	entID := "01900000-0000-7000-8000-000000000002"
	attrID := "01900000-0000-7000-8000-000000000003"

	initial := []domain.Entity{
		{
			ID:              entID,
			Name:            "user_roles",
			IsJunctionTable: nil,
			Attributes: []domain.Attribute{
				{ID: attrID, Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
			},
		},
	}
	if _, err := repo.SaveByProjectID(ctx, projectID, initial, nil); err != nil {
		t.Fatalf("initial save: %v", err)
	}

	tVal := true
	initial[0].IsJunctionTable = &tVal
	if _, err := repo.SaveByProjectID(ctx, projectID, initial, nil); err != nil {
		t.Fatalf("update to true: %v", err)
	}

	design, err := repo.GetByProjectID(ctx, projectID)
	if err != nil {
		t.Fatalf("get after true: %v", err)
	}
	if len(design.Entities) != 1 || design.Entities[0].IsJunctionTable == nil || !*design.Entities[0].IsJunctionTable {
		t.Fatalf("expected IsJunctionTable=true, got %+v", design.Entities[0].IsJunctionTable)
	}

	fVal := false
	initial[0].IsJunctionTable = &fVal
	if _, err := repo.SaveByProjectID(ctx, projectID, initial, nil); err != nil {
		t.Fatalf("update to false: %v", err)
	}

	design, err = repo.GetByProjectID(ctx, projectID)
	if err != nil {
		t.Fatalf("get after false: %v", err)
	}
	if len(design.Entities) != 1 || design.Entities[0].IsJunctionTable == nil || *design.Entities[0].IsJunctionTable {
		t.Fatalf("expected IsJunctionTable=false, got %+v", design.Entities[0].IsJunctionTable)
	}
}

func TestSaveByProjectID_CrossProjectUUIDImportAndTwoPassRename(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "cross_proj.db")
	db, err := database.InitSQLite(config.Database{Path: dbPath})
	if err != nil {
		t.Fatalf("init db: %v", err)
	}
	projRepo := NewProjectRepository(db)
	erRepo := NewERDesignRepository(db)
	ctx := context.Background()

	pA, err := projRepo.CreateWithVisitor(ctx, "Project A", "", "")
	if err != nil {
		t.Fatalf("create pA: %v", err)
	}
	pB, err := projRepo.CreateWithVisitor(ctx, "Project B", "", "")
	if err != nil {
		t.Fatalf("create pB: %v", err)
	}

	// 1. 在项目 A 中保存带确定 UUID 的两张表与关联及字段顺序
	savedA, err := erRepo.SaveByProjectID(ctx, pA.ID, []domain.Entity{
		{
			ID:   "01900000-0000-7000-8000-000000000101",
			Name: "users",
			Attributes: []domain.Attribute{
				{ID: "01900000-0000-7000-8000-000000000201", Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
				{ID: "01900000-0000-7000-8000-000000000202", Name: "email", DBType: "VARCHAR(128)"},
				{ID: "01900000-0000-7000-8000-000000000203", Name: "nickname", DBType: "VARCHAR(64)"},
			},
		},
		{
			ID:   "01900000-0000-7000-8000-000000000102",
			Name: "orders",
			Attributes: []domain.Attribute{
				{ID: "01900000-0000-7000-8000-000000000204", Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
				{ID: "01900000-0000-7000-8000-000000000205", Name: "user_id", DBType: "BIGINT"},
			},
		},
	}, []domain.Relation{
		{
			ID:             "01900000-0000-7000-8000-000000000301",
			SourceEntityID: "01900000-0000-7000-8000-000000000101",
			TargetEntityID: "01900000-0000-7000-8000-000000000102",
			Cardinality:    "one_to_many",
		},
	})
	if err != nil {
		t.Fatalf("save pA: %v", err)
	}

	// 2. 将项目 A 导出的完整 JSON（含相同 UUID）原封不动导入项目 B，验证不发生全局主键冲突且关系自动重映射
	savedB, err := erRepo.SaveByProjectID(ctx, pB.ID, savedA.Entities, savedA.Relations)
	if err != nil {
		t.Fatalf("cross-project import into pB failed: %v", err)
	}
	if len(savedB.Entities) != 2 || len(savedB.Relations) != 1 {
		t.Fatalf("expected 2 entities and 1 relation in pB, got %+v", savedB)
	}
	if savedB.Entities[0].ID == savedA.Entities[0].ID {
		t.Fatalf("expected fresh entity UUID minted for pB to avoid collision with pA")
	}

	// 3. 验证字段上下移动顺序 (sort_order) 持久化保真
	attrs := savedA.Entities[0].Attributes
	savedA.Entities[0].Attributes = []domain.Attribute{attrs[0], attrs[2], attrs[1]} // id, nickname, email
	reorderedA, err := erRepo.SaveByProjectID(ctx, pA.ID, savedA.Entities, savedA.Relations)
	if err != nil {
		t.Fatalf("save reordered attributes: %v", err)
	}
	var usersEnt domain.Entity
	for _, e := range reorderedA.Entities {
		if e.Name == "users" {
			usersEnt = e
		}
	}
	if usersEnt.Attributes[1].Name != "nickname" || usersEnt.Attributes[2].Name != "email" {
		t.Fatalf("attribute sort_order not preserved: got [%s, %s, %s]",
			usersEnt.Attributes[0].Name, usersEnt.Attributes[1].Name, usersEnt.Attributes[2].Name)
	}

	// 4. 验证两阶段改名防劫持：将原有 users(ID=101) 改名为 accounts，并在同一批次新建一张 users 表
	renamedEntities := []domain.Entity{
		{
			ID:         "01900000-0000-7000-8000-000000000101",
			Name:       "accounts",
			Attributes: usersEnt.Attributes,
		},
		{
			ID:   "_local_new_users",
			Name: "users",
			Attributes: []domain.Attribute{
				{ID: "_local_attr_1", Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
			},
		},
	}
	afterRename, err := erRepo.SaveByProjectID(ctx, pA.ID, renamedEntities, nil)
	if err != nil {
		t.Fatalf("two-pass rename + recreate failed: %v", err)
	}
	if len(afterRename.Entities) != 2 {
		t.Fatalf("expected both accounts and new users to exist, got %d entities", len(afterRename.Entities))
	}
	var foundAccounts *domain.Entity
	for i := range afterRename.Entities {
		if afterRename.Entities[i].Name == "accounts" {
			foundAccounts = &afterRename.Entities[i]
		}
	}
	if foundAccounts == nil || foundAccounts.ID != "01900000-0000-7000-8000-000000000101" || len(foundAccounts.Attributes) != 3 {
		t.Fatalf("accounts entity or its 3 attributes were corrupted/hijacked: %+v", foundAccounts)
	}
}

func TestSaveByProjectID_ConcurrentSQLiteWriters(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "concurrent_wal.db")
	db, err := database.InitSQLite(config.Database{Path: dbPath})
	if err != nil {
		t.Fatalf("init db: %v", err)
	}
	projRepo := NewProjectRepository(db)
	erRepo := NewERDesignRepository(db)
	ctx := context.Background()

	p, err := projRepo.CreateWithVisitor(ctx, "Concurrent Test", "", "")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	// 验证开启 _txlock=immediate 后多协程并发先读后写事务排队等待 busy_timeout 而非瞬时报 SQLITE_BUSY
	const writers = 8
	var wg sync.WaitGroup
	errCh := make(chan error, writers)
	wg.Add(writers)
	for i := 0; i < writers; i++ {
		go func(idx int) {
			defer wg.Done()
			_, err := erRepo.SaveByProjectID(ctx, p.ID, []domain.Entity{
				{
					Name: "items",
					Attributes: []domain.Attribute{
						{Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
					},
				},
			}, nil)
			if err != nil {
				errCh <- err
			}
		}(i)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("concurrent SaveByProjectID failed with SQLITE_BUSY or error: %v", err)
	}
}
