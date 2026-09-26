package service

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/domain"
	"archcanvas/internal/model"
	"archcanvas/internal/service/tools"
	"archcanvas/request"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/cloudwego/eino/schema"
)

type AgentService struct {
	ModelManager   *agent.ModelManager
	ProjectService *ProjectService
}

func NewAgentService(
	modelManager *agent.ModelManager,
	projectService *ProjectService,
) *AgentService {
	return &AgentService{
		ModelManager:   modelManager,
		ProjectService: projectService,
	}
}

func (a *AgentService) Chat(
	ctx context.Context,
	req request.ChatReq,
) (<-chan StreamEvent, error) {
	outCh := make(chan StreamEvent, 20)

	go func() {
		defer close(outCh)

		// sendEvent 安全推送事件至通道；若 ctx 已被取消（如客户端断开连接），立即返回 false 避免协程永久阻塞挂起
		sendEvent := func(evt StreamEvent) bool {
			select {
			case outCh <- evt:
				return true
			case <-ctx.Done():
				return false
			}
		}

		var thinkingBuffer strings.Builder
		var currentDesign *domain.ERDesign
		var historyMessages []model.Message
		var convID string

		var currentConceptualDesign *domain.ConceptualDesign

		// 1. 获取项目已有画布设计及历史会话上下文
		if a.ProjectService != nil && req.ProjectID != "" {
			cd, err := a.ProjectService.GetConceptualDesign(ctx, req.ProjectID)
			if err == nil && cd != nil && len(cd.Concepts) > 0 {
				currentConceptualDesign = cd
			}

			design, err := a.ProjectService.GetERDesign(ctx, req.ProjectID)
			if err == nil {
				currentDesign = design
			}

			if a.ProjectService.MessageRepo != nil {
				conv, err := a.ProjectService.MessageRepo.GetOrCreateConversation(ctx, req.ProjectID)
				if err == nil && conv != nil {
					convID = conv.ID
					allMsgs, err := a.ProjectService.MessageRepo.ListMessagesByProject(ctx, req.ProjectID)
					if err == nil {
						if len(allMsgs) > 6 {
							historyMessages = allMsgs[len(allMsgs)-6:]
						} else {
							historyMessages = allMsgs
						}
					}
					// 持久化当前用户需求输入
					_, _ = a.ProjectService.MessageRepo.CreateMessage(ctx, convID, "user", req.Input)
				}
			}
		}

		saveAssistantMsg := func(payload map[string]interface{}) {
			if convID != "" && a.ProjectService != nil && a.ProjectService.MessageRepo != nil {
				dataBytes, err := json.Marshal(payload)
				if err == nil {
					saveCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					_, _ = a.ProjectService.MessageRepo.CreateMessage(saveCtx, convID, "assistant", string(dataBytes))
				}
			}
		}

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "AI 需求分析师正在梳理业务概念与边界…"}) {
			return
		}
		reqOutput, err := a.AnalyzeRequirement(ctx, RequirementInput{
			ProjectID:               req.ProjectID,
			Message:                 req.Input,
			HistoryMessages:         historyMessages,
			CurrentConceptualDesign: currentConceptualDesign,
			CurrentERDesign:         currentDesign,
			ModelProvider:           req.ModelProvider,
			ModelName:               req.ModelName,
		}, func(chunk string) {
			thinkingBuffer.WriteString(chunk)
			sendEvent(StreamEvent{Type: EventThinking, Data: chunk})
		})
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return
			}
			sendEvent(StreamEvent{Type: EventError, Data: err.Error()})
			saveAssistantMsg(map[string]interface{}{
				"summary":  "业务分析遇到异常",
				"thinking": thinkingBuffer.String(),
				"status":   "error",
				"error":    err.Error(),
			})
			return
		}

		if reqOutput.NeedClarification {
			if !sendEvent(StreamEvent{Type: EventStatus, Data: "检测到需求存在疑问，需要进一步确认"}) {
				return
			}
			if !sendEvent(StreamEvent{Type: EventResult, Data: reqOutput}) {
				return
			}
			sendEvent(StreamEvent{Type: EventDone, Data: true})

			saveAssistantMsg(map[string]interface{}{
				"summary":             reqOutput.Summary,
				"thinking":            thinkingBuffer.String(),
				"status":              "clarification",
				"need_clarification":  true,
				"clarification_cards": reqOutput.ClarificationCards,
				"questions":           reqOutput.Questions,
			})
			return
		}

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "业务概念已明确，架构师正在设计物理表结构与字段类型…"}) {
			return
		}

		erDesign, err := a.DesignSchema(ctx, SchemaDesignInput{
			Requirement:     reqOutput,
			CurrentERDesign: currentDesign,
			ModelProvider:   req.ModelProvider,
			ModelName:       req.ModelName,
		}, func(chunk string) {
			thinkingBuffer.WriteString(chunk)
			sendEvent(StreamEvent{Type: EventThinking, Data: chunk})
		})
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return
			}
			sendEvent(StreamEvent{Type: EventError, Data: err.Error()})
			saveAssistantMsg(map[string]interface{}{
				"summary":  "物理表结构设计遇到异常",
				"thinking": thinkingBuffer.String(),
				"status":   "error",
				"error":    err.Error(),
			})
			return
		}

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "数据模型设计完成，正在持久化落库…"}) {
			return
		}
		if !sendEvent(StreamEvent{Type: EventToolCall, Data: erDesign}) {
			return
		}

		if a.ProjectService != nil && req.ProjectID != "" {
			savedResult, err := a.ProjectService.SaveERDesign(ctx, req.ProjectID, *erDesign)
			if err != nil {
				sendEvent(StreamEvent{Type: EventError, Data: "落库失败: " + err.Error()})
				saveAssistantMsg(map[string]interface{}{
					"summary":  "数据模型持久化落库失败",
					"thinking": thinkingBuffer.String(),
					"status":   "error",
					"error":    err.Error(),
				})
				return
			}
			if !sendEvent(StreamEvent{Type: EventResult, Data: savedResult.Design}) {
				return
			}
		} else {
			if !sendEvent(StreamEvent{Type: EventResult, Data: *erDesign}) {
				return
			}
		}

		var entityNames []string
		for _, e := range erDesign.Entities {
			entityNames = append(entityNames, e.Name)
		}

		saveAssistantMsg(map[string]interface{}{
			"summary":                 reqOutput.Summary,
			"thinking":                thinkingBuffer.String(),
			"status":                  "completed",
			"need_clarification":      false,
			"applied_entities_count":  len(erDesign.Entities),
			"applied_relations_count": len(erDesign.Relations),
			"applied_entities":        entityNames,
		})

		sendEvent(StreamEvent{Type: EventDone, Data: true})
	}()

	return outCh, nil
}

