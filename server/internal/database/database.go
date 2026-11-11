package database

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

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

	rawPath := cfg.Path
	if idx := strings.IndexByte(rawPath, '?'); idx >= 0 {
		rawPath = rawPath[:idx]
	}
	isMemory := rawPath == ":memory:" || strings.HasPrefix(rawPath, "file::memory:")

	// 自动确保目录存在
	if !isMemory && filepath.Dir(rawPath) != "." {
		if err := os.MkdirAll(filepath.Dir(rawPath), 0o755); err != nil {
			return nil, fmt.Errorf("create database directory for %q: %w", cfg.Path, err)
		}
	}

	// 将 WAL、busy_timeout 与 synchronous 注入 DSN，确保连接池中每个新建连接均自动继承 PRAGMA 配置
	dsn := cfg.Path
	if !isMemory {
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		dsn = dsn + sep + "_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL"
	}

	// 打开 SQLite 数据库连接
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
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

	// 调优底层连接池参数，兼顾本地多协程读写吞吐并防范文件句柄溢出
	if sqlDB, err := db.DB(); err == nil {
		if isMemory {
			sqlDB.SetMaxOpenConns(1)
			sqlDB.SetMaxIdleConns(1)
		} else {
			sqlDB.SetMaxOpenConns(50)
			sqlDB.SetMaxIdleConns(10)
		}
	}

	return db, nil
}

// Initialize 为保持兼容的别名
var Initialize = InitSQLite
