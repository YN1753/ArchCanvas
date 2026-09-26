package request

import "archcanvas/internal/domain"

type ChatReq struct {
	ProjectID     string `json:"project_id"`
	Input         string `json:"input" binding:"required"`
	ModelProvider string `json:"model_provider,omitempty"` // 可选模型提供商，如 deepseek / openai
	ModelName     string `json:"model_name,omitempty"`     // 可选模型名称，方便测试与切换
}

// ProposeConceptsReq Layer 1 业务概念建模请求
type ProposeConceptsReq struct {
	ProjectID     string `json:"project_id"`
	Input         string `json:"input" binding:"required"`
	ModelProvider string `json:"model_provider,omitempty"`
	ModelName     string `json:"model_name,omitempty"`
}

// DerivePhysicalReq Layer 2 物理表与索引工程推导请求
type DerivePhysicalReq struct {
	ProjectID        string                   `json:"project_id"`
	Dialect          string                   `json:"dialect,omitempty"` // 方言: mysql / postgres / sqlite，默认 mysql
	ConceptualDesign *domain.ConceptualDesign `json:"conceptual_design,omitempty"`
	ModelProvider    string                   `json:"model_provider,omitempty"`
	ModelName        string                   `json:"model_name,omitempty"`
}

// ReviewSchemaReq Layer 3 架构师质量体检请求
type ReviewSchemaReq struct {
	ProjectID     string `json:"project_id"`
	Dialect       string `json:"dialect,omitempty"` // 方言: mysql / postgres / sqlite，默认 mysql
	ModelProvider string `json:"model_provider,omitempty"`
	ModelName     string `json:"model_name,omitempty"`
}

type SaveModelReq struct {
	Provider     string `json:"provider" binding:"required"`
	Model        string `json:"model" binding:"required"`
	BaseURL      string `json:"base_url" binding:"required"`
	APIKey       string `json:"api_key,omitempty"`
	SetAsDefault bool   `json:"set_as_default"`
}