func (a *AgentService) AnalyzeRequirement(
	ctx context.Context,
	input RequirementInput,
	onThinking func(chunk string),
) (*RequirementOutput, error) {
	if a.ModelManager == nil {
		return nil, errors.New("model manager is not configured")
	}

	chatModel, err := a.ModelManager.GetModel(ctx, input.ModelProvider, input.ModelName)
	if err != nil {
		return nil, err
	}

	toolList, err := tools.BuildRequirementTools(ctx)
	if err != nil {
		return nil, err
	}
	toolModel, err := chatModel.WithTools(toolList)
	if err != nil {
		return nil, err
	}

	messages := a.buildRequirementMessages(input)

	stream, err := toolModel.Stream(ctx, messages)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	var accumulatedMses []*schema.Message

	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}

		if chunk.Content != "" && onThinking != nil {
			onThinking(chunk.Content)
		}

		accumulatedMses = append(accumulatedMses, chunk)
	}

	concatMsg, err := schema.ConcatMessages(accumulatedMses)
	if err == nil && len(concatMsg.ToolCalls) > 0 {
		for _, tc := range concatMsg.ToolCalls {
			if tc.Function.Name == tools.ProposeRequirementToolName {
				var args tools.ProposeRequirementArgs
				if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err == nil {
					return &RequirementOutput{
						Summary:             args.Summary,
						Concepts:            args.Concepts,
						Relations:           args.Relations,
						Assumptions:         args.Assumptions,
						NegativeConstraints: args.NegativeConstraints,
						NeedClarification:   args.NeedClarification,
						ClarificationCards:  args.ClarificationCards,
						Questions:           args.Questions,
					}, nil
				}
			}
		}
	}

	if concatMsg != nil && concatMsg.Content != "" {
		if parsed, err := tryParseRequirementJSON(concatMsg.Content); err == nil {
			return parsed, nil
		}
		return &RequirementOutput{
			Summary:           concatMsg.Content,
			Concepts:          []domain.BusinessConcept{},
			Relations:         []domain.ConceptRelation{},
			NeedClarification: false,
		}, nil
	}

	return nil, errors.New("大模型未返回有效的业务需求分析结果")
}

