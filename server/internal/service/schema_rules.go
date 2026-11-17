package service

import (
	"fmt"
	"strings"
	"unicode"

	"archcanvas/internal/dialect"
	"archcanvas/internal/domain"
	"archcanvas/pkg/id"
	"archcanvas/pkg/naming"
)

// SchemaRuleScope 标识静态规则适用的执行场景（架构体检评分 vs 基准门禁阻断）。
type SchemaRuleScope uint8

const (
	RuleScopeReview SchemaRuleScope = 1 << iota
	RuleScopeGate
	RuleScopeAll = RuleScopeReview | RuleScopeGate
)

// SchemaEvalContext 封装静态架构规则执行所需的共享只读上下文。
type SchemaEvalContext struct {
	Design  *domain.ERDesign
	Dialect dialect.Spec
	Lookup  map[string]*domain.Entity
}

// SchemaRuleResult 表示单条静态规则的检查计数与命中的缺陷列表。
type SchemaRuleResult struct {
	Checks int
	Issues []domain.SchemaIssue
}

// SchemaRule 声明式静态架构规则定义（新增规则仅需在 defaultSchemaRules 追加一项，满足开闭原则 OCP）。
type SchemaRule struct {
	ID          string
	Description string
	Scope       SchemaRuleScope
	Check       func(ctx SchemaEvalContext) SchemaRuleResult
}

