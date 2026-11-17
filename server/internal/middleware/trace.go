package middleware

import (
	"context"
	"log/slog"
	"strings"

	"archcanvas/pkg/id"
	"archcanvas/pkg/reqctx"

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
// 若无则生成高单调有序的 UUIDv7，并将 trace_id 及绑定了 trace_id 的 slog.Logger 注入 Context 与响应头。
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

		reqLogger := slog.Default().With(
			slog.String("trace_id", traceID),
			slog.String("method", c.Request.Method),
			slog.String("path", c.Request.URL.Path),
		)

		ctx := reqctx.WithTraceID(c.Request.Context(), traceID)
		ctx = reqctx.WithLogger(ctx, reqLogger)
		c.Request = c.Request.WithContext(ctx)

		c.Header(HeaderXRequestID, traceID)
		c.Header(HeaderXTraceID, traceID)

		c.Next()
	}
}

// GetTraceID 从 Context 中提取绑定的 TraceID。
func GetTraceID(ctx context.Context) string {
	return reqctx.TraceIDFromContext(ctx)
}

// TraceIDFromContext 从 Context 中提取绑定的 TraceID。
func TraceIDFromContext(ctx context.Context) string {
	return reqctx.TraceIDFromContext(ctx)
}

// LoggerFromContext 从 Context 中提取已注入 trace_id 的结构化日志器；若不存在则回退至 slog.Default()。
func LoggerFromContext(ctx context.Context) *slog.Logger {
	return reqctx.LoggerFromContext(ctx)
}