// DesignSchema 阶段二：纯净的物理数据库建模算子
// 职责单一：将业务概念模型转换为物理数据库表结构（domain.ERDesign，包含主键、SQL字段类型、外键关联）；零落库副作用。
func (a *AgentService) DesignSchema(
	ctx context.Context,
	input SchemaDesignInput,
	onThinking func(chunk string),
) (*domain.ERDesign, error) {
	if a.ModelManager == nil {
		return nil, errors.New("model manager is not configured")
	}

	chatModel, err := a.ModelManager.GetModel(ctx, input.ModelProvider, input.ModelName)
	if err != nil {
		return nil, err
	}

	toolList, err := tools.BuildDesignTools(ctx)
	if err != nil {
		return nil, err
	}
	toolModel, err := chatModel.WithTools(toolList)
	if err != nil {
		return nil, err
	}

	messages := a.buildSchemaDesignMessages(input)

	stream, err := toolModel.Stream(ctx, messages)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	var accumulatedMses []*schema.Message

	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}

		if chunk.Content != "" && onThinking != nil {
			onThinking(chunk.Content)
		}

		accumulatedMses = append(accumulatedMses, chunk)
	}

	concatMsg, err := schema.ConcatMessages(accumulatedMses)
	if err == nil && len(concatMsg.ToolCalls) > 0 {
		for _, tc := range concatMsg.ToolCalls {
			if tc.Function.Name == tools.SaveERDesignToolName || tc.Function.Name == tools.ProposeSchemaDesignToolName {
				var args tools.ProposeSchemaDesignArgs
				if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err == nil {
					cleanRelations := make([]domain.Relation, 0, len(args.Relations))
					for _, r := range args.Relations {
						if strings.TrimSpace(r.SourceEntityID) != "" &&
							!strings.EqualFold(strings.TrimSpace(r.SourceEntityID), strings.TrimSpace(r.TargetEntityID)) {
							cleanRelations = append(cleanRelations, r)
						}
					}
					return &domain.ERDesign{
						Entities:  args.Entities,
						Relations: cleanRelations,
					}, nil
				}
			}
		}
	}

	if concatMsg != nil && concatMsg.Content != "" {
		if parsed, err := tryParseSchemaJSON(concatMsg.Content); err == nil {
			return parsed, nil
		}
	}

	return nil, errors.New("大模型未返回有效的物理数据库表结构设计方案")
}

