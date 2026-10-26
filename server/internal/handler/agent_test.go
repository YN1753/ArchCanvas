package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"archcanvas/internal/middleware"
	"archcanvas/internal/service"
	"github.com/gin-gonic/gin"
)

func TestStreamSSE_TraceIDInjection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.TraceMiddleware())

	r.GET("/api/v1/agent/sse-test", func(c *gin.Context) {
		ch := make(chan service.StreamEvent, 3)
		ch <- service.StreamEvent{Type: service.EventStatus, Data: "正在分析..."}
		ch <- service.StreamEvent{Type: service.EventThinking, Data: "思考块内容"}
		ch <- service.StreamEvent{Type: service.EventDone, Data: true}
		close(ch)

		streamSSE(c, ch)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(context.Background(), "GET", "/api/v1/agent/sse-test", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	traceID := w.Header().Get("X-Request-ID")
	if traceID == "" {
		t.Fatalf("expected X-Request-ID header to be present")
	}

	body := w.Body.String()
	if !strings.Contains(body, "id:"+traceID) && !strings.Contains(body, "id: "+traceID) && !strings.Contains(body, traceID) {
		t.Fatalf("expected SSE stream body to contain traceID %s, got:\n%s", traceID, body)
	}

	if !strings.Contains(body, "event:status") && !strings.Contains(body, "event: status") {
		t.Fatalf("expected SSE stream body to contain status event, got:\n%s", body)
	}

	if !strings.Contains(body, "event:thinking") && !strings.Contains(body, "event: thinking") {
		t.Fatalf("expected SSE stream body to contain thinking event, got:\n%s", body)
	}
}
