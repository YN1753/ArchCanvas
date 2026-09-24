package service

import (
	"archcanvas/internal/domain"
	"archcanvas/internal/model"
)

// 类型别名重新导出，方便 service 外部或内部直接引用
type ConceptOperation = domain.ConceptOperation

const (
	OpCreate = domain.OpCreate
	OpModify = domain.OpModify
	OpRetain = domain.OpRetain
	OpDelete = domain.OpDelete
)

type ConceptCardinality = domain.ConceptCardinality

const (
	CardOneToOne   = domain.CardOneToOne
	CardOneToMany  = domain.CardOneToMany
	CardManyToMany = domain.CardManyToMany
)

type AttributeCategory = domain.AttributeCategory

const (
	AttrString   = domain.AttrString
	AttrNumber   = domain.AttrNumber
	AttrBoolean  = domain.AttrBoolean
	AttrDateTime = domain.AttrDateTime
	AttrEnum     = domain.AttrEnum
	AttrMedia    = domain.AttrMedia
)

type ConceptAttribute = domain.ConceptAttribute
type BusinessConcept = domain.BusinessConcept
type ConceptRelation = domain.ConceptRelation
type ClarificationOption = domain.ClarificationOption
type ClarificationCard = domain.ClarificationCard

// AgentContext 业务上下文信息
type AgentContext struct {
	ProjectID       string           `json:"project_id"`
	CurrentERDesign *domain.ERDesign `json:"current_er_design,omitempty"`
	Constraints     []string         `json:"constraints,omitempty"`     // 历史已识别的永久硬约束与用户红线
	Decisions       []string         `json:"decisions,omitempty"`       // 历史已达成的核心架构与设计决策
	ModelProvider   string           `json:"model_provider,omitempty"` // 可选：指定模型提供商
	ModelName       string           `json:"model_name,omitempty"`     // 可选：指定模型名称
}

// RequirementInput 需求分析算子的输入契约
type RequirementInput struct {
	ProjectID       string           `json:"project_id"`
	Message         string           `json:"message"`
	HistoryMessages []model.Message `json:"history_messages,omitempty"`
	CurrentERDesign *domain.ERDesign `json:"current_er_design,omitempty"`
	Constraints     []string         `json:"constraints,omitempty"`
	Decisions       []string         `json:"decisions,omitempty"`
	ModelProvider   string           `json:"model_provider,omitempty"`
	ModelName       string           `json:"model_name,omitempty"`
}

// RequirementOutput 需求分析算子的纯净业务结构化输出契约
type RequirementOutput struct {
	Summary             string                     `json:"summary" jsonschema:"description=需求理解与概念模型设计的业务摘要"`
	Concepts            []domain.BusinessConcept   `json:"concepts" jsonschema:"description=梳理出的业务概念模型列表"`
	Relations           []domain.ConceptRelation   `json:"relations" jsonschema:"description=概念之间的关联关系"`
	Assumptions         []string                   `json:"assumptions,omitempty" jsonschema:"description=推断出的业务假设"`
	NegativeConstraints []string                   `json:"negative_constraints,omitempty" jsonschema:"description=识别出的明确业务边界与非需求"`
	NeedClarification   bool                       `json:"need_clarification" jsonschema:"description=需求是否存在重大歧义导致无法确定设计"`
	ClarificationCards  []domain.ClarificationCard `json:"clarification_cards,omitempty" jsonschema:"description=宏观广泛需求下按逻辑递进排列的澄清确认卡片组"`
	Questions           []string                   `json:"questions,omitempty" jsonschema:"description=需要用户进一步澄清确认的问题"`
}

// SchemaDesignInput 物理建模算子的输入契约
type SchemaDesignInput struct {
	Requirement     *RequirementOutput `json:"requirement"`
	CurrentERDesign *domain.ERDesign   `json:"current_er_design,omitempty"`
	ModelProvider   string             `json:"model_provider,omitempty"`
	ModelName       string             `json:"model_name,omitempty"`
}
