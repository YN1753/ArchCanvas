package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestHealthHandler_Check(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// 使用内存 SQLite 数据库进行测试
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open memory sqlite: %v", err)
	}

	h := NewHealthHandler(db)

	r := gin.New()
	r.GET("/healthz", h.Check)

	// 1. 正常连接健康测试
	req, _ := http.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp HealthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if resp.Status != "ok" {
		t.Errorf("expected status ok, got %s", resp.Status)
	}
	if resp.Database != "connected" {
		t.Errorf("expected database connected, got %s", resp.Database)
	}

	// 2. 模拟底层连接池断开的降级响应
	sqlDB, err := db.DB()
	if err == nil {
		_ = sqlDB.Close()
	}

	wDegraded := httptest.NewRecorder()
	r.ServeHTTP(wDegraded, req)

	if wDegraded.Code != http.StatusServiceUnavailable {
		t.Errorf("expected status 503 when db is closed, got %d", wDegraded.Code)
	}

	var respDegraded HealthResponse
	_ = json.Unmarshal(wDegraded.Body.Bytes(), &respDegraded)
	if respDegraded.Status != "degraded" {
		t.Errorf("expected status degraded, got %s", respDegraded.Status)
	}
	if respDegraded.Database != "disconnected" {
		t.Errorf("expected database disconnected, got %s", respDegraded.Database)
	}
}
