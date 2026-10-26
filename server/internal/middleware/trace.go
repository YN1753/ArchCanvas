package middleware

import (
	"context"
	"strings"

	"archcanvas/pkg/id"
	"github.com/gin-gonic/gin"
)

type contextKey string

const (
	TraceIDKey       contextKey = "trace_id"
	HeaderXRequestID string     = "X-Request-ID"
	HeaderXTraceID   string     = "X-Trace-ID"
)

// TraceMiddleware 全局请求链路追踪中间件：
// 优先读取客户端传入的 X-Request-ID 或 X-Trace-ID；
// 若无则生成高单调有序的 UUIDv7，并注入到 Gin Context、标准 context.Context 及响应头中。
func TraceMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		traceID := strings.TrimSpace(c.GetHeader(HeaderXRequestID))
		if traceID == "" {
			traceID = strings.TrimSpace(c.GetHeader(HeaderXTraceID))
		}
		if traceID == "" || !id.IsValidUUID(traceID) {
			traceID = id.NewUUIDv7()
		}

		c.Set(string(TraceIDKey), traceID)

		ctx := context.WithValue(c.Request.Context(), TraceIDKey, traceID)
		c.Request = c.Request.WithContext(ctx)

		c.Header(HeaderXRequestID, traceID)
		c.Header(HeaderXTraceID, traceID)

		c.Next()
	}
}

// GetTraceID 从 Context 中提取绑定的 TraceID
func GetTraceID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if val, ok := ctx.Value(TraceIDKey).(string); ok && val != "" {
		return val
	}
	return ""
}
