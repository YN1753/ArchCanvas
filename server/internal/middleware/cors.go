package middleware

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// matchOrigin 返回 (是否允许, 是否为通配符 * 匹配)。
// 通配符匹配时遵循 Fetch/CORS 规范绝不同时下发 Access-Control-Allow-Credentials: true。
func matchOrigin(origin string, requestHost string) (allowed bool, wildcard bool) {
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return false, false
	}

	// 同源主机名放行
	if requestHost != "" && strings.EqualFold(parsed.Host, requestHost) {
		return true, false
	}

	// 本地开发环回常用端口放行（Vite 5173/4173 及本服务同主机环回）
	hostname := strings.ToLower(parsed.Hostname())
	if hostname == "localhost" || hostname == "127.0.0.1" || hostname == "::1" {
		port := parsed.Port()
		if port == "" || port == "5173" || port == "4173" || port == "8080" || port == "3000" {
			return true, false
		}
		// 若请求的目标 Host 本身也是环回地址且端口匹配，已在上方同源分支放行
	}

	// 支持通过环境变量 CORS_ALLOWED_ORIGINS 配置额外白名单（逗号分隔）
	if extra := os.Getenv("CORS_ALLOWED_ORIGINS"); extra != "" {
		hasWildcard := false
		for _, item := range strings.Split(extra, ",") {
			trimmed := strings.TrimSpace(item)
			if trimmed == "" {
				continue
			}
			if trimmed == "*" {
				hasWildcard = true
				continue
			}
			if strings.EqualFold(trimmed, origin) {
				return true, false
			}
		}
		if hasWildcard {
			return true, true
		}
	}

	return false, false
}

func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 始终声明 Vary: Origin，防止中间缓存污染不同源响应
		c.Writer.Header().Add("Vary", "Origin")

		origin := c.GetHeader("Origin")
		if origin != "" {
			if allowed, wildcard := matchOrigin(origin, c.Request.Host); allowed {
				if wildcard {
					c.Header("Access-Control-Allow-Origin", "*")
				} else {
					c.Header("Access-Control-Allow-Origin", origin)
					c.Header("Access-Control-Allow-Credentials", "true")
				}
				c.Header("Access-Control-Allow-Headers", "Content-Type, Content-Length, Authorization, Accept, Origin, Cache-Control, X-Requested-With, X-Request-Id, X-Trace-Id, X-ArchCanvas-Token, X-Visitor-Id")
				c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				c.Header("Access-Control-Expose-Headers", "Content-Length, Content-Type, X-Request-Id, X-Trace-Id, X-Visitor-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-GlobalLimit-Remaining")
				c.Header("Access-Control-Max-Age", "86400")
			}
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
