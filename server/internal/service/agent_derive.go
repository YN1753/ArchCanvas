package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"archcanvas/internal/dialect"
	"archcanvas/internal/domain"
	"archcanvas/internal/service/tools"

	"github.com/cloudwego/eino/schema"
)

// DerivePhysicalSchema Layer 2: 物理工程推导核心算子
func (a *AgentService) DerivePhysicalSchema(
	ctx context.Context,
	input DerivePhysicalInput,
	onThinking func(chunk string),
) (*domain.ERDesign, error) {
	if input.ConceptualDesign == nil || len(input.ConceptualDesign.Concepts) == 0 {
		return nil, errors.New("缺少有效的概念模型输入，无法推导物理表")
	}

	input.Dialect = dialect.NormalizeID(input.Dialect)

	res, _, err := executeStructuredStream(ctx, a, structuredStreamConfig[domain.ERDesign]{
		ModelProvider:      input.ModelProvider,
		ModelName:          input.ModelName,
		BuildTools:         tools.BuildDesignTools,
		InitialMessages:    a.buildDerivePhysicalMessages(input),
		MaxRetries:         2,
		RetryOnStreamError: true,
		OnThinking:         onThinking,
		RetryNotice: func(attempt int) string {
			return fmt.Sprintf("\n[提示] 物理表结构解析未通过，正在携带错误上下文向大模型发起第 %d 次纠错重试…\n", attempt)
		},
		ParseToolCall: func(tc schema.ToolCall) (*domain.ERDesign, bool, error) {
			if tc.Function.Name != tools.SaveERDesignToolName {
				return nil, false, nil
			}
			var args tools.ProposeSchemaDesignArgs
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
				return nil, true, fmt.Errorf("参数反序列化失败: %w", err)
			}
			if !hasValidEntities(args.Entities) {
				return nil, true, errors.New("实体列表或字段列表 (attributes) 为空")
			}
			return sanitizeERDesign(args.Entities, args.Relations, input.CurrentERDesign), true, nil
		},
		ParseContent: func(raw string) (*domain.ERDesign, error) {
			parsed, err := tryParseSchemaJSON(raw)
			if err != nil {
				return nil, fmt.Errorf("正文 JSON 提取失败: %w", err)
			}
			return sanitizeERDesign(parsed.Entities, parsed.Relations, input.CurrentERDesign), nil
		},
		BuildRetryPrompt: func(parseErr error) string {
			errMsg := "输出未包含合法的实体表与字段结构"
			if parseErr != nil {
				errMsg = parseErr.Error()
			}
			return fmt.Sprintf("【物理推导格式纠错】上一轮输出未能通过系统结构化反序列化校验，错误原因：%s。请严格调用 `save_er_design` 工具输出包含 entities（每张表含非空 attributes 数组及 id 主键）与 relations 的完整物理数据模型。", errMsg)
		},
		FinalErrorMessage: "大模型未返回有效的物理数据库表结构设计方案",
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return derivePhysicalRuleBased(input), nil
	}

	return res, nil
}

// buildDerivePhysicalMessages 组装 Layer 2 物理工程推导 Prompt（依托 dialect.Spec 动态装配目标方言规范）
func (a *AgentService) buildDerivePhysicalMessages(input DerivePhysicalInput) []*schema.Message {
	spec := dialect.Get(input.Dialect)

	var prompt strings.Builder
	prompt.WriteString("你是一位资深的生产级物理数据库架构师（Production Schema Engineer）。\n")
	prompt.WriteString("你的核心职责是将业务概念模型（Chen's ER Model）规范化推导为面向生产环境的物理关系表（Relational Schema with Indexes & Foreign Keys）。\n\n")

	prompt.WriteString(fmt.Sprintf("【目标数据库方言】：%s\n\n", strings.ToUpper(spec.ID)))

	prompt.WriteString("【生产级物理推导核心守则（必须严格执行）】：\n")
	prompt.WriteString("1. 【主键规范】：每张表必须拥有且仅有一个通用主键列，统一命名为 `id`，并置于表的第一列（is_primary_key: true，is_nullable: false，is_unique: true）。\n")
	prompt.WriteString("   - " + spec.PromptPrimaryKeyHint + "\n")
	prompt.WriteString("2. 【审计时间戳规范】：每张常规业务表必须配置基础审计列 `created_at` 与 `updated_at`。\n")
	prompt.WriteString("3. 【多对多(M:N)菱形解耦】：\n")
	prompt.WriteString("   - 概念模型中所有的多对多(many_to_many)关联，必须解耦拆分为独立的物理中间关联表（如 `student_courses`，并设置 is_junction_table: true）；\n")
	prompt.WriteString("   - 中间表必须包含两个实体引用的外键列（如 `student_id`, `course_id`）及联合唯一索引（`IndexDefinition`，is_unique: true）；\n")
	prompt.WriteString("   - 物理关系列表中建立从主表到中间表的两组一对多关联。\n")
	prompt.WriteString("4. 【一对多(1:N)外键布局】：在“多端”物理实体中增加对应“一端”的外键列（如 `orders.user_id`），类型与主表主键严格一致。\n")
	prompt.WriteString("5. 【字段数据类型精化】：金额类字段必须使用 `DECIMAL(10,2)` 或 `NUMERIC(10,2)`，严禁使用浮点数；短文本 `VARCHAR(64/128)`，长描述 `TEXT`。\n")
	prompt.WriteString("6. 【智能索引推导（IndexDefinition）】：必须为每一个外键列建立索引 `idx_{表名}_{字段名}`，业务唯一标识建立唯一索引 `uk_{表名}_{字段名}`，挂载在实体的 `indexes` 数组中。\n")
	prompt.WriteString("7. 【业务中文注释对齐】：实体的 `comment` 继承自概念的纯粹中文名，属性的 `comment` 填入清晰中文释义。\n")
	prompt.WriteString("8. 【输出方式】：请先输出你的架构推导思考，最终通过调用 `save_er_design` 工具提交完整的物理表与关系方案。\n")

	userContent := fmt.Sprintf("【待推导的业务概念模型（Chen's ER）】：\n%s\n", compactConceptualForPrompt(input.ConceptualDesign))
	if compactER := compactERForPrompt(input.CurrentERDesign); compactER != "" {
		userContent += fmt.Sprintf("\n【系统当前已有的物理表模型（请保持已有实体与字段命名稳定，执行增量推导）】：\n%s\n", compactER)
	}

	return []*schema.Message{
		schema.SystemMessage(prompt.String()),
		schema.UserMessage(userContent),
	}
}
