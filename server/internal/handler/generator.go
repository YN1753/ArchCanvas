package handler

import (
	"fmt"
	"net/http"
	"strings"

	"archcanvas/internal/generator"
	"archcanvas/pkg/response"
	"archcanvas/request"
	"github.com/gin-gonic/gin"
)

type GeneratorHandler struct {
	svc *generator.GeneratorService
}

func NewGeneratorHandler(svc *generator.GeneratorService) GeneratorHandler {
	return GeneratorHandler{svc: svc}
}

// Preview 生成并返回文件树与源码 (供前端弹窗高亮预览)
func (h *GeneratorHandler) Preview(c *gin.Context) {
	var req request.GenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误: "+err.Error(), nil)
		return
	}

	files, err := h.svc.GenerateFileTree(c.Request.Context(), req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}

	response.Success(c, files)
}

// Download 生成并在内存中打包为 ZIP 文件流直接推给浏览器下载
func (h *GeneratorHandler) Download(c *gin.Context) {
	var req request.GenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误: "+err.Error(), nil)
		return
	}

	buf, err := h.svc.GenerateZip(c.Request.Context(), req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}

	fileName := req.ModuleName
	if fileName == "" {
		fileName = "archcanvas-app"
	}
	if idx := strings.LastIndex(fileName, "/"); idx >= 0 {
		fileName = fileName[idx+1:]
	}

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.zip"`, fileName))
	c.Header("Content-Type", "application/zip")
	c.Data(http.StatusOK, "application/zip", buf.Bytes())
}
