package static

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"archcanvas/pkg/response"

	"github.com/gin-gonic/gin"
)

//go:embed all:dist
var distFS embed.FS

// RegisterSPA 将嵌入的前端静态资源注册至 Gin 引擎，并配置安全的 SPA 路由回退机制。
func RegisterSPA(r *gin.Engine) {
	subFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		return
	}

	httpFS := http.FS(subFS)
	fileServer := http.FileServer(httpFS)

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// 精确匹配 /api 或 /api/* 路径：未命中的后端接口统一返回带 trace_id 的标准 404 JSON，不误伤 /api-docs 等前端页面
		if path == "/api" || strings.HasPrefix(path, "/api/") {
			response.Fail(c, http.StatusNotFound, "api endpoint not found", nil)
			return
		}

		cleanPath := strings.TrimPrefix(path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}

		// 仅当目标路径存在且为普通文件（非目录）时才直接输出静态文件，严禁暴露 /assets/ 目录列表
		if f, err := subFS.Open(cleanPath); err == nil {
			stat, statErr := f.Stat()
			_ = f.Close()
			if statErr == nil && !stat.IsDir() {
				if strings.HasPrefix(cleanPath, "assets/") {
					c.Header("Cache-Control", "public, max-age=31536000, immutable")
				} else if cleanPath == "index.html" {
					c.Header("Cache-Control", "no-cache")
				}
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
		}

		// 若请求的是静态资源目录或不存在的带后缀构建产物（如 /assets/xxx.js），直接返回 404，防止返回 HTML 触发前端 MIME 报错
		if cleanPath == "assets" || strings.HasPrefix(cleanPath, "assets/") {
			c.Status(http.StatusNotFound)
			return
		}

		// 单页应用 (SPA) 路由回退：提供不缓存的 index.html
		c.Header("Cache-Control", "no-cache")
		c.Request.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}
