package handler

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"archcanvas/internal/dto"
	"archcanvas/internal/generator"
	"archcanvas/pkg/response"
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
	var req dto.GenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "参数错误: "+err.Error())
		return
	}

	files, err := h.svc.GenerateFileTree(c.Request.Context(), req)
	if err != nil {
		respondServiceError(c, err, "生成工程预览代码失败")
		return
	}

	response.Success(c, files)
}

// Download 生成并在内存中打包为 ZIP 文件流直接推给浏览器下载
func (h *GeneratorHandler) Download(c *gin.Context) {
	var req dto.GenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "参数错误: "+err.Error())
		return
	}

	buf, err := h.svc.GenerateZip(c.Request.Context(), req)
	if err != nil {
		respondServiceError(c, err, "打包下载工程代码失败")
		return
	}

	fileName := generator.SafeModuleName(req.ModuleName)
	if idx := strings.LastIndex(fileName, "/"); idx >= 0 {
		fileName = fileName[idx+1:]
	}
	if fileName == "" {
		fileName = "archcanvas-app"
	}

	asciiFallback := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '_'
	}, fileName)
	if asciiFallback == "" {
		asciiFallback = "archcanvas-app"
	}

	encodedFileName := url.PathEscape(fileName + ".zip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.zip"; filename*=UTF-8''%s`, asciiFallback, encodedFileName))
	c.Header("Content-Type", "application/zip")
	c.Data(http.StatusOK, "application/zip", buf.Bytes())
}
