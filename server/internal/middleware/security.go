package middleware

import (
	"crypto/subtle"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"archcanvas/pkg/response"

	"github.com/gin-gonic/gin"
)

const DefaultMaxBodyBytes int64 = 16 << 20 // 16 MiB

// MaxBodyBytes 限制单次 HTTP 请求体最大字节数，防范恶意超大 JSON 引发服务端内存耗尽 (OOM)。
func MaxBodyBytes(limit int64) gin.HandlerFunc {
	if limit <= 0 {
		limit = DefaultMaxBodyBytes
	}
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		}
		c.Next()
	}
}

// OptionalTokenAuth 可选访问口令鉴权中间件：
// 当配置了环境变量 ARCHCANVAS_AUTH_TOKEN 时，对 /api/* 接口强制校验 Bearer Token 或 X-ArchCanvas-Token。
// 本机默认不设置该变量时零配置免密放行，兼顾本地桌面开箱即用与局域网共享安全。
func OptionalTokenAuth() gin.HandlerFunc {
	expectedToken := strings.TrimSpace(os.Getenv("ARCHCANVAS_AUTH_TOKEN"))
	return func(c *gin.Context) {
		if expectedToken == "" {
			c.Next()
			return
		}

		path := c.Request.URL.Path
		if path == "/healthz" || path == "/api/v1/healthz" || !(path == "/api" || strings.HasPrefix(path, "/api/")) {
			c.Next()
			return
		}

		provided := strings.TrimSpace(c.GetHeader("X-ArchCanvas-Token"))
		if provided == "" {
			authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
			if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
				provided = strings.TrimSpace(authHeader[7:])
			}
		}

		if len(provided) != len(expectedToken) || subtle.ConstantTimeCompare([]byte(provided), []byte(expectedToken)) != 1 {
			response.Fail(c, http.StatusUnauthorized, "未授权访问，请提供有效的访问令牌", nil)
			c.Abort()
			return
		}

		c.Next()
	}
}

var sensitiveQueryKeys = map[string]bool{
	"api_key": true,
	"apikey":  true,
	"token":   true,
	"secret":  true,
}

func redactQuery(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	vals, err := url.ParseQuery(rawQuery)
	if err != nil {
		return "[redacted]"
	}
	modified := false
	for k := range vals {
		if sensitiveQueryKeys[strings.ToLower(k)] {
			vals.Set(k, "***")
			modified = true
		}
	}
	if !modified {
		return rawQuery
	}
	return vals.Encode()
}

// RequestLogger 结构化请求审计日志中间件（基于 log/slog），自动绑定 trace_id 并对敏感 Query 参数脱敏。
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		safeQuery := redactQuery(c.Request.URL.RawQuery)

		c.Next()

		status := c.Writer.Status()
		latency := time.Since(start)
		traceID := GetTraceID(c.Request.Context())

		attrs := []any{
			"status", status,
			"method", c.Request.Method,
			"path", path,
			"latency_ms", latency.Milliseconds(),
			"client_ip", c.ClientIP(),
			"trace_id", traceID,
		}
		if safeQuery != "" {
			attrs = append(attrs, "query", safeQuery)
		}

		if status >= 500 {
			slog.Error("http_request", attrs...)
		} else if status >= 400 {
			slog.Warn("http_request", attrs...)
		} else {
			slog.Info("http_request", attrs...)
		}
	}
}
