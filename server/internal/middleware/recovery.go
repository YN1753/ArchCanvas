package middleware

import (
	"archcanvas/pkg/response"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Recovery 返回全局 Panic 捕获与容错恢复中间件，格式化输出 JSON 错误，保护服务高可用常驻
func Recovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered any) {
		if c.Writer.Written() {
			c.Abort()
			return
		}
		errStr := fmt.Sprintf("%v", recovered)
		response.Fail(c, http.StatusInternalServerError, "服务器内部发生非预期错误: "+errStr, nil)
	})
}
