package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORS_WildcardNeverCombinesWithCredentials(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CORS_ALLOWED_ORIGINS", "*")

	r := gin.New()
	r.Use(CORS())
	r.GET("/ping", func(c *gin.Context) { c.String(200, "pong") })

	// 1. 第三方外网域名命中 * 时返回 Allow-Origin: * 且绝不返回 Allow-Credentials: true
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	r.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("expected Allow-Origin *, got %q", got)
	}
	if cred := w.Header().Get("Access-Control-Allow-Credentials"); cred != "" {
		t.Errorf("CRITICAL: wildcard CORS must not set Allow-Credentials, got %q", cred)
	}
	if vary := w.Header().Get("Vary"); !strings.Contains(vary, "Origin") {
		t.Errorf("expected Vary: Origin header, got %q", vary)
	}

	// 2. 本地 Vite 开发端口精确放行且支持 Credentials
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req2.Header.Set("Origin", "http://localhost:5173")
	r.ServeHTTP(w2, req2)

	if got := w2.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Errorf("expected Allow-Origin http://localhost:5173, got %q", got)
	}
	if cred := w2.Header().Get("Access-Control-Allow-Credentials"); cred != "true" {
		t.Errorf("expected Allow-Credentials true for localhost:5173, got %q", cred)
	}
}

func TestOptionalTokenAuthAndMaxBodyBytes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("ARCHCANVAS_AUTH_TOKEN", "my-secret-token")

	r := gin.New()
	r.Use(MaxBodyBytes(32))
	r.Use(OptionalTokenAuth())
	r.GET("/healthz", func(c *gin.Context) { c.String(200, "ok") })
	r.POST("/api/v1/projects/create", func(c *gin.Context) {
		_, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.Status(http.StatusRequestEntityTooLarge)
			return
		}
		c.Status(http.StatusOK)
	})

	// 1. /healthz 免鉴权放行
	wHealth := httptest.NewRecorder()
	r.ServeHTTP(wHealth, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if wHealth.Code != http.StatusOK {
		t.Errorf("expected 200 on /healthz without token, got %d", wHealth.Code)
	}

	// 2. 未携带令牌访问 /api/* 拦截 401
	wNoAuth := httptest.NewRecorder()
	r.ServeHTTP(wNoAuth, httptest.NewRequest(http.MethodPost, "/api/v1/projects/create", strings.NewReader(`{}`)))
	if wNoAuth.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without token, got %d", wNoAuth.Code)
	}

	// 3. 携带正确 Bearer Token 且超出体积限制返回 413
	wTooLarge := httptest.NewRecorder()
	reqLarge := httptest.NewRequest(http.MethodPost, "/api/v1/projects/create", strings.NewReader(strings.Repeat("a", 128)))
	reqLarge.Header.Set("Authorization", "Bearer my-secret-token")
	r.ServeHTTP(wTooLarge, reqLarge)
	if wTooLarge.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413 on oversized body, got %d", wTooLarge.Code)
	}
}
