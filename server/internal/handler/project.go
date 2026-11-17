package handler

import (
	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/internal/middleware"
	"archcanvas/internal/service"
	"archcanvas/pkg/response"

	"github.com/gin-gonic/gin"
)

type ProjectHandler struct {
	ProjectService *service.ProjectService
	QuotaManager   *middleware.ShowcaseQuotaManager
}

func NewProjectHandler(projectService *service.ProjectService) ProjectHandler {
	return ProjectHandler{
		ProjectService: projectService,
	}
}

func (h ProjectHandler) WithQuotaManager(qm *middleware.ShowcaseQuotaManager) ProjectHandler {
	h.QuotaManager = qm
	return h
}

// IsShowcaseEnabled 返回当前实例是否处于公开演示沙盒模式（封装内部服务层状态读取）。
func (h ProjectHandler) IsShowcaseEnabled() bool {
	return (h.QuotaManager != nil && h.QuotaManager.Enabled()) ||
		(h.ProjectService != nil && h.ProjectService.IsShowcaseEnabled())
}

// ListProjects 获取全部项目列表 (GET /api/v1/projects/list)
func (h *ProjectHandler) ListProjects(c *gin.Context) {
	ctx := c.Request.Context()
	projects, err := h.ProjectService.ListProjects(ctx)
	if err != nil {
		respondServiceError(c, err, "获取项目列表失败")
		return
	}
	response.Success(c, projects)
}

// CreateProject 创建新项目 (POST /api/v1/projects/create)
func (h *ProjectHandler) CreateProject(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.CreateProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	p, err := h.ProjectService.CreateProject(ctx, req.Name, req.Description)
	if err != nil {
		respondServiceError(c, err, "创建项目失败")
		return
	}
	response.Success(c, p)
}

// DeleteProject 删除项目 (POST /api/v1/projects/delete)
func (h *ProjectHandler) DeleteProject(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.DeleteProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "project_id is required")
		return
	}

	if err := h.ProjectService.DeleteProject(ctx, req.ProjectID); err != nil {
		respondServiceError(c, err, "删除项目失败")
		return
	}
	response.Success(c, gin.H{"deleted": true, "id": req.ProjectID})
}

// UpdateProject 更新项目信息 (POST /api/v1/projects/update)
func (h *ProjectHandler) UpdateProject(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.UpdateProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	p, err := h.ProjectService.UpdateProject(ctx, req.ProjectID, req.Name, req.Description)
	if err != nil {
		respondServiceError(c, err, "更新项目信息失败")
		return
	}
	response.Success(c, p)
}

// GetProject 获取项目详情 (GET /api/v1/projects/detail?id=xxx)
func (h *ProjectHandler) GetProject(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.GetProjectReq
	if err := c.ShouldBindQuery(&req); err != nil {
		respondBindError(c, err, "project id is required")
		return
	}

	p, err := h.ProjectService.GetProject(ctx, req.ID)
	if err != nil {
		respondServiceError(c, err, "读取项目详情失败")
		return
	}
	response.Success(c, p)
}

// GetERDesign 获取项目 ER 结构 (GET /api/v1/projects/get-er-design?id=xxx)
func (h *ProjectHandler) GetERDesign(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.GetERDesignReq
	if err := c.ShouldBindQuery(&req); err != nil {
		respondBindError(c, err, "project id is required")
		return
	}

	design, err := h.ProjectService.GetERDesign(ctx, req.ID)
	if err != nil {
		respondServiceError(c, err, "获取物理数据表模型失败")
		return
	}
	response.Success(c, design)
}

// SaveERDesign 保存项目 ER 结构 (POST /api/v1/projects/save-er-design)
func (h *ProjectHandler) SaveERDesign(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.SaveERDesignReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	design := domain.ERDesign{
		Entities:  req.Entities,
		Relations: req.Relations,
	}

	result, err := h.ProjectService.SaveERDesign(ctx, req.ProjectID, design)
	if err != nil {
		respondServiceError(c, err, "保存物理数据表设计失败")
		return
	}
	response.Success(c, result)
}

// GetConceptualDesign 获取项目概念模型 (GET /api/v1/projects/get-conceptual-design)
func (h *ProjectHandler) GetConceptualDesign(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.GetConceptualDesignReq
	if err := c.ShouldBindQuery(&req); err != nil {
		respondBindError(c, err, "project id is required")
		return
	}
	design, err := h.ProjectService.GetConceptualDesign(ctx, req.ID)
	if err != nil {
		respondServiceError(c, err, "获取概念模型失败")
		return
	}
	response.Success(c, design)
}