// buildRequirementMessages 组装阶段一业务需求分析 Prompt
func (a *AgentService) buildRequirementMessages(input RequirementInput) []*schema.Message {
	var prompt strings.Builder
	prompt.WriteString("你是一位资深的领域概念建模架构师（Domain Concept Modeler）。\n")
	prompt.WriteString("你的核心职责是专注业务领域概念模型（Chen's ER Model），梳理出实体概念、业务属性、概念动词关系以及业务边界。\n\n")

	prompt.WriteString("【严格遵循的状态枚举取值限制】：\n")
	prompt.WriteString("- 概念操作 operation 必须且只能是以下四项之一：\"create\"（新增概念）, \"modify\"（修改概念）, \"retain\"（保留概念）, \"delete\"（删除概念）\n")
	prompt.WriteString("- 关联基数 cardinality 必须且只能是以下三项之一：\"one_to_one\"（一对一）, \"one_to_many\"（一对多）, \"many_to_many\"（多对多）\n")
	prompt.WriteString("- 属性类别 category 必须且只能是以下六项之一：\"string\"（文本）, \"number\"（数值）, \"boolean\"（布尔）, \"datetime\"（日期时间）, \"enum\"（枚举）, \"media\"（文件/多媒体）\n\n")

	prompt.WriteString("【纯业务概念建模（Chen's ER）铁律（绝对禁止物理污染）】：\n")
	prompt.WriteString("1. 【聚焦业务实体与核心属性】：抽取具有独立业务含义的实体概念（如 User, Order, Product），每个概念仅包含 3 到 6 个最关键的高阶业务属性（如 name, price, status, balance 等）。\n")
	prompt.WriteString("2. 【禁止提前物理实现】：\n")
	prompt.WriteString("   - 绝对不要生成自增整型 ID（如 id, auto_increment）或物理底层类型（如 VARCHAR, INT, BIGINT, TEXT）；类型必须且只能使用抽象类别 category（string, number, boolean, datetime, enum, media）；\n")
	prompt.WriteString("   - 绝对不要创建物理外键属性（如 user_id, order_id）；概念之间的关联通过 relations 表达即可，属性中不需要外键！\n")
	prompt.WriteString("   - 绝对不要创建物理中间表概念（如用户与角色的多对多关系，只需生成一条动词关联：User ──拥有(M:N)── Role，绝对禁止凭空捏造一个 UserRole 概念实体！多对多拆解是后续物理表推导的工作）；\n")
	prompt.WriteString("3. 【业务标识符标注】：若属性具有业务唯一标识特征（如 username, order_no, sku_code），将 is_business_key 标记为 true（陈氏图中将显示下划线）；\n")
	prompt.WriteString("4. 【双语显示】：实体概念与属性均需提供准确的英文标识（name，如 Order）与中文业务名称（display_name，如 订单）。关联关系同理，动词 name 需简洁明了（如 下单, 购买, 选修, 包含）。\n\n")

	if len(input.Constraints) > 0 {
		prompt.WriteString("【用户历史明确提出的硬性红线（必须绝对遵守）】：\n")
		for _, c := range input.Constraints {
			prompt.WriteString(fmt.Sprintf("- %s\n", c))
		}
		prompt.WriteString("\n")
	}
	if len(input.Decisions) > 0 {
		prompt.WriteString("【历史已达成的核心设计共识】：\n")
		for _, d := range input.Decisions {
			prompt.WriteString(fmt.Sprintf("- %s\n", d))
		}
		prompt.WriteString("\n")
	}

	if input.CurrentConceptualDesign != nil && len(input.CurrentConceptualDesign.Concepts) > 0 {
		cdJSON, err := json.Marshal(input.CurrentConceptualDesign)
		if err == nil {
			prompt.WriteString(fmt.Sprintf("【当前画布已有的陈氏概念模型（增量演化上下文，必须保持现有概念稳定）】：\n%s\n\n", string(cdJSON)))
		}
	} else if input.CurrentERDesign != nil && len(input.CurrentERDesign.Entities) > 0 {
		erJSON, err := json.Marshal(input.CurrentERDesign)
		if err == nil {
			prompt.WriteString(fmt.Sprintf("【当前已有系统数据模型（增量分析上下文）】：\n%s\n\n", string(erJSON)))
		}
	}

	prompt.WriteString("【澄清选项卡触发与生成规则（至关重要）】：\n")
	prompt.WriteString("1. 【精准具体小需求（静默直通）】：若用户的输入已经足够明确、指向具体实体/特定概念修改（例如“在用户概念加个手机号”、“把状态改成枚举”），严禁多事提问！必须将 need_clarification 设为 false，clarification_cards 留空，直接提议业务概念！\n")
	prompt.WriteString("2. 【宏观庞大粗粒度需求（编排门禁触发）】：若用户的输入是宏观系统级需求（例如“帮我做一个校园二手交易平台”、“做一个社区团购系统”），存在多种核心业务落地路径时，必须将 need_clarification 设为 true，并生成 2 到 3 张【逻辑递进、前后连贯】的决策卡片（clarification_cards）：\n")
	prompt.WriteString("   - 卡片需按照业务主线递进（如：卡片1 核心业务交付模式 -> 卡片2 准入与认证体系 -> 卡片3 互动或结算方式）；\n")
	prompt.WriteString("   - 每张卡片提供 2 到 4 个代表性预设选项（options）：\n")
	prompt.WriteString("     * label: 选项主标题（简短明了，如“校内寝室自提与面交”）；\n")
	prompt.WriteString("     * description: 选项副标题说明（一句话说明对业务模式与架构的影响）；\n")
	prompt.WriteString("     * is_default: 必须且只能将其中最符合通用场景的最佳实践选项标记为 true；\n")
	prompt.WriteString("   - 【切勿生成自定义/其他选项】：大模型无需自己添加“其他”或“自定义”，前端交互层会自动在每张卡片尾部固定注入自定义输入框！\n\n")

	prompt.WriteString("【输出要求】：\n")
	prompt.WriteString("1. 请先用自然语言简要阐述你的业务分析思考与推导（这会流式展示给用户）；\n")
	prompt.WriteString("2. 若需求存在重大模糊或关键矛盾，将 need_clarification 设为 true，并在 clarification_cards 中生成上述递进卡片，在 questions 中列出对应的自然语言追问；\n")
	prompt.WriteString("3. 最终通过调用 `propose_requirement` 工具提交结构化的业务概念模型与决策卡片。\n")

	msgs := make([]*schema.Message, 0, len(input.HistoryMessages)+2)
	msgs = append(msgs, schema.SystemMessage(prompt.String()))

	if len(input.HistoryMessages) > 0 {
		for _, h := range input.HistoryMessages {
			if h.Role == "user" {
				msgs = append(msgs, schema.UserMessage(h.Content))
			} else if h.Role == "assistant" {
				var payload struct {
					Summary string `json:"summary"`
				}
				content := h.Content
				if err := json.Unmarshal([]byte(h.Content), &payload); err == nil && payload.Summary != "" {
					content = payload.Summary
				}
				msgs = append(msgs, schema.AssistantMessage(content, nil))
			}
		}
	}

	msgs = append(msgs, schema.UserMessage(input.Message))
	return msgs
}

