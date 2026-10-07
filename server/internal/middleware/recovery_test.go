package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"archcanvas/pkg/response"
	"github.com/gin-gonic/gin"
)

func TestRecoveryMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(Recovery())

	// 正常路由
	r.GET("/ping", func(c *gin.Context) {
		response.Success(c, "pong")
	})

	// 会触发 Panic 的异常路由
	r.GET("/panic-route", func(c *gin.Context) {
		panic("nil pointer dereference or fatal error")
	})

	// 1. 测试正常路由
	wNormal := httptest.NewRecorder()
	reqNormal, _ := http.NewRequest("GET", "/ping", nil)
	r.ServeHTTP(wNormal, reqNormal)

	if wNormal.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", wNormal.Code)
	}

	// 2. 测试 Panic 捕获与恢复
	wPanic := httptest.NewRecorder()
	reqPanic, _ := http.NewRequest("GET", "/panic-route", nil)
	r.ServeHTTP(wPanic, reqPanic)

	if wPanic.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on panic, got %d", wPanic.Code)
	}

	var resp response.Response
	if err := json.Unmarshal(wPanic.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal panic response: %v", err)
	}

	if resp.Code != 500 {
		t.Errorf("expected resp.Code 500, got %d", resp.Code)
	}

	expectedPrefix := "服务器内部发生非预期错误: nil pointer dereference or fatal error"
	if resp.Message != expectedPrefix {
		t.Errorf("expected message %q, got %q", expectedPrefix, resp.Message)
	}
}
