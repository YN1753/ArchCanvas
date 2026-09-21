package service

import "archcanvas/internal/domain"

// AgentContext 业务上下文信息，便于上下文管理、多轮对话扩展和动态切换模型
type AgentContext struct {
	ProjectID       string           `json:"project_id"`
	CurrentERDesign *domain.ERDesign `json:"current_er_design,omitempty"`
	Constraints     []string         `json:"constraints,omitempty"`     // 历史已识别的永久硬约束与用户红线
	Decisions       []string         `json:"decisions,omitempty"`       // 历史已达成的核心架构与设计决策
	ModelProvider   string           `json:"model_provider,omitempty"` // 可选：指定模型提供商
	ModelName       string           `json:"model_name,omitempty"`     // 可选：指定模型名称
}

// RequirementInput 需求分析方法的纯净输入契约
type RequirementInput struct {
	ProjectID       string           `json:"project_id"`
	Message         string           `json:"message"`
	CurrentERDesign *domain.ERDesign `json:"current_er_design,omitempty"`
	Constraints     []string         `json:"constraints,omitempty"`
	Decisions       []string         `json:"decisions,omitempty"`
	ModelProvider   string           `json:"model_provider,omitempty"`
	ModelName       string           `json:"model_name,omitempty"`
}

// RequirementOutput 需求分析方法的纯净结构化输出契约
type RequirementOutput struct {
	Summary           string            `json:"summary" jsonschema:"description=数据模型设计的业务摘要与设计思路"`
	Entities          []domain.Entity   `json:"entities" jsonschema:"description=推导出的业务实体列表"`
	Relations         []domain.Relation `json:"relations" jsonschema:"description=实体之间的关联关系"`
	NeedClarification bool              `json:"need_clarification" jsonschema:"description=需求是否存在重大歧义导致无法确定设计"`
	Questions         []string          `json:"questions,omitempty" jsonschema:"description=需要用户进一步澄清确认的问题"`
}
