package database

import (
	"fmt"
	"os"
	"path/filepath"

	"archcanvas/internal/config"
	"archcanvas/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Initialize 打开 SQLite 数据库并执行当前应用模型的自动迁移。
func Initialize(cfg config.Database) (*gorm.DB, error) {
	if cfg.Path == "" {
		return nil, fmt.Errorf("database path is required")
	}

	if err := ensureDatabaseDirectory(cfg.Path); err != nil {
		return nil, err
	}

	db, err := gorm.Open(sqlite.Open(cfg.Path), &gorm.Config{
		// 当前数据库模型只通过 ID 建立逻辑关联，不生成数据库级外键。
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return nil, fmt.Errorf("open sqlite database %q: %w", cfg.Path, err)
	}

	if err := autoMigrate(db); err != nil {
		return nil, err
	}

	return db, nil
}

func ensureDatabaseDirectory(path string) error {
	if path == ":memory:" || filepath.Dir(path) == "." {
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create database directory for %q: %w", path, err)
	}
	return nil
}

func autoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&model.Project{},
		&model.Entity{},
		&model.Attribute{},
		&model.Relation{},
		&model.AIContext{},
		&model.Conversation{},
		&model.Message{},
	); err != nil {
		return fmt.Errorf("auto migrate database: %w", err)
	}
	return nil
}
