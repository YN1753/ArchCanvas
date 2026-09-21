package tools

import (
	"archcanvas/internal/domain"
	"context"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"
)

const SaveERDesignToolName = "save_er_design"

// ProposeERDesignArgs 工具入参结构体（由大模型自动填入输出）
type ProposeERDesignArgs struct {
	Summary           string            `json:"summary" jsonschema:"description=数据模型设计的业务摘要与设计思路"`
	Entities          []domain.Entity   `json:"entities" jsonschema:"description=推导出的业务实体列表"`
	Relations         []domain.Relation `json:"relations" jsonschema:"description=实体之间的关联关系"`
	NeedClarification bool              `json:"need_clarification" jsonschema:"description=需求是否存在重大歧义导致无法确定设计"`
	Questions         []string          `json:"questions,omitempty" jsonschema:"description=需要用户进一步澄清确认的问题"`
}

// NewSaveERDesignTool 创建提交 ER 设计方案的工具描述及其元信息
func NewSaveERDesignTool(ctx context.Context) (tool.InvokableTool, *schema.ToolInfo, error) {
	saveTool, err := utils.InferTool(
		SaveERDesignToolName,
		"提交推导或修改后的 ER 数据模型设计方案",
		func(ctx context.Context, args ProposeERDesignArgs) (string, error) {
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
