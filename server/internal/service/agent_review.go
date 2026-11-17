package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode"

	"archcanvas/internal/domain"
	"archcanvas/pkg/id"

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

	dialect := strings.ToLower(strings.TrimSpace(input.Dialect))
	if dialect == "" {
		dialect = "mysql"
	}
	input.Dialect = dialect

	// 1. 执行确定性静态架构规则体检
	report := performStaticSchemaReview(input.CurrentERDesign, dialect)

	// 2. 若大模型可用，唤起架构师批判审查并吸收其补充的结构化隐患项与总结评语
	if a.ModelManager != nil {
		chatModel, err := a.ModelManager.GetModel(ctx, input.ModelProvider, input.ModelName)
		if err == nil {
			messages := a.buildReviewSchemaMessages(input, report)
			stream, err := chatModel.Stream(ctx, messages)
			if err == nil {
				defer stream.Close()
				var llmRaw strings.Builder

				for {
					select {
					case <-ctx.Done():
						return nil, ctx.Err()
					default:
					}
					chunk, err := stream.Recv()
					if errors.Is(err, io.EOF) {
						break
					}
					if err != nil {
						if errors.Is(err, context.Canceled) || ctx.Err() != nil {
							return nil, ctx.Err()
						}
						break
					}

					if chunk.Content != "" {
						llmRaw.WriteString(chunk.Content)
						if onThinking != nil {
							onThinking(chunk.Content)
						}
					}
				}

				mergeLLMReviewIntoReport(&report, llmRaw.String())
				return &report, nil
			}
		}
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

func mergeLLMReviewIntoReport(report *domain.SchemaReviewReport, raw string) {
	if report == nil || strings.TrimSpace(raw) == "" {
		return
	}
	candidates := extractJSONCandidates(raw)
	for _, cand := range candidates {
		cleaned := CleanJSONSyntax(cand)
		var sup llmReviewSupplemental
		if err := json.Unmarshal([]byte(cleaned), &sup); err == nil && (sup.Summary != "" || len(sup.Issues) > 0) {
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
			return
		}
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

func hasUpperASCII(s string) bool {
	for _, r := range s {
		if r >= 'A' && r <= 'Z' || unicode.IsUpper(r) {
			return true
		}
	}
	return false
}

func computeReviewScore(issues []domain.SchemaIssue) int {
	deduction := 0
	for _, issue := range issues {
		switch issue.Severity {
		case domain.SeverityCritical:
			deduction += 20
		case domain.SeverityWarning:
			deduction += 8
		case domain.SeverityInfo:
			deduction += 2
		}
	}
	score := 100 - deduction
	if score < 0 {
		return 0
	}
	return score
}

// performStaticSchemaReview 针对物理表与索引结构执行静态深度体检（按实际执行的检查项精确统计 TotalCount，确保 PassedCount 永不失真）。
func performStaticSchemaReview(design *domain.ERDesign, dialect string) domain.SchemaReviewReport {
	_ = dialect
	issues := make([]domain.SchemaIssue, 0)
	totalChecks := 0

	entityKeyMap := make(map[string]bool, len(design.Entities)*2)
	for _, e := range design.Entities {
		entityKeyMap[e.ID] = true
		if e.Name != "" {
			entityKeyMap[strings.ToLower(strings.TrimSpace(e.Name))] = true
		}
	}

	for _, entity := range design.Entities {
		// 1. 主键完整性审查 (1 项)
		totalChecks++
		hasPK := false
		for _, attr := range entity.Attributes {
			if attr.IsPrimaryKey {
				hasPK = true
				break
			}
		}
		if !hasPK {
			issues = append(issues, domain.SchemaIssue{
				ID:          id.NewUUIDv7(),
				Category:    domain.CategoryTypeSafety,
				Severity:    domain.SeverityCritical,
				Title:       fmt.Sprintf("数据表 %q 缺失主键定义", entity.Name),
				Description: fmt.Sprintf("数据表 %q 缺少主键，会导致无法唯一定位行记录，并在集群复制、分库分表或事务并发时引发严重隐患。", entity.Name),
				EntityName:  entity.Name,
				Suggestion:  "为该表增加名为 `id` 的主键列 (如 BIGINT 或 UUIDv7)。",
			})
		}

		// 2. 外键索引盲区审查（每个外键候选列计 1 项检查）
		for _, attr := range entity.Attributes {
			isForeignKeyCandidate := strings.HasSuffix(strings.ToLower(attr.Name), "_id") && !attr.IsPrimaryKey
			if isForeignKeyCandidate {
				totalChecks++
				hasIndex := false
				for _, idx := range entity.Indexes {
					if len(idx.Columns) > 0 && strings.EqualFold(idx.Columns[0], attr.Name) {
						hasIndex = true
						break
					}
				}
				if !hasIndex {
					issues = append(issues, domain.SchemaIssue{
						ID:          id.NewUUIDv7(),
						Category:    domain.CategoryIndex,
						Severity:    domain.SeverityWarning,
						Title:       fmt.Sprintf("外键字段 %q 缺少关联索引", attr.Name),
						Description: fmt.Sprintf("表 %q 的外键列 %q 未被任何索引的最左前缀覆盖。多表 JOIN 或外键关联检索时将退化为全表扫描，并在更新时极易引发表级锁升级与并发死锁。", entity.Name, attr.Name),
						EntityName:  entity.Name,
						ColumnName:  attr.Name,
						Suggestion:  fmt.Sprintf("为字段 %q 建立单列索引或将其置于联合索引第一列：idx_%s_%s", attr.Name, entity.Name, attr.Name),
					})
				}
			}
		}

		// 3. 命名规范与蛇形命名审查 (1 项：覆盖空格、连字符、全大写及驼峰表名)
		totalChecks++
		if strings.ContainsAny(entity.Name, " -") || hasUpperASCII(entity.Name) {
			issues = append(issues, domain.SchemaIssue{
				ID:          id.NewUUIDv7(),
				Category:    domain.CategoryNaming,
				Severity:    domain.SeverityInfo,
				Title:       fmt.Sprintf("数据表命名 %q 不符合小写蛇形规范", entity.Name),
				Description: fmt.Sprintf("表名 %q 建议统一采用小写蛇形命名（snake_case），避免跨操作系统（如 Linux 与 Windows）大小写敏感差异引发的部署问题。", entity.Name),
				EntityName:  entity.Name,
				Suggestion:  fmt.Sprintf("建议将表名重命名为小写规范名：%s", toSnakeCaseIdentifier(entity.Name)),
			})
		}

		// 4. 业务中文注释完备性审查 (1 项)
		totalChecks++
		if strings.TrimSpace(entity.Comment) == "" {
			issues = append(issues, domain.SchemaIssue{
				ID:          id.NewUUIDv7(),
				Category:    domain.CategoryNaming,
				Severity:    domain.SeverityInfo,
				Title:       fmt.Sprintf("数据表 %q 缺少业务中文注释", entity.Name),
				Description: fmt.Sprintf("数据表 %q 缺少中文业务说明，不利于团队协作、数据字典维护与生产 SQL COMMENT 导出。", entity.Name),
				EntityName:  entity.Name,
				Suggestion:  "在表配置中补充明确的业务领域中文释义。",
			})
		}

		// 5. 存储行溢出与金额字段精度隐患审查
		textColCount := 0
		for _, attr := range entity.Attributes {
			t := strings.ToUpper(attr.DBType)
			if strings.Contains(t, "TEXT") || strings.Contains(t, "BLOB") {
				textColCount++
			}

			lowerName := strings.ToLower(attr.Name)
			if strings.Contains(lowerName, "price") || strings.Contains(lowerName, "amount") || strings.Contains(lowerName, "fee") || strings.Contains(lowerName, "cost") {
				totalChecks++
				if strings.Contains(t, "FLOAT") || strings.Contains(t, "DOUBLE") {
					issues = append(issues, domain.SchemaIssue{
						ID:          id.NewUUIDv7(),
						Category:    domain.CategoryTypeSafety,
						Severity:    domain.SeverityWarning,
						Title:       fmt.Sprintf("金额字段 %q 存在浮点数精度风险", attr.Name),
						Description: fmt.Sprintf("表 %q 的金额字段 %q 当前类型为 %s，浮点数运算存在二进制精度截断问题，禁止用于金融财务场景。", entity.Name, attr.Name, attr.DBType),
						EntityName:  entity.Name,
						ColumnName:  attr.Name,
						Suggestion:  "将该字段类型修改为高精度的 DECIMAL(10,2) 或 NUMERIC(10,2)。",
					})
				}
			}
		}

		totalChecks++
		if textColCount >= 3 {
			issues = append(issues, domain.SchemaIssue{
				ID:          id.NewUUIDv7(),
				Category:    domain.CategoryPerformance,
				Severity:    domain.SeverityWarning,
				Title:       fmt.Sprintf("数据表 %q 包含过多大文本字段", entity.Name),
				Description: fmt.Sprintf("表 %q 包含了 %d 个 TEXT/BLOB 大字段，极易导致单行超过数据页大小（如 8KB/16KB）并触发行溢出（Row Overflow），大幅降低主索引页缓存命中率。", entity.Name, textColCount),
				EntityName:  entity.Name,
				Suggestion:  "建议将富文本或大描述字段垂直分表拆分到独立的扩展附表中按需懒加载。",
			})
		}
	}

	// 6. 关系完整性审查：检查悬空关系（同时支持 ID 与表名引用）
	for _, rel := range design.Relations {
		totalChecks++
		srcKey := strings.TrimSpace(rel.SourceEntityID)
		tgtKey := strings.TrimSpace(rel.TargetEntityID)
		srcOK := entityKeyMap[srcKey] || entityKeyMap[strings.ToLower(srcKey)]
		tgtOK := entityKeyMap[tgtKey] || entityKeyMap[strings.ToLower(tgtKey)]
		if !srcOK || !tgtOK {
			issues = append(issues, domain.SchemaIssue{
				ID:          id.NewUUIDv7(),
				Category:    domain.CategoryNormalization,
				Severity:    domain.SeverityCritical,
				Title:       "检测到悬空关联关系",
				Description: fmt.Sprintf("关系 %s 引用的源实体或目标实体在物理表中不存在，会导致外键生成失败。", rel.ID),
				Suggestion:  "清理废弃的关联关系或重新绑定正确的实体。",
			})
		}
	}

	score := computeReviewScore(issues)

	summary := "物理数据模型架构非常规范，未发现重大结构缺陷与性能风险！"
	if score < 60 {
		summary = "存在重大架构缺陷（如缺失主键或悬空关联），强烈建议采纳修复方案后再行建表上线。"
	} else if score < 85 {
		summary = "物理模型基本合格，但存在若干性能隐患（如外键缺失索引覆盖或金额类型精度问题），建议优化。"
	}

	passedCount := max(totalChecks-len(issues), 0)

	return domain.SchemaReviewReport{
		Score:       score,
		Summary:     summary,
		PassedCount: passedCount,
		TotalCount:  totalChecks,
		Issues:      issues,
	}
}
