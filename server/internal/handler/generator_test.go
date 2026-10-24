package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"archcanvas/internal/generator"
	"github.com/gin-gonic/gin"
)

func TestGeneratorHandler_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)

	svc, err := generator.NewGeneratorService(nil)
	if err != nil {
		t.Fatalf("failed to create GeneratorService: %v", err)
	}
	h := NewGeneratorHandler(svc)

	r := gin.New()
	r.POST("/generator/preview", h.Preview)
	r.POST("/generator/download", h.Download)

	// 1. 无效 JSON 请求体测试
	t.Run("InvalidJSON", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/generator/preview", bytes.NewBufferString("invalid json"))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for invalid JSON, got: %d", w.Code)
		}
	})

	t.Run("DownloadInvalidJSON", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/generator/download", bytes.NewBufferString("invalid json"))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for invalid JSON in download, got: %d", w.Code)
		}
	})
}
