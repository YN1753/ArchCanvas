package middleware

import (
	"archcanvas/pkg/response"
	"fmt"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"
)

// Recovery 全局 Panic 捕获与容错恢复中间件（记录结构化堆栈与 trace_id，不向 stderr 泄露原始请求凭据头）。
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				LoggerFromContext(c.Request.Context()).Error("panic recovered",
					"panic", fmt.Sprintf("%v", recovered),
					"stack", string(debug.Stack()),
				)

				if c.Writer.Written() {
					c.Abort()
					return
				}
				if gin.Mode() == gin.ReleaseMode {
					response.Fail(c, http.StatusInternalServerError, "服务器内部发生非预期错误", nil)
					c.Abort()
					return
				}
				errStr := fmt.Sprintf("%v", recovered)
				response.Fail(c, http.StatusInternalServerError, "服务器内部发生非预期错误: "+errStr, nil)
				c.Abort()
			}
		}()
		c.Next()
	}
}
