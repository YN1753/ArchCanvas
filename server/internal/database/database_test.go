package database

import (
	"path/filepath"
	"testing"

	"archcanvas/internal/config"
)

func TestInitSQLite(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	cfg := config.Database{
		Path: dbPath,
	}

	db, err := InitSQLite(cfg)
	if err != nil {
		t.Fatalf("InitSQLite failed: %v", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("failed to get sql.DB: %v", err)
	}
	defer sqlDB.Close()

	if err := sqlDB.Ping(); err != nil {
		t.Fatalf("ping sqlite failed: %v", err)
	}

	// 检查 attributes 表是否存在单列索引 idx_attributes_entity_id
	var count int64
	err = db.Raw("SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_attributes_entity_id'").Scan(&count).Error
	if err != nil {
		t.Fatalf("query sqlite_master failed: %v", err)
	}
	if count == 0 {
		t.Error("expected index idx_attributes_entity_id created on attributes table, got 0")
	}
}
