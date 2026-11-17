package handler

import (
	"errors"
	"net/http"

	"archcanvas/internal/middleware"
	"archcanvas/internal/validator"
	"archcanvas/pkg/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// respondBindError 统一处理入参解析错误（含超大请求体 413 识别）。
func respondBindError(c *gin.Context, err error, fallbackMsg string) {
	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		response.Fail(c, http.StatusRequestEntityTooLarge, "请求体大小超出服务端安全上限", nil)
		return
	}
	if fallbackMsg != "" {
		response.Fail(c, http.StatusBadRequest, fallbackMsg, nil)
		return
	}
	response.Fail(c, http.StatusBadRequest, "请求参数格式有误: "+err.Error(), nil)
}

// respondServiceError 统一映射领域异常为规范 HTTP 状态码，并在 Release 模式下脱敏内部数据库与堆栈细节。
func respondServiceError(c *gin.Context, err error, publicFallback string) {
	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		response.Fail(c, http.StatusRequestEntityTooLarge, "请求体大小超出服务端安全上限", nil)
		return
	}
	if validator.IsValidationError(err) {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if validator.IsForbiddenError(err) {
		response.Fail(c, http.StatusForbidden, err.Error(), nil)
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		response.Fail(c, http.StatusNotFound, "目标资源或项目不存在", nil)
		return
	}

	middleware.LoggerFromContext(c.Request.Context()).Error("handler_service_error",
		"error", err,
	)

	if gin.Mode() == gin.ReleaseMode && publicFallback != "" {
		response.Fail(c, http.StatusInternalServerError, publicFallback, nil)
		return
	}
	response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
}