// buildSchemaDesignMessages 组装阶段二物理数据库建模 Prompt
func (a *AgentService) buildSchemaDesignMessages(input SchemaDesignInput) []*schema.Message {
	var prompt strings.Builder
	prompt.WriteString("你是一位精通 MySQL / PostgreSQL 物理架构的资深数据库架构师（Database Architect）。\n")
	prompt.WriteString("你的职责是根据业务分析师输出的业务概念模型（Business Concepts）和关系，推导生成高质量的物理数据库表结构（Entities）与表间关系（Relations）。\n\n")

	prompt.WriteString("【建表与字段设计规范】：\n")
	prompt.WriteString("1. 每张表必须包含主键 `id`（is_primary_key=true, db_type 为 BIGINT AUTO_INCREMENT 或 VARCHAR(36) UUID, code_type 为 int64 或 string）；\n")
	prompt.WriteString("2. 根据业务属性类别映射最高效精准的 SQL 物理类型（db_type）与代码类型（code_type）：\n")
	prompt.WriteString("   - string -> VARCHAR(255) / TEXT (code_type: string)\n")
	prompt.WriteString("   - number -> BIGINT / INT / DECIMAL(10,2) (code_type: int64 / float64)\n")
	prompt.WriteString("   - boolean -> TINYINT(1) / BOOLEAN (code_type: bool)\n")
	prompt.WriteString("   - datetime -> DATETIME / TIMESTAMP (code_type: time.Time)\n")
	prompt.WriteString("   - enum -> VARCHAR(32) (code_type: string)\n")
	prompt.WriteString("   - media -> VARCHAR(512) (code_type: string)\n")
	prompt.WriteString("3. 根据业务关联关系（one_to_many, many_to_many）建立合理的外键字段（如 user_id BIGINT）和 Relation 连线；\n")
	prompt.WriteString("   - 【严禁生成指向自身的自引用关系连线】：relations 仅用于两张不同实体表之间的外键关联（source_entity_id 必须与 target_entity_id 不同）。对于像 parent_id（树形分类/评论递归回复）等层级自引用结构，只需在表中保留 parent_id 外键字段即可，绝对不要在 relations 中添加指向本表的自环连线（避免画布产生遮挡字段的表内回环）；\n")
	prompt.WriteString("4. 表名（name）必须使用简洁规范的英文小写复数（如 users, orders, order_items），字段名（name）请使用标准蛇形命名（如 user_id, order_no）。关于表和字段的 ID，可填入表名作为临时标识或留空，服务端会自动分配全局有序且无冲突的 RFC 9562 UUIDv7 主键。\n\n")

	if input.Requirement != nil {
		reqJSON, err := json.Marshal(input.Requirement)
		if err == nil {
			prompt.WriteString(fmt.Sprintf("【前置业务概念分析结果】：\n%s\n\n", string(reqJSON)))
		}
	}

	if input.CurrentERDesign != nil && len(input.CurrentERDesign.Entities) > 0 {
		erJSON, err := json.Marshal(input.CurrentERDesign)
		if err == nil {
			prompt.WriteString(fmt.Sprintf("【当前已有数据库物理表设计（平滑增量修改）】：\n%s\n\n", string(erJSON)))
		}
	}

	prompt.WriteString("请先用自然语言简要阐明你的物理表设计理由与索引规划（流式展示给用户），随后调用 `save_er_design` 工具提交最终的物理 ER 模型。")

	return []*schema.Message{
		schema.SystemMessage(prompt.String()),
		schema.UserMessage("请根据上述业务概念模型生成完整的物理数据库表结构与关联设计。"),
	}
}

