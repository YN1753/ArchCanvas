package handler

import (
	"archcanvas/internal/domain"
	"archcanvas/internal/service"
	"archcanvas/pkg/response"
	"archcanvas/request"
	"net/http"

	"github.com/gin-gonic/gin"
)

type ProjectHandler struct {
	ProjectService *service.ProjectService
}

func NewProjectHandler(projectService *service.ProjectService) ProjectHandler {
	return ProjectHandler{
		ProjectService: projectService,
	}
}

// ListProjects 获取全部项目列表 (GET /api/v1/projects/list)
func (h *ProjectHandler) ListProjects(c *gin.Context) {
	ctx := c.Request.Context()
	projects, err := h.ProjectService.ListProjects(ctx)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, projects)
}

// CreateProject 创建新项目 (POST /api/v1/projects/create)
func (h *ProjectHandler) CreateProject(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.CreateProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	p, err := h.ProjectService.CreateProject(ctx, req.Name, req.Description)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, p)
}

// DeleteProject 删除项目 (POST /api/v1/projects/delete)
func (h *ProjectHandler) DeleteProject(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.DeleteProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "project_id is required", nil)
		return
	}

	if err := h.ProjectService.DeleteProject(ctx, req.ProjectID); err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, gin.H{"deleted": true, "id": req.ProjectID})
}

// UpdateProject 更新项目信息 (POST /api/v1/projects/update)
func (h *ProjectHandler) UpdateProject(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.UpdateProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	p, err := h.ProjectService.UpdateProject(ctx, req.ProjectID, req.Name, req.Description)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, p)
}

// GetProject 获取项目详情 (GET /api/v1/projects/detail?id=xxx)
func (h *ProjectHandler) GetProject(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.GetProjectReq
	if err := c.ShouldBindQuery(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "project id is required", nil)
		return
	}

	p, err := h.ProjectService.GetProject(ctx, req.ID)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "project not found: "+err.Error(), nil)
		return
	}
	response.Success(c, p)
}

// GetERDesign 获取项目 ER 结构 (GET /api/v1/projects/get-er-design?id=xxx)
func (h *ProjectHandler) GetERDesign(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.GetERDesignReq
	if err := c.ShouldBindQuery(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "project id is required", nil)
		return
	}

	design, err := h.ProjectService.GetERDesign(ctx, req.ID)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, design)
}

// SaveERDesign 保存项目 ER 结构 (POST /api/v1/projects/save-er-design)
func (h *ProjectHandler) SaveERDesign(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.SaveERDesignReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	design := domain.ERDesign{
		Entities:  req.Entities,
		Relations: req.Relations,
	}

	result, err := h.ProjectService.SaveERDesign(ctx, req.ProjectID, design)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, result)
}

// GetModels 获取或探测可用大模型列表 (GET /api/v1/models/list)
func (h *ProjectHandler) GetModels(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.GetModelsReq
	if err := c.ShouldBindQuery(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	models, err := h.ProjectService.GetAvailableModels(ctx, req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, models)
}

// SaveModel 保存模型配置 (POST /api/v1/models/save)
func (h *ProjectHandler) SaveModel(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.SaveModelReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	models, err := h.ProjectService.SaveModelConfig(ctx, req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, models)
}