var defaultSchemaRules = []SchemaRule{
	{
		ID:          "entity_non_empty_attributes",
		Description: "实体表必须包含至少一个物理字段",
		Scope:       RuleScopeGate,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, entity := range ctx.Design.Entities {
				res.Checks++
				if len(entity.Attributes) == 0 {
					res.Issues = append(res.Issues, domain.SchemaIssue{
						ID:          id.NewUUIDv7(),
						Category:    domain.CategoryTypeSafety,
						Severity:    domain.SeverityCritical,
						Title:       fmt.Sprintf("实体 %s 字段列表为空", entity.Name),
						Description: fmt.Sprintf("实体 %s 字段列表为空", entity.Name),
						EntityName:  entity.Name,
						Suggestion:  "为实体补充主键与核心业务字段。",
					})
				}
			}
			return res
		},
	},
	{
		ID:          "primary_key_integrity",
		Description: "每张物理表必须声明非空主键",
		Scope:       RuleScopeAll,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, entity := range ctx.Design.Entities {
				res.Checks++
				hasPK := false
				for _, attr := range entity.Attributes {
					if attr.IsPrimaryKey {
						hasPK = true
						if attr.IsNullable {
							res.Issues = append(res.Issues, domain.SchemaIssue{
								ID:          id.NewUUIDv7(),
								Category:    domain.CategoryTypeSafety,
								Severity:    domain.SeverityCritical,
								Title:       fmt.Sprintf("数据表 %q 主键列 %q 不允许为 Nullable", entity.Name, attr.Name),
								Description: fmt.Sprintf("实体 %s 主键列 %s 不允许为 Nullable", entity.Name, attr.Name),
								EntityName:  entity.Name,
								ColumnName:  attr.Name,
								Suggestion:  "将主键列的 `is_nullable` 修正为 `false`。",
							})
						}
					}
				}
				if !hasPK {
					res.Issues = append(res.Issues, domain.SchemaIssue{
						ID:          id.NewUUIDv7(),
						Category:    domain.CategoryTypeSafety,
						Severity:    domain.SeverityCritical,
						Title:       fmt.Sprintf("数据表 %q 缺失主键定义", entity.Name),
						Description: fmt.Sprintf("数据表 %q 缺少主键，会导致无法唯一定位行记录，并在集群复制、分库分表或事务并发时引发严重隐患。", entity.Name),
						EntityName:  entity.Name,
						Suggestion:  "为该表增加名为 `id` 的主键列 (如 BIGINT 或 UUIDv7)。",
					})
				}
			}
			return res
		},
	},
	{
		ID:          "foreign_key_index_coverage",
		Description: "外键候选列 (*_id) 应被单列索引或复合索引最左前缀覆盖",
		Scope:       RuleScopeReview,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, entity := range ctx.Design.Entities {
				for _, attr := range entity.Attributes {
					if !strings.HasSuffix(strings.ToLower(attr.Name), "_id") || attr.IsPrimaryKey {
						continue
					}
					res.Checks++
					hasIndex := false
					for _, idx := range entity.Indexes {
						if len(idx.Columns) > 0 && strings.EqualFold(idx.Columns[0], attr.Name) {
							hasIndex = true
							break
						}
					}
					if !hasIndex {
						res.Issues = append(res.Issues, domain.SchemaIssue{
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
			return res
		},
	},
	{
		ID:          "table_snake_case_naming",
		Description: "物理表名应遵循小写蛇形命名规范 (snake_case)",
		Scope:       RuleScopeReview,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, entity := range ctx.Design.Entities {
				res.Checks++
				if strings.ContainsAny(entity.Name, " -") || hasUpperASCII(entity.Name) {
					res.Issues = append(res.Issues, domain.SchemaIssue{
						ID:          id.NewUUIDv7(),
						Category:    domain.CategoryNaming,
						Severity:    domain.SeverityInfo,
						Title:       fmt.Sprintf("数据表命名 %q 不符合小写蛇形规范", entity.Name),
						Description: fmt.Sprintf("表名 %q 建议统一采用小写蛇形命名（snake_case），避免跨操作系统（如 Linux 与 Windows）大小写敏感差异引发的部署问题。", entity.Name),
						EntityName:  entity.Name,
						Suggestion:  fmt.Sprintf("建议将表名重命名为小写规范名：%s", naming.ToSnakeCase(entity.Name)),
					})
				}
			}
			return res
		},
	},
	{
		ID:          "table_comment_completeness",
		Description: "物理表应具备清晰的业务中文注释",
		Scope:       RuleScopeReview,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, entity := range ctx.Design.Entities {
				res.Checks++
				if strings.TrimSpace(entity.Comment) == "" {
					res.Issues = append(res.Issues, domain.SchemaIssue{
						ID:          id.NewUUIDv7(),
						Category:    domain.CategoryNaming,
						Severity:    domain.SeverityInfo,
						Title:       fmt.Sprintf("数据表 %q 缺少业务中文注释", entity.Name),
						Description: fmt.Sprintf("数据表 %q 缺少中文业务说明，不利于团队协作、数据字典维护与生产 SQL COMMENT 导出。", entity.Name),
						EntityName:  entity.Name,
						Suggestion:  "在表配置中补充明确的业务领域中文释义。",
					})
				}
			}
			return res
		},
	},
	{
		ID:          "monetary_precision_safety",
		Description: "金额/余额类字段严禁使用 FLOAT/DOUBLE 二进制浮点数",
		Scope:       RuleScopeReview,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, entity := range ctx.Design.Entities {
				for _, attr := range entity.Attributes {
					if !IsMonetaryColumnName(attr.Name) {
						continue
					}
					res.Checks++
					upperType := strings.ToUpper(attr.DBType)
					if strings.Contains(upperType, "FLOAT") || strings.Contains(upperType, "DOUBLE") {
						res.Issues = append(res.Issues, domain.SchemaIssue{
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
			return res
		},
	},
	{
		ID:          "row_overflow_large_columns",
		Description: "单表包含过多 TEXT/BLOB 大字段易引发数据页行溢出",
		Scope:       RuleScopeReview,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, entity := range ctx.Design.Entities {
				res.Checks++
				textColCount := 0
				for _, attr := range entity.Attributes {
					upperType := strings.ToUpper(attr.DBType)
					if strings.Contains(upperType, "TEXT") || strings.Contains(upperType, "BLOB") {
						textColCount++
					}
				}
				if textColCount >= 3 {
					res.Issues = append(res.Issues, domain.SchemaIssue{
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
			return res
		},
	},
	{
		ID:          "dialect_type_compatibility",
		Description: "字段物理类型应与目标数据库方言原生语法兼容",
		Scope:       RuleScopeReview,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, entity := range ctx.Design.Entities {
				for _, attr := range entity.Attributes {
					if strings.TrimSpace(attr.DBType) == "" {
						continue
					}
					res.Checks++
					if forbidden, matched := ctx.Dialect.MatchForbiddenType(attr.DBType); matched {
						res.Issues = append(res.Issues, domain.SchemaIssue{
							ID:          id.NewUUIDv7(),
							Category:    domain.CategoryTypeSafety,
							Severity:    domain.SeverityWarning,
							Title:       fmt.Sprintf("字段 %q 的类型 %q 与 %s 方言不兼容", attr.Name, attr.DBType, ctx.Dialect.DisplayName),
							Description: fmt.Sprintf("表 %q 的字段 %q 使用了与目标数据库 %s 不兼容的异构方言语法 (%s)。", entity.Name, attr.Name, ctx.Dialect.DisplayName, forbidden.Pattern),
							EntityName:  entity.Name,
							ColumnName:  attr.Name,
							Suggestion:  forbidden.Suggestion,
						})
					}
				}
			}
			return res
		},
	},
	{
		ID:          "relation_endpoint_integrity",
		Description: "关系引用的源实体与目标实体必须在物理模型中合法存在",
		Scope:       RuleScopeAll,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, rel := range ctx.Design.Relations {
				res.Checks++
				_, srcOK := ctx.Design.FindEntity(rel.SourceEntityID, ctx.Lookup)
				_, tgtOK := ctx.Design.FindEntity(rel.TargetEntityID, ctx.Lookup)
				if !srcOK || !tgtOK {
					res.Issues = append(res.Issues, domain.SchemaIssue{
						ID:          id.NewUUIDv7(),
						Category:    domain.CategoryNormalization,
						Severity:    domain.SeverityCritical,
						Title:       "检测到悬空关联关系",
						Description: fmt.Sprintf("关系 %s 引用的源实体或目标实体在物理表中不存在 (%s -> %s)，会导致外键生成失败。", rel.ID, rel.SourceEntityID, rel.TargetEntityID),
						Suggestion:  "清理废弃的关联关系或重新绑定正确的实体。",
					})
				}
			}
			return res
		},
	},
	{
		ID:          "relation_foreign_key_presence",
		Description: "1:N 与 1:1 关联关系的目标表应落盘对应的 *_id 外键列",
		Scope:       RuleScopeGate,
		Check: func(ctx SchemaEvalContext) SchemaRuleResult {
			var res SchemaRuleResult
			for _, rel := range ctx.Design.Relations {
				srcEnt, srcOK := ctx.Design.FindEntity(rel.SourceEntityID, ctx.Lookup)
				tgtEnt, tgtOK := ctx.Design.FindEntity(rel.TargetEntityID, ctx.Lookup)
				if !srcOK || !tgtOK {
					continue
				}
				card := rel.EffectiveCardinality()
				if card != "one_to_many" && card != "one_to_one" {
					continue
				}
				res.Checks++
				hasFK := false
				for _, attr := range tgtEnt.Attributes {
					if strings.HasSuffix(strings.ToLower(attr.Name), "_id") && !attr.IsPrimaryKey {
						hasFK = true
						break
					}
				}
				if !hasFK {
					res.Issues = append(res.Issues, domain.SchemaIssue{
						ID:          id.NewUUIDv7(),
						Category:    domain.CategoryNormalization,
						Severity:    domain.SeverityCritical,
						Title:       fmt.Sprintf("关系 %s (%s -> %s) 在目标表 %s 中缺少外键列 (*_id)", rel.ID, srcEnt.Name, tgtEnt.Name, tgtEnt.Name),
						Description: fmt.Sprintf("关系 %s (%s -> %s) 在目标表 %s 中缺少外键列 (*_id)", rel.ID, srcEnt.Name, tgtEnt.Name, tgtEnt.Name),
						EntityName:  tgtEnt.Name,
						Suggestion:  fmt.Sprintf("在目标表 %q 中补充关联 %q 的 `*_id` 外键列。", tgtEnt.Name, srcEnt.Name),
					})
				}
			}
			return res
		},
	},
}

// SchemaRules 返回当前已注册的静态架构规则副本。
func SchemaRules() []SchemaRule {
	out := make([]SchemaRule, len(defaultSchemaRules))
	copy(out, defaultSchemaRules)
	return out
}

// EvaluateSchemaReview 运行表驱动静态规则集并汇总评分报表。
func EvaluateSchemaReview(design *domain.ERDesign, dialectName string) domain.SchemaReviewReport {
	if design == nil {
		design = &domain.ERDesign{}
	}
	evalCtx := SchemaEvalContext{
		Design:  design,
		Dialect: dialect.Get(dialectName),
		Lookup:  design.EntityLookup(),
	}

	issues := make([]domain.SchemaIssue, 0)
	totalChecks := 0
	for _, rule := range defaultSchemaRules {
		if rule.Scope&RuleScopeReview == 0 {
			continue
		}
		r := rule.Check(evalCtx)
		totalChecks += r.Checks
		issues = append(issues, r.Issues...)
	}

	score := computeReviewScore(issues)
	summary := "物理数据模型架构非常规范，未发现重大结构缺陷与性能风险！"
	if score < 60 {
		summary = "存在重大架构缺陷（如缺失主键或悬空关联），强烈建议采纳修复方案后再行建表上线。"
	} else if score < 85 {
		summary = "物理模型基本合格，但存在若干性能隐患（如外键缺失索引覆盖或金额类型精度问题），建议优化。"
	}

	return domain.SchemaReviewReport{
		Score:       score,
		Summary:     summary,
		PassedCount: max(totalChecks-len(issues), 0),
		TotalCount:  totalChecks,
		Issues:      issues,
	}
}

// CheckSchemaGateRules 执行面向自动化基准评测与门禁断言的核心结构规则校验（供 eval 等模块直接复用）。
func CheckSchemaGateRules(design *domain.ERDesign) (bool, []string) {
	if design == nil || len(design.Entities) == 0 {
		return false, []string{"ER 设计为空或实体数量为 0"}
	}
	evalCtx := SchemaEvalContext{
		Design:  design,
		Dialect: dialect.Get("mysql"),
		Lookup:  design.EntityLookup(),
	}

	var msgs []string
	for _, rule := range defaultSchemaRules {
		if rule.Scope&RuleScopeGate == 0 {
			continue
		}
		r := rule.Check(evalCtx)
		for _, iss := range r.Issues {
			msg := strings.TrimSpace(iss.Title)
			if msg == "" {
				msg = strings.TrimSpace(iss.Description)
			}
			msgs = append(msgs, msg)
		}
	}
	return len(msgs) == 0, msgs
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
	return max(100-deduction, 0)
}
