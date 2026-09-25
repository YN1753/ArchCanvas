package request

import "archcanvas/internal/domain"

type CreateProjectReq struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

type DeleteProjectReq struct {
	ProjectID string `json:"project_id" binding:"required"`
}

type UpdateProjectReq struct {
	ProjectID   string `json:"project_id" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

type GetProjectReq struct {
	ID string `form:"id" binding:"required"`
}

type GetERDesignReq struct {
	ID string `form:"id" binding:"required"`
}

type GetConceptualDesignReq struct {
	ID string `form:"id" binding:"required"`
}

type SaveERDesignReq struct {
	ProjectID string            `json:"project_id" binding:"required"`
	Entities  []domain.Entity   `json:"entities"`
	Relations []domain.Relation `json:"relations"`
}

type SaveConceptualDesignReq struct {
	ProjectID string                  `json:"project_id" binding:"required"`
	Design    domain.ConceptualDesign `json:"design" binding:"required"`
}

type GetModelsReq struct {
	BaseURL  string `form:"base_url" json:"base_url"`
	APIKey   string `form:"api_key" json:"api_key"`
	Provider string `form:"provider" json:"provider"`
}

type ListMessagesReq struct {
	ProjectID string `form:"project_id" json:"project_id" binding:"required"`
}

type ClearMessagesReq struct {
	ProjectID string `json:"project_id" binding:"required"`
}
