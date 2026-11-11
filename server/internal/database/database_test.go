package database

import (
	"context"
	"path/filepath"
	"strings"
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

	// 验证连接池中新建的独立连接也自动继承了 DSN 中的 PRAGMA busy_timeout 与 journal_mode
	ctx := context.Background()
	conn1, err := sqlDB.Conn(ctx)
	if err != nil {
		t.Fatalf("acquire conn1 failed: %v", err)
	}
	defer conn1.Close()

	conn2, err := sqlDB.Conn(ctx)
	if err != nil {
		t.Fatalf("acquire conn2 failed: %v", err)
	}
	defer conn2.Close()

	var timeout int
	if err := conn2.QueryRowContext(ctx, "PRAGMA busy_timeout;").Scan(&timeout); err != nil {
		t.Fatalf("query busy_timeout on conn2 failed: %v", err)
	}
	if timeout != 5000 {
		t.Errorf("expected busy_timeout=5000 on pooled conn2, got %d", timeout)
	}

	var journalMode string
	if err := conn2.QueryRowContext(ctx, "PRAGMA journal_mode;").Scan(&journalMode); err != nil {
		t.Fatalf("query journal_mode on conn2 failed: %v", err)
	}
	if !strings.EqualFold(journalMode, "wal") {
		t.Errorf("expected journal_mode=wal on pooled conn2, got %q", journalMode)
	}
}