// SaveConceptualDesign 保存项目概念模型 (POST /api/v1/projects/save-conceptual-design)
func (h *ProjectHandler) SaveConceptualDesign(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.SaveConceptualDesignReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	if err := h.ProjectService.SaveConceptualDesign(ctx, req.ProjectID, req.Design); err != nil {
		respondServiceError(c, err, "保存概念模型失败")
		return
	}
	response.Success(c, "success")
}

// GetModels 获取已配置可用大模型列表 (GET /api/v1/models/list)
func (h *ProjectHandler) GetModels(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.GetModelsReq
	if err := c.ShouldBindQuery(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	models, err := h.ProjectService.GetAvailableModels(ctx, req)
	if err != nil {
		respondServiceError(c, err, "获取可用模型列表失败")
		return
	}
	response.Success(c, models)
}

// ProbeModels 通过 POST JSON Body 安全探测远程端点模型列表 (POST /api/v1/models/list 或 /probe)
func (h *ProjectHandler) ProbeModels(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.GetModelsReq
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			respondBindError(c, err, "")
			return
		}
	}

	models, err := h.ProjectService.GetAvailableModels(ctx, req)
	if err != nil {
		respondServiceError(c, err, "探测远程端点可用模型列表失败")
		return
	}
	response.Success(c, models)
}

// SaveModel 保存模型配置 (POST /api/v1/models/save)
func (h *ProjectHandler) SaveModel(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.SaveModelReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	models, err := h.ProjectService.SaveModelConfig(ctx, req)
	if err != nil {
		respondServiceError(c, err, "保存模型配置失败")
		return
	}
	response.Success(c, models)
}

// ListMessages 获取项目的历史对话消息 (GET /api/v1/projects/messages?project_id=xxx)
func (h *ProjectHandler) ListMessages(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.ListMessagesReq
	if err := c.ShouldBindQuery(&req); err != nil {
		respondBindError(c, err, "project_id is required")
		return
	}

	messages, err := h.ProjectService.ListProjectMessageDTOs(ctx, req.ProjectID)
	if err != nil {
		respondServiceError(c, err, "获取历史对话失败")
		return
	}
	response.Success(c, messages)
}

// ClearMessages 清空项目的历史对话 (POST /api/v1/projects/messages/clear)
func (h *ProjectHandler) ClearMessages(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.ClearMessagesReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "project_id is required")
		return
	}

	if err := h.ProjectService.ClearProjectMessages(ctx, req.ProjectID); err != nil {
		respondServiceError(c, err, "清空历史对话失败")
		return
	}
	response.Success(c, gin.H{"cleared": true, "project_id": req.ProjectID})
}

// ForkProject 克隆样板或现有项目至当前访客沙盒 (POST /api/v1/projects/fork)
func (h *ProjectHandler) ForkProject(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.ForkProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "project_id is required")
		return
	}

	forked, err := h.ProjectService.ForkProject(ctx, req.ProjectID, req.Name)
	if err != nil {
		respondServiceError(c, err, "克隆沙盒副本失败")
		return
	}
	response.Success(c, forked)
}

// ShowcaseStatus 返回当前实例演示沙盒模式状态与当前访客 IP 剩余免费 AI 体验额度 (GET /api/v1/showcase/status)
func (h *ProjectHandler) ShowcaseStatus(c *gin.Context) {
	ctx := c.Request.Context()
	enabled := h.IsShowcaseEnabled() || middleware.IsShowcaseMode(ctx)
	if !enabled {
		response.Success(c, dto.ShowcaseStatusResp{Enabled: false})
		return
	}

	cfg := h.ProjectService.ShowcaseConfig()
	if h.QuotaManager != nil {
		cfg = h.QuotaManager.Config()
	}

	var ipUsed, globalUsed int
	if h.QuotaManager != nil {
		clientIP := middleware.ExtractShowcaseClientIP(c.Request)
		ipUsed, globalUsed, _ = h.QuotaManager.GetUsage(ctx, clientIP)
	}

	response.Success(c, dto.ShowcaseStatusResp{
		Enabled:               true,
		VisitorID:             middleware.GetVisitorID(ctx),
		IPDailyLimit:          cfg.IPDailyLimit,
		IPUsed:                ipUsed,
		IPRemaining:           max(0, cfg.IPDailyLimit-ipUsed),
		GlobalDailyLimit:      cfg.GlobalDailyLimit,
		GlobalUsed:            globalUsed,
		GlobalRemaining:       max(0, cfg.GlobalDailyLimit-globalUsed),
		VisitorTTLHours:       cfg.VisitorTTLHours,
		MaxProjectsPerVisitor: cfg.MaxProjectsPerVisitor,
		ReadonlyModels:        true,
	})
}
