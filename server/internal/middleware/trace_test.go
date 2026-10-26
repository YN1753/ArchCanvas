package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"archcanvas/pkg/id"
	"github.com/gin-gonic/gin"
)

func TestTraceMiddleware_AutoGenerate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(TraceMiddleware())

	var capturedCtxTraceID string
	var capturedGinTraceID string

	r.GET("/test", func(c *gin.Context) {
		capturedCtxTraceID = GetTraceID(c.Request.Context())
		if val, exists := c.Get(string(TraceIDKey)); exists {
			capturedGinTraceID = val.(string)
		}
		c.String(http.StatusOK, "ok")
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got: %d", w.Code)
	}

	headerReqID := w.Header().Get(HeaderXRequestID)
	if headerReqID == "" {
		t.Fatalf("expected X-Request-ID response header to be set")
	}
	if !id.IsValidUUIDv7(headerReqID) {
		t.Fatalf("expected generated Trace ID to be valid UUIDv7, got: %s", headerReqID)
	}

	if capturedCtxTraceID != headerReqID {
		t.Errorf("context trace id %s != header %s", capturedCtxTraceID, headerReqID)
	}
	if capturedGinTraceID != headerReqID {
		t.Errorf("gin trace id %s != header %s", capturedGinTraceID, headerReqID)
	}
}

func TestTraceMiddleware_PreserveIncomingHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(TraceMiddleware())

	r.GET("/test", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	customUUID := id.NewUUIDv7()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set(HeaderXRequestID, customUUID)
	r.ServeHTTP(w, req)

	respID := w.Header().Get(HeaderXRequestID)
	if respID != customUUID {
		t.Errorf("expected preserved custom trace id %s, got %s", customUUID, respID)
	}
}
