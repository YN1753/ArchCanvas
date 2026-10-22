package service

import (
	"archcanvas/internal/domain"
	"strings"
	"testing"
)

func TestCheckShortInputClarification(t *testing.T) {
	tests := []struct {
		name             string
		input            RequirementInput
		expectIntercept  bool
		expectNeedClarif bool
	}{
		{
			name: "输入为空",
			input: RequirementInput{
				Message: "",
			},
			expectIntercept:  true,
			expectNeedClarif: true,
		},
		{
			name: "纯无意义打招呼",
			input: RequirementInput{
				Message: "你好",
			},
			expectIntercept:  true,
			expectNeedClarif: true,
		},
		{
			name: "过短中文需求（小于6个字符）",
			input: RequirementInput{
				Message: "商城系统",
			},
			expectIntercept:  true,
			expectNeedClarif: true,
		},
		{
			name: "过短仅包含单字动词",
			input: RequirementInput{
				Message: "登录",
			},
			expectIntercept:  true,
			expectNeedClarif: true,
		},
		{
			name: "充分的业务场景描述（不应被前置拦截）",
			input: RequirementInput{
				Message: "构建一个多租户电商订单系统，包含用户、商品信息和订单支付流转",
			},
			expectIntercept: false,
		},
		{
			name: "已有上下文概念时，短指令不应被误拦截",
			input: RequirementInput{
				Message: "加个状态",
				CurrentConceptualDesign: &domain.ConceptualDesign{
					Concepts: []domain.BusinessConcept{
						{ID: "c1", Name: "用户"},
						{ID: "c2", Name: "订单"},
					},
				},
			},
			expectIntercept: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, intercepted := checkShortInputClarification(tt.input)
			if intercepted != tt.expectIntercept {
				t.Fatalf("expected intercept=%v, got %v", tt.expectIntercept, intercepted)
			}
			if intercepted {
				if out == nil {
					t.Fatal("expected non-nil RequirementOutput when intercepted")
				}
				if out.NeedClarification != tt.expectNeedClarif {
					t.Errorf("expected NeedClarification=%v, got %v", tt.expectNeedClarif, out.NeedClarification)
				}
				if len(out.Questions) == 0 {
					t.Error("expected clarification questions, got empty")
				}
				if len(out.ClarificationCards) == 0 {
					t.Error("expected clarification cards, got empty")
				}
			}
		})
	}
}

func TestApplyConceptClarificationRules(t *testing.T) {
	input := RequirementInput{
		Message: "帮我建立一个简单的单据表",
	}

	t.Run("实体少于2个时触发门禁规则兜底", func(t *testing.T) {
		out := &RequirementOutput{
			Summary:           "识别到单据实体",
			Concepts:          []domain.BusinessConcept{{ID: "c1", Name: "单据"}},
			NeedClarification: false, // 模型误判不需要澄清
		}

		applyConceptClarificationRules(out, input)

		if !out.NeedClarification {
			t.Errorf("expected NeedClarification to be true for single concept, got false")
		}
		if len(out.Questions) == 0 {
			t.Errorf("expected rule-based questions generated, got empty")
		}
		if len(out.ClarificationCards) == 0 {
			t.Errorf("expected rule-based clarification cards generated, got empty")
		}
		if !strings.Contains(out.Summary, "门禁") {
			t.Errorf("expected summary to contain gate notice, got %s", out.Summary)
		}
	})

	t.Run("实体达到2个及以上且模型认为清晰时保持放行", func(t *testing.T) {
		out := &RequirementOutput{
			Summary: "识别到用户与订单实体",
			Concepts: []domain.BusinessConcept{
				{ID: "c1", Name: "用户"},
				{ID: "c2", Name: "订单"},
			},
			NeedClarification: false,
		}

		applyConceptClarificationRules(out, input)

		if out.NeedClarification {
			t.Errorf("expected NeedClarification to remain false, got true")
		}
	})

	t.Run("模型原本已触发澄清时保持不变", func(t *testing.T) {
		origQuestions := []string{"业务配送模式是什么？"}
		out := &RequirementOutput{
			Summary:           "需要澄清交付细节",
			Concepts:          []domain.BusinessConcept{{ID: "c1", Name: "商品"}},
			NeedClarification: true,
			Questions:         origQuestions,
		}

		applyConceptClarificationRules(out, input)

		if !out.NeedClarification {
			t.Errorf("expected NeedClarification to remain true")
		}
		if len(out.Questions) != 1 || out.Questions[0] != origQuestions[0] {
			t.Errorf("expected original questions preserved, got %v", out.Questions)
		}
	})
}
