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

func (h *ProjectHandler) ListProjects(c *gin.Context) {
	ctx := c.Request.Context()
	projects, err := h.ProjectService.ListProjects(ctx)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, projects)
}


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

func (h *ProjectHandler) GetProject(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Query("id")
	if id == "" {
		id = c.Query("project_id")
	}
	if id == "" {
		id = c.Param("id")
	}
	if id == "" {
		response.Fail(c, http.StatusBadRequest, "project id is required", nil)
		return
	}

	p, err := h.ProjectService.GetProject(ctx, id)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "project not found: "+err.Error(), nil)
		return
	}
	response.Success(c, p)
}

func (h *ProjectHandler) GetERDesign(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Query("id")
	if id == "" {
		id = c.Query("project_id")
	}
	if id == "" {
		id = c.Param("id")
	}
	if id == "" {
		response.Fail(c, http.StatusBadRequest, "project id is required", nil)
		return
	}

	design, err := h.ProjectService.GetERDesign(ctx, id)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, design)
}

func (h *ProjectHandler) SaveERDesign(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Query("id")
	if id == "" {
		id = c.Query("project_id")
	}
	if id == "" {
		id = c.Param("id")
	}

	var req struct {
		ProjectID string            `json:"project_id"`
		Entities  []domain.Entity   `json:"entities"`
		Relations []domain.Relation `json:"relations"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	if id == "" {
		id = req.ProjectID
	}
	if id == "" {
		response.Fail(c, http.StatusBadRequest, "project id is required", nil)
		return
	}

	design := domain.ERDesign{
		Entities:  req.Entities,
		Relations: req.Relations,
	}

	result, err := h.ProjectService.SaveERDesign(ctx, id, design)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, result)
}

func (h *ProjectHandler) GetModels(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.GetModelsReq
	_ = c.ShouldBindQuery(&req)
	if req.BaseURL == "" && c.Request.ContentLength > 0 {
		_ = c.ShouldBindJSON(&req)
	}

	models, err := h.ProjectService.GetAvailableModels(ctx, req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	response.Success(c, models)
}

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


