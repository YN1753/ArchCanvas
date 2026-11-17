package service

import (
	"archcanvas/internal/domain"
	"fmt"
	"strings"
)

func isRequirementOutputValid(out *RequirementOutput) bool {
	if out == nil {
		return false
	}
	return len(out.Concepts) > 0 || out.NeedClarification || len(out.ClarificationCards) > 0 || len(out.Questions) > 0
}

func hasExistingProjectSchema(input RequirementInput) bool {
	if input.CurrentConceptualDesign != nil && len(input.CurrentConceptualDesign.Concepts) > 0 {
		return true
	}
	if input.CurrentERDesign != nil && len(input.CurrentERDesign.Entities) > 0 {
		return true
	}
	return len(input.HistoryMessages) > 1
}

// checkShortInputClarification 针对无上下文情况下的过短或空泛输入执行前置规则拦截（避免误伤长 PRD 与已有物理表上的增量短指令）。
func checkShortInputClarification(input RequirementInput) (*RequirementOutput, bool) {
	trimmed := strings.TrimSpace(input.Message)
	runeLen := len([]rune(trimmed))

	if trimmed == "" {
		return buildShortInputClarificationOutput(trimmed), true
	}

	if hasExistingProjectSchema(input) {
		return nil, false
	}

	lower := strings.ToLower(trimmed)
	isGreeting := lower == "你好" || lower == "hello" || lower == "hi" || lower == "在吗" || lower == "在么" || lower == "666"
	hasShortQuestion := runeLen <= 20 && (strings.Contains(trimmed, "有哪些") || strings.Contains(trimmed, "是什么") || strings.Contains(trimmed, "怎么做"))
	isIncompleteFragment := runeLen < 20 && strings.Contains(trimmed, "中的") &&
		!strings.Contains(trimmed, "包含") && !strings.Contains(trimmed, "记录") && !strings.Contains(trimmed, "支持")

	if runeLen <= 8 || isGreeting || hasShortQuestion || isIncompleteFragment {
		return buildShortInputClarificationOutput(trimmed), true
	}

	return nil, false
}

func buildShortInputClarificationOutput(trimmed string) *RequirementOutput {
	summary := fmt.Sprintf("需求描述「%s」较为简略，缺少具体业务场景与主体对象。", trimmed)
	if trimmed == "" {
		summary = "需求输入为空，请描述您希望构建的系统业务场景与核心对象。"
	}
	return &RequirementOutput{
		Summary:           summary,
		Concepts:          []domain.BusinessConcept{},
		Relations:         []domain.ConceptRelation{},
		NeedClarification: true,
		Questions: []string{
			"请问本系统面向的具体业务场景是什么？",
			"系统中有哪些核心实体角色（如用户、商品、订单等）？",
			"各实体之间存在怎样的业务流转或交互关系？",
		},
		ClarificationCards: []domain.ClarificationCard{
			{
				ID:          "business_scope",
				Title:       "业务场景与核心主体确认",
				Description: "请先明确系统面向的行业与核心业务对象",
				Options: []domain.ClarificationOption{
					{ID: "ecommerce", Label: "电商交易类系统", Description: "包含用户、商品、订单、支付等核心实体", IsDefault: true},
					{ID: "management", Label: "企业后台管理系统", Description: "包含组织架构、账号角色、权限、审计日志等", IsDefault: false},
					{ID: "content", Label: "内容社区类平台", Description: "包含创作者、文章内容、评论互动、点赞关注等", IsDefault: false},
				},
			},
		},
	}
}

// applyConceptClarificationRules 检查模型输出结果：全新空白项目若提取出的概念少于 2 个且尚未触发澄清，叠加决策门禁；已有模型的增量修改则正常放行。
func applyConceptClarificationRules(reqOutput *RequirementOutput, input RequirementInput) {
	if reqOutput == nil || reqOutput.NeedClarification {
		return
	}

	if hasExistingProjectSchema(input) && len(reqOutput.Concepts) >= 1 {
		return
	}

	if len(reqOutput.Concepts) < 2 {
		reqOutput.NeedClarification = true
		if len(reqOutput.Questions) == 0 {
			conceptName := "当前实体"
			if len(reqOutput.Concepts) == 1 {
				conceptName = reqOutput.Concepts[0].Name
			}
			reqOutput.Questions = []string{
				fmt.Sprintf("系统当前仅梳理出单个实体（%s），请问该实体由哪些主体操作，或会产生哪些业务记录/明细表？", conceptName),
				"是否存在需要与之关联的用户角色、状态流转记录或分类字典？",
			}
		}
		if len(reqOutput.ClarificationCards) == 0 {
			reqOutput.ClarificationCards = []domain.ClarificationCard{
				{
					ID:          "entity_expansion",
					Title:       "模型关联主体拓展",
					Description: "单一业务实体难以构成闭环业务系统，建议扩充关联实体",
					Options: []domain.ClarificationOption{
						{ID: "add_user_tracking", Label: "补充操作主体（如用户/管理员表）", Description: "记录实体的创建人、维护人与权限归属", IsDefault: true},
						{ID: "add_detail_log", Label: "补充业务明细或流转记录", Description: "按操作时间或流转状态拆分主从表或记录流水", IsDefault: false},
					},
				},
			}
		}
		if !strings.Contains(reqOutput.Summary, "门禁") {
			reqOutput.Summary += "（关键实体少于 2 个，已触发代码层决策门禁，建议补充关联对象）"
		}
	}
}
