package tools

import (
	"archcanvas/internal/domain"
	"context"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"
)

const (
	ProposeRequirementToolName  = "propose_requirement"
	ProposeSchemaDesignToolName = "propose_schema_design"
	SaveERDesignToolName        = "save_er_design"
)

// ProposeRequirementArgs 阶段一：需求分析算子输出的结构体参数
type ProposeRequirementArgs struct {
	Summary             string                     `json:"summary" jsonschema:"description=需求理解与概念模型设计的业务摘要"`
	Concepts            []domain.BusinessConcept   `json:"concepts" jsonschema:"description=梳理出的业务概念模型列表"`
	Relations           []domain.ConceptRelation   `json:"relations" jsonschema:"description=概念之间的关联关系"`
	Assumptions         []string                   `json:"assumptions,omitempty" jsonschema:"description=推断出的业务假设"`
	NegativeConstraints []string                   `json:"negative_constraints,omitempty" jsonschema:"description=识别出的明确业务边界与非需求"`
	NeedClarification   bool                       `json:"need_clarification" jsonschema:"description=需求是否存在重大歧义导致无法确定设计"`
	ClarificationCards  []domain.ClarificationCard `json:"clarification_cards,omitempty" jsonschema:"description=宏观广泛需求下按逻辑递进排列的澄清确认卡片组"`
	Questions           []string                   `json:"questions,omitempty" jsonschema:"description=需要用户进一步澄清确认的问题"`
}

// ProposeSchemaDesignArgs 阶段二：物理建模算子输出的结构体参数
type ProposeSchemaDesignArgs struct {
	Summary   string            `json:"summary" jsonschema:"description=物理数据表设计的架构说明"`
	Entities  []domain.Entity   `json:"entities" jsonschema:"description=推导出的物理数据库表结构列表"`
	Relations []domain.Relation `json:"relations" jsonschema:"description=物理表之间的关联关系"`
}

// ProposeERDesignArgs 保持向后兼容性
type ProposeERDesignArgs = ProposeSchemaDesignArgs

// NewProposeRequirementTool 创建提交业务概念需求分析的工具
func NewProposeRequirementTool(ctx context.Context) (tool.InvokableTool, *schema.ToolInfo, error) {
	reqTool, err := utils.InferTool(
		ProposeRequirementToolName,
		"提交梳理出的业务概念模型、属性与关联关系",
		func(ctx context.Context, args ProposeRequirementArgs) (string, error) {
			return "success", nil
		},
	)
	if err != nil {
		return nil, nil, err
	}

	info, err := reqTool.Info(ctx)
	if err != nil {
		return nil, nil, err
	}

	return reqTool, info, nil
}

// NewSaveERDesignTool 创建提交物理 ER 表设计的工具
func NewSaveERDesignTool(ctx context.Context) (tool.InvokableTool, *schema.ToolInfo, error) {
	saveTool, err := utils.InferTool(
		SaveERDesignToolName,
		"提交推导或修改后的物理 ER 数据模型设计方案",
		func(ctx context.Context, args ProposeSchemaDesignArgs) (string, error) {
			return "success", nil
		},
	)
	if err != nil {
		return nil, nil, err
	}

	info, err := saveTool.Info(ctx)
	if err != nil {
		return nil, nil, err
	}

	return saveTool, info, nil
}
