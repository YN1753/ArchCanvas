package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"archcanvas/internal/domain"
	"archcanvas/pkg/id"

	"github.com/cloudwego/eino/schema"
)

// ReviewPhysicalSchema Layer 3: 架构师质量与性能审查核心算子
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
	staticReport := performStaticSchemaReview(input.CurrentERDesign, dialect)

	// 2. 若大模型可用，唤起架构师批判审查（LLM Critic）以产出专业洞见与流式思考
	if a.ModelManager != nil {
		chatModel, err := a.ModelManager.GetModel(ctx, input.ModelProvider, input.ModelName)
		if err == nil {
			messages := a.buildReviewSchemaMessages(input, staticReport)
			stream, err := chatModel.Stream(ctx, messages)
			if err == nil {
				defer stream.Close()

				for {
					chunk, err := stream.Recv()
					if errors.Is(err, io.EOF) {
						break
					}
					if err != nil {
						break
					}

					if chunk.Content != "" && onThinking != nil {
						onThinking(chunk.Content)
					}
				}

				return &staticReport, nil
			}
		}
	}

	// 3. 降级模式：流式输出静态体检推演摘要
	if onThinking != nil {
		summaryThinking := fmt.Sprintf("已扫描 %d 张物理数据表与 %d 组表间关系，正在执行全方位架构审查：\n"+
			"- 主键完整性与唯一约束检验...\n"+
			"- 外键关联索引与最左前缀覆盖检查...\n"+
			"- 字段类型安全性与大字段行溢出评估...\n"+
			"- 命名规范与业务注释完备性核验...\n\n"+
			"体检执行完毕：总得分 %d/100，发现 %d 项需关注的隐患与优化建议。",
			len(input.CurrentERDesign.Entities), len(input.CurrentERDesign.Relations),
			staticReport.Score, len(staticReport.Issues),
		)
		onThinking(summaryThinking)
	}

	return &staticReport, nil
}

// buildReviewSchemaMessages 组装 Layer 3 架构审查 Prompt
func (a *AgentService) buildReviewSchemaMessages(input ReviewSchemaInput, report domain.SchemaReviewReport) []*schema.Message {
	var prompt strings.Builder
	prompt.WriteString("你是一位资深的首席数据库架构师与 DBA（Principal Database Architect）。\n")
	prompt.WriteString("你的职责是对当前物理数据模型进行严谨、专业的质量体检（Architecture Audit），指出潜在的性能瓶颈、死锁风险或范式缺陷。\n\n")

	prompt.WriteString(fmt.Sprintf("【目标数据库】：%s\n", strings.ToUpper(input.Dialect)))
	prompt.WriteString(fmt.Sprintf("【静态检测得分】：%d / 100（检测出 %d 个具体缺陷项）\n\n", report.Score, len(report.Issues)))

	prompt.WriteString("【审查要求】：\n")
	prompt.WriteString("1. 请用严谨、客观、工程化的语言逐表分析当前物理设计的优缺点；\n")
	prompt.WriteString("2. 重点点评外键索引覆盖情况、数据类型精细度（如金额字段是否使用精度安全的类型）以及单表大字段对 Buffer Pool 命中率的影响；\n")
	prompt.WriteString("3. 提出切实可行的调优行动建议；\n")
	prompt.WriteString("4. 请直接输出你的架构师思考推导与深度评述过程。\n\n")

	erJSON, _ := json.Marshal(input.CurrentERDesign)
	issuesJSON, _ := json.Marshal(report.Issues)

	userContent := fmt.Sprintf("【当前物理表与索引结构】：\n%s\n\n【静态规则检测到的问题清单】：\n%s\n", string(erJSON), string(issuesJSON))

	return []*schema.Message{
		schema.SystemMessage(prompt.String()),
		schema.UserMessage(userContent),
	}
}

// performStaticSchemaReview 针对物理表与索引结构执行静态深度体检
func performStaticSchemaReview(design *domain.ERDesign, dialect string) domain.SchemaReviewReport {
	issues := make([]domain.SchemaIssue, 0)
	totalChecks := 0

	entityIDMap := make(map[string]bool, len(design.Entities))
	for _, e := range design.Entities {
		entityIDMap[e.ID] = true
	}

	for _, entity := range design.Entities {
		totalChecks += 5

		// 1. 主键完整性审查
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

		// 2. 外键索引盲区审查（检查 xxx_id 列是否被索引的最左前缀覆盖）
		for _, attr := range entity.Attributes {
			isForeignKeyCandidate := strings.HasSuffix(strings.ToLower(attr.Name), "_id") && !attr.IsPrimaryKey
			if isForeignKeyCandidate {
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

		// 3. 命名规范与蛇形命名审查
		if strings.ContainsAny(entity.Name, " -") || strings.ToUpper(entity.Name) == entity.Name && len(entity.Name) > 3 {
			issues = append(issues, domain.SchemaIssue{
				ID:          id.NewUUIDv7(),
				Category:    domain.CategoryNaming,
				Severity:    domain.SeverityInfo,
				Title:       fmt.Sprintf("数据表命名 %q 不符合小写蛇形规范", entity.Name),
				Description: fmt.Sprintf("表名 %q 建议统一采用小写蛇形命名（snake_case），避免跨操作系统（如 Linux 与 Windows）大小写敏感差异引发的部署问题。", entity.Name),
				EntityName:  entity.Name,
				Suggestion:  fmt.Sprintf("建议将表名重命名为小写规范名：%s", strings.ToLower(strings.ReplaceAll(entity.Name, " ", "_"))),
			})
		}

		// 4. 业务中文注释完备性审查
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

		// 5. 存储与行溢出性能隐患审查
		textColCount := 0
		for _, attr := range entity.Attributes {
			t := strings.ToUpper(attr.DBType)
			if strings.Contains(t, "TEXT") || strings.Contains(t, "BLOB") {
				textColCount++
			}

			// 检查金额字段浮点数精度风险
			lowerName := strings.ToLower(attr.Name)
			if strings.Contains(lowerName, "price") || strings.Contains(lowerName, "amount") || strings.Contains(lowerName, "fee") || strings.Contains(lowerName, "cost") {
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

	// 6. 关系完整性审查：检查悬空关系
	for _, rel := range design.Relations {
		totalChecks++
		if !entityIDMap[rel.SourceEntityID] || !entityIDMap[rel.TargetEntityID] {
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

	// 计算健康度评分：满分 100，Critical 扣 20，Warning 扣 8，Info 扣 2
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
		score = 0
	}

	summary := "物理数据模型架构非常规范，未发现重大结构缺陷与性能风险！"
	if score < 60 {
		summary = "存在重大架构缺陷（如缺失主键或悬空关联），强烈建议采纳修复方案后再行建表上线。"
	} else if score < 85 {
		summary = "物理模型基本合格，但存在若干性能隐患（如外键缺失索引覆盖或金额类型精度问题），建议优化。"
	}

	passedCount := totalChecks - len(issues)
	if passedCount < 0 {
		passedCount = 0
	}

	return domain.SchemaReviewReport{
		Score:       score,
		Summary:     summary,
		PassedCount: passedCount,
		TotalCount:  totalChecks,
		Issues:      issues,
	}
}
