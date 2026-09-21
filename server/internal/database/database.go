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

// InitSQLite 初始化并打开 SQLite 数据库，自动确保存储目录存在并执行所有数据表模型迁移。
func InitSQLite(cfg config.Database) (*gorm.DB, error) {
	if cfg.Path == "" {
		return nil, fmt.Errorf("database path is required")
	}

	// 自动确保目录存在
	if cfg.Path != ":memory:" && filepath.Dir(cfg.Path) != "." {
		if err := os.MkdirAll(filepath.Dir(cfg.Path), 0o755); err != nil {
			return nil, fmt.Errorf("create database directory for %q: %w", cfg.Path, err)
		}
	}

	// 打开 SQLite 数据库连接
	db, err := gorm.Open(sqlite.Open(cfg.Path), &gorm.Config{
		// 当前模型只通过 ID 建立逻辑关联，不生成数据库级强外键
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return nil, fmt.Errorf("open sqlite database %q: %w", cfg.Path, err)
	}

	// 执行表结构自动迁移
	if err := db.AutoMigrate(
		&model.Project{},
		&model.Entity{},
		&model.Attribute{},
		&model.Relation{},
		&model.AIContext{},
		&model.Conversation{},
		&model.Message{},
	); err != nil {
		return nil, fmt.Errorf("auto migrate database: %w", err)
	}

	return db, nil
}

// Initialize 为保持兼容的别名
var Initialize = InitSQLite
