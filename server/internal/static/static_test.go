package static

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRegisterSPA_SecurityAndRouting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterSPA(r)

	t.Run("root serves index.html with no-cache", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 for /, got %d", w.Code)
		}
		if cc := w.Header().Get("Cache-Control"); cc != "no-cache" {
			t.Fatalf("expected Cache-Control=no-cache, got %q", cc)
		}
		if !strings.Contains(w.Body.String(), "<html") {
			t.Fatalf("expected html body, got %q", w.Body.String())
		}
	})

	t.Run("SPA route /api-docs is NOT hijacked as backend /api/* 404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api-docs", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 SPA fallback for /api-docs, got %d", w.Code)
		}
		if !strings.Contains(w.Body.String(), "<html") {
			t.Fatalf("expected index.html fallback for /api-docs, got %q", w.Body.String())
		}
	})

	t.Run("unknown /api and /api/* return 404 JSON instead of HTML", func(t *testing.T) {
		for _, p := range []string{"/api", "/api/", "/api/v1/does-not-exist"} {
			req := httptest.NewRequest(http.MethodGet, p, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusNotFound {
				t.Fatalf("expected 404 for %s, got %d", p, w.Code)
			}
			if !strings.Contains(w.Header().Get("Content-Type"), "application/json") {
				t.Fatalf("expected JSON content-type for %s, got %q", p, w.Header().Get("Content-Type"))
			}
		}
	})

	t.Run("directory listing on /assets/ and missing /assets/*.js return 404", func(t *testing.T) {
		for _, p := range []string{"/assets", "/assets/", "/assets/missing-chunk.js"} {
			req := httptest.NewRequest(http.MethodGet, p, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusNotFound {
				t.Fatalf("expected 404 for %s, got %d (body: %q)", p, w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "<pre>") || strings.Contains(w.Body.String(), "<html") {
				t.Fatalf("must not leak directory listing or HTML MIME mismatch for %s", p)
			}
		}
	})
}
