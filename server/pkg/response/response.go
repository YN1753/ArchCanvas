package response

import "github.com/gin-gonic/gin"

type Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	TraceID string `json:"trace_id,omitempty"`
}

func getTraceID(c *gin.Context) string {
	if c == nil {
		return ""
	}
	if val, exists := c.Get("trace_id"); exists {
		if s, ok := val.(string); ok {
			return s
		}
	}
	return ""
}

func Fail(c *gin.Context, code int, message string, data any) {
	c.JSON(code, Response{
		Code:    code,
		Message: message,
		Data:    data,
		TraceID: getTraceID(c),
	})
}

func Success(c *gin.Context, data any) {
	c.JSON(200, Response{
		Code:    200,
		Message: "success",
		Data:    data,
		TraceID: getTraceID(c),
	})
}
