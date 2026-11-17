package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"archcanvas/internal/dialect"
	"archcanvas/internal/domain"
	"archcanvas/pkg/id"
	"archcanvas/pkg/llmjson"

	"github.com/cloudwego/eino/schema"
)

type llmReviewSupplemental struct {
	Summary string               `json:"summary"`
	Issues  []domain.SchemaIssue `json:"issues"`
}

// ReviewPhysicalSchema Layer 3: 架构师质量与性能审查核心算子（融合确定性静态规则与可选 LLM 深度结构化洞察）
func (a *AgentService) ReviewPhysicalSchema(
	ctx context.Context,
	input ReviewSchemaInput,
	onThinking func(chunk string),
) (*domain.SchemaReviewReport, error) {
	if input.CurrentERDesign == nil || len(input.CurrentERDesign.Entities) == 0 {
		return nil, errors.New("当前画布无物理数据表，无法执行架构体检")
	}

	input.Dialect = dialect.NormalizeID(input.Dialect)

	// 1. 执行确定性静态架构规则体检
	report := performStaticSchemaReview(input.CurrentERDesign, input.Dialect)

	// 2. 若大模型可用，通过统一流式执行器获取批判审查并合并补充隐患项
	sup, _, err := executeStructuredStream(ctx, a, structuredStreamConfig[llmReviewSupplemental]{
		ModelProvider:             input.ModelProvider,
		ModelName:                 input.ModelName,
		InitialMessages:           a.buildReviewSchemaMessages(input, report),
		MaxRetries:                0,
		AllowPartialStreamOnError: true,
		OnThinking:                onThinking,
		ParseContent: func(raw string) (*llmReviewSupplemental, error) {
			if strings.TrimSpace(raw) == "" {
				return &llmReviewSupplemental{}, nil
			}
			parsed, pErr := llmjson.Parse[llmReviewSupplemental](raw, func(s *llmReviewSupplemental) error {
				if strings.TrimSpace(s.Summary) == "" && len(s.Issues) == 0 {
					return errors.New("empty supplemental review")
				}
				return nil
			})
			if pErr != nil {
				// 允许大模型仅输出自然语言点评而不附带补充 JSON 代码块
				return &llmReviewSupplemental{}, nil
			}
			return parsed, nil
		},
	})
	if err == nil {
		applyLLMReviewSupplemental(&report, sup)
		return &report, nil
	}
	if errors.Is(err, context.Canceled) || ctx.Err() != nil {
		return nil, ctx.Err()
	}

	// 3. 离线/降级模式：流式输出静态体检推演摘要
	if onThinking != nil {
		summaryThinking := fmt.Sprintf("已扫描 %d 张物理数据表与 %d 组表间关系，正在执行全方位架构审查：\n"+
			"- 主键完整性与唯一约束检验...\n"+
			"- 外键关联索引与最左前缀覆盖检查...\n"+
			"- 字段类型安全性与大字段行溢出评估...\n"+
			"- 命名规范与业务注释完备性核验...\n\n"+
			"体检执行完毕：总得分 %d/100，发现 %d 项需关注的隐患与优化建议。",
			len(input.CurrentERDesign.Entities), len(input.CurrentERDesign.Relations),
			report.Score, len(report.Issues),
		)
		onThinking(summaryThinking)
	}

	return &report, nil
}

func applyLLMReviewSupplemental(report *domain.SchemaReviewReport, sup *llmReviewSupplemental) {
	if report == nil || sup == nil || (strings.TrimSpace(sup.Summary) == "" && len(sup.Issues) == 0) {
		return
	}
	existingTitles := make(map[string]bool, len(report.Issues))
	for _, iss := range report.Issues {
		existingTitles[strings.ToLower(iss.EntityName+":"+iss.Title)] = true
	}
	added := 0
	for _, iss := range sup.Issues {
		if strings.TrimSpace(iss.Title) == "" {
			continue
		}
		key := strings.ToLower(iss.EntityName + ":" + iss.Title)
		if existingTitles[key] {
			continue
		}
		existingTitles[key] = true
		if iss.ID == "" {
			iss.ID = id.NewUUIDv7()
		}
		if iss.Severity != domain.SeverityCritical && iss.Severity != domain.SeverityWarning && iss.Severity != domain.SeverityInfo {
			iss.Severity = domain.SeverityInfo
		}
		if iss.Category == "" {
			iss.Category = domain.CategoryPerformance
		}
		report.Issues = append(report.Issues, iss)
		report.TotalCount++
		added++
	}
	if added > 0 {
		report.Score = computeReviewScore(report.Issues)
		report.PassedCount = max(report.TotalCount-len(report.Issues), 0)
	}
	if strings.TrimSpace(sup.Summary) != "" {
		report.Summary = strings.TrimSpace(sup.Summary)
	}
}

func (a *AgentService) buildReviewSchemaMessages(input ReviewSchemaInput, report domain.SchemaReviewReport) []*schema.Message {
	var prompt strings.Builder
	prompt.WriteString("你是一位资深的首席数据库架构师与 DBA（Principal Database Architect）。\n")
	prompt.WriteString("你的职责是对当前物理数据模型进行严谨、专业的质量体检（Architecture Audit），指出潜在的性能瓶颈、死锁风险或范式缺陷。\n\n")
	prompt.WriteString(fmt.Sprintf("【目标数据库】：%s\n", strings.ToUpper(input.Dialect)))
	prompt.WriteString(fmt.Sprintf("【静态检测基准得分】：%d / 100（静态规则已检出 %d 个缺陷项）\n\n", report.Score, len(report.Issues)))
	prompt.WriteString("【审查要求】：\n")
	prompt.WriteString("1. 先用严谨客观的工程语言逐表输出你的深度架构点评（将实时流式展示给用户）；\n")
	prompt.WriteString("2. 若你还发现了静态规则未覆盖的深层隐患，可在末尾附带一个 ```json 代码块，格式为 {\"summary\": \"一句话总评\", \"issues\": [{\"category\": \"performance|index|normalization|naming|type_safety\", \"severity\": \"warning|info\", \"title\": \"...\", \"description\": \"...\", \"entity_name\": \"...\", \"column_name\": \"...\", \"suggestion\": \"...\"}]}；若无额外隐患，issues 传空数组 []。\n")

	issuesJSON, _ := json.Marshal(report.Issues)
	userContent := fmt.Sprintf("【当前物理表与索引结构】：\n%s\n\n【静态规则已检测到的问题清单】：\n%s\n",
		compactERForPrompt(input.CurrentERDesign),
		string(issuesJSON),
	)

	return []*schema.Message{
		schema.SystemMessage(prompt.String()),
		schema.UserMessage(userContent),
	}
}

// performStaticSchemaReview 委托至统一的表驱动静态架构规则引擎。
func performStaticSchemaReview(design *domain.ERDesign, dialectName string) domain.SchemaReviewReport {
	return EvaluateSchemaReview(design, dialectName)
}