func tryParseRequirementJSON(content string) (*RequirementOutput, error) {
	content = strings.TrimSpace(content)
	if strings.Contains(content, "```json") {
		parts := strings.Split(content, "```json")
		if len(parts) > 1 {
			jsonBlock, _, _ := strings.Cut(parts[1], "```")
			var out RequirementOutput
			if err := json.Unmarshal([]byte(strings.TrimSpace(jsonBlock)), &out); err == nil {
				return &out, nil
			}
		}
	}
	var out RequirementOutput
	if err := json.Unmarshal([]byte(content), &out); err == nil {
		return &out, nil
	}
	return nil, errors.New("cannot parse RequirementOutput JSON")
}

func tryParseSchemaJSON(content string) (*domain.ERDesign, error) {
	cleanOut := func(out *domain.ERDesign) *domain.ERDesign {
		cleanRelations := make([]domain.Relation, 0, len(out.Relations))
		for _, r := range out.Relations {
			if strings.TrimSpace(r.SourceEntityID) != "" &&
				!strings.EqualFold(strings.TrimSpace(r.SourceEntityID), strings.TrimSpace(r.TargetEntityID)) {
				cleanRelations = append(cleanRelations, r)
			}
		}
		out.Relations = cleanRelations
		return out
	}

	content = strings.TrimSpace(content)
	if strings.Contains(content, "```json") {
		parts := strings.Split(content, "```json")
		if len(parts) > 1 {
			jsonBlock, _, _ := strings.Cut(parts[1], "```")
			var out domain.ERDesign
			if err := json.Unmarshal([]byte(strings.TrimSpace(jsonBlock)), &out); err == nil && len(out.Entities) > 0 {
				return cleanOut(&out), nil
			}
		}
	}
	var out domain.ERDesign
	if err := json.Unmarshal([]byte(content), &out); err == nil && len(out.Entities) > 0 {
		return cleanOut(&out), nil
	}
	return nil, errors.New("cannot parse ERDesign JSON")
}
