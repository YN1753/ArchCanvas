package repository

import (
	"context"
	"path/filepath"
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

	// 1. Initial insert with IsJunctionTable = nil
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

	// 2. Update IsJunctionTable to true
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

	// 3. Update IsJunctionTable to false
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
