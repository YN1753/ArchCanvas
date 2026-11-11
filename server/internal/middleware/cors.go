package middleware

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

func isAllowedOrigin(origin string, requestHost string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return false
	}

	// 同源主机名放行
	if strings.EqualFold(parsed.Host, requestHost) {
		return true
	}

	// 本地开发环回地址放行
	hostname := strings.ToLower(parsed.Hostname())
	if hostname == "localhost" || hostname == "127.0.0.1" || hostname == "::1" {
		return true
	}

	// 支持通过环境变量 CORS_ALLOWED_ORIGINS 配置额外白名单（逗号分隔）
	if extra := os.Getenv("CORS_ALLOWED_ORIGINS"); extra != "" {
		for _, item := range strings.Split(extra, ",") {
			trimmed := strings.TrimSpace(item)
			if trimmed == "*" || strings.EqualFold(trimmed, origin) {
				return true
			}
		}
	}

	return false
}

func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && isAllowedOrigin(origin, c.Request.Host) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Content-Length, Authorization, Accept, Origin, Cache-Control, X-Requested-With, X-Request-Id")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Expose-Headers", "Content-Length, Content-Type, X-Request-Id")
			c.Header("Access-Control-Max-Age", "86400")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
