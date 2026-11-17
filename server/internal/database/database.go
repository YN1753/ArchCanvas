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
	if strings.TrimSpace(cfg.Path) == "" {
		return nil, fmt.Errorf("database path is required")
	}

	rawPath := cfg.Path
	if idx := strings.IndexByte(rawPath, '?'); idx >= 0 {
		rawPath = rawPath[:idx]
	}
	lowerDSN := strings.ToLower(cfg.Path)
	isMemory := rawPath == ":memory:" ||
		strings.HasPrefix(rawPath, "file::memory:") ||
		strings.Contains(lowerDSN, "mode=memory")

	// 自动确保目录存在
	if !isMemory && filepath.Dir(rawPath) != "." {
		if err := os.MkdirAll(filepath.Dir(rawPath), 0o755); err != nil {
			return nil, fmt.Errorf("create database directory for %q: %w", cfg.Path, err)
		}
	}

	// 将 WAL、busy_timeout、synchronous、_txlock=immediate 与 _foreign_keys=on 注入 DSN，
	// 确保写事务直接获取 RESERVED 锁并排队等待 busy_timeout，消除并发读写升级锁导致的瞬时 SQLITE_BUSY。
	dsn := cfg.Path
	if !isMemory {
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		dsn = dsn + sep + "_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL&_txlock=immediate&_foreign_keys=on"
	}

	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return nil, fmt.Errorf("open sqlite database %q: %w", cfg.Path, err)
	}

	// 必须在 AutoMigrate 之前配置连接池：
	// 1. 内存库必须固定单连接，否则多连接会访问彼此隔离的空白内存库；
	// 2. 文件库采用合理并发上限配合 WAL + IMMEDIATE 锁，兼顾读写并发与写锁平滑排队。
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get underlying sql.DB for %q: %w", cfg.Path, err)
	}
	if isMemory {
		sqlDB.SetMaxOpenConns(1)
		sqlDB.SetMaxIdleConns(1)
	} else {
		sqlDB.SetMaxOpenConns(8)
		sqlDB.SetMaxIdleConns(4)
	}

	if err := db.AutoMigrate(
		&model.Project{},
		&model.Entity{},
		&model.Attribute{},
		&model.Relation{},
		&model.AIContext{},
		&model.Conversation{},
		&model.Message{},
	); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("auto migrate database: %w", err)
	}

	return db, nil
}

// Initialize 为保持兼容的别名
var Initialize = InitSQLite
