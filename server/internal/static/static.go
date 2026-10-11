package static

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed all:dist
var distFS embed.FS

// RegisterSPA 将嵌入的前端静态资源注册至 Gin 引擎，并配置 SPA 路由重定向回退机制
func RegisterSPA(r *gin.Engine) {
	subFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		return
	}

	httpFS := http.FS(subFS)
	fileServer := http.FileServer(httpFS)

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// 任何 API 路径如果未匹配到路由，直接响应 404 JSON，严禁回退为 HTML
		if strings.HasPrefix(path, "/api") {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "api endpoint not found",
			})
			return
		}

		cleanPath := strings.TrimPrefix(path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}

		// 如果请求的是静态资源文件（.js, .css, .svg, .png 等）且存在，直接提供静态文件服务
		if f, err := subFS.Open(cleanPath); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}

		// 单页应用 (SPA) 路由回退：所有前端路由页面（如 /projects/xxx）在刷新时回退提供 index.html
		c.Request.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}
