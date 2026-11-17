package service

import (
	"context"
	"fmt"
	"strings"

	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
)

type conceptStageParams struct {
	ProjectID     string
	Input         string
	ModelProvider string
	ModelName     string
}

type conceptStageOutcome struct {
	Clarified        bool
	ReqOutput        *RequirementOutput
	ConceptualDesign *domain.ConceptualDesign
	CurrentERDesign  *domain.ERDesign
}

type physicalStageParams struct {
	ProjectID         string
	Dialect           string
	ConceptualDesign  *domain.ConceptualDesign
	CurrentERDesign   *domain.ERDesign
	ModelProvider     string
	ModelName         string
	SummaryOverride   string
	AssistantStatus   string
	EmitToolCallEvent bool
}

// runConceptStage 执行统一的阶段一概念建模与澄清守卫逻辑（由 Chat 与 ProposeConcepts 共同复用）。
func (a *AgentService) runConceptStage(
	session *sseStreamSession,
	params conceptStageParams,
) (*conceptStageOutcome, bool) {
	convID, currentConceptualDesign, currentDesign, historyMessages, storedConstraints, storedDecisions :=
		a.loadProjectTurnContext(session.ctx, params.ProjectID, params.Input, 6)
	session.convID = convID

	if !session.send(StreamEvent{Type: EventStatus, Data: "AI 需求分析师正在梳理业务概念与实体边界…"}) {
		return nil, false
	}

	reqOutput, err := a.AnalyzeRequirement(session.ctx, RequirementInput{
		ProjectID:               params.ProjectID,
		Message:                 params.Input,
		HistoryMessages:         historyMessages,
		Constraints:             storedConstraints,
		Decisions:               storedDecisions,
		CurrentConceptualDesign: currentConceptualDesign,
		CurrentERDesign:         currentDesign,
		ModelProvider:           params.ModelProvider,
		ModelName:               params.ModelName,
	}, session.onThinking)
	if err != nil {
		session.failWithError("业务概念分析遇到异常", "", err)
		return nil, false
	}

	// [P0-DATA-02] 当触发澄清追问且本次未生成新概念时，绝不覆盖清空项目已有的概念模型与 AIContext！
	if reqOutput.NeedClarification {
		var preservedConcept domain.ConceptualDesign
		if currentConceptualDesign != nil && len(currentConceptualDesign.Concepts) > 0 {
			preservedConcept = *domain.CloneConceptualDesign(currentConceptualDesign)
		} else if len(reqOutput.Concepts) > 0 {
			preservedConcept = domain.MergeConceptualDesign(currentConceptualDesign, domain.ConceptualDesign{
				Summary:   reqOutput.Summary,
				Concepts:  reqOutput.Concepts,
				Relations: reqOutput.Relations,
			})
			if a.ProjectService != nil && params.ProjectID != "" {
				_ = a.ProjectService.SaveConceptualDesign(session.ctx, params.ProjectID, preservedConcept)
			}
		}

		session.saveAssistant(map[string]any{
			"summary":             reqOutput.Summary,
			"thinking":            session.thinking.String(),
			"status":              "clarification",
			"need_clarification":  true,
			"clarification_cards": reqOutput.ClarificationCards,
			"questions":           reqOutput.Questions,
			"conceptual_design":   preservedConcept,
		})

		if !session.send(StreamEvent{Type: EventStatus, Data: "检测到业务需求存在模糊点，已生成澄清卡片"}) {
			return nil, false
		}
		resultPayload := map[string]any{
			"conceptual_design":   preservedConcept,
			"concepts":            reqOutput.Concepts,
			"relations":           reqOutput.Relations,
			"need_clarification":  true,
			"clarification_cards": reqOutput.ClarificationCards,
			"questions":           reqOutput.Questions,
			"summary":             reqOutput.Summary,
		}
		if !session.send(StreamEvent{Type: EventResult, Data: resultPayload}) {
			return nil, false
		}
		session.send(StreamEvent{Type: EventDone, Data: true})
		return &conceptStageOutcome{
			Clarified:        true,
			ReqOutput:        reqOutput,
			ConceptualDesign: &preservedConcept,
			CurrentERDesign:  currentDesign,
		}, true
	}

	if a.ProjectService != nil && params.ProjectID != "" {
		_ = a.ProjectService.MergeAndSaveAIContext(
			session.ctx,
			params.ProjectID,
			reqOutput.Summary,
			reqOutput.Assumptions,
			reqOutput.NegativeConstraints,
		)
	}

	conceptualDesign := domain.MergeConceptualDesign(currentConceptualDesign, domain.ConceptualDesign{
		Summary:   reqOutput.Summary,
		Concepts:  reqOutput.Concepts,
		Relations: reqOutput.Relations,
	})

	if a.ProjectService != nil && params.ProjectID != "" {
		if err := a.ProjectService.SaveConceptualDesign(session.ctx, params.ProjectID, conceptualDesign); err != nil {
			session.failWithError("概念模型持久化失败", "概念模型持久化失败: ", err)
			return nil, false
		}
	}

	return &conceptStageOutcome{
		Clarified:        false,
		ReqOutput:        reqOutput,
		ConceptualDesign: &conceptualDesign,
		CurrentERDesign:  currentDesign,
	}, true
}

// runPhysicalStage 执行统一的阶段二物理表推导、持久化与事件广播逻辑（由 Chat 与 DerivePhysical 共同复用）。
func (a *AgentService) runPhysicalStage(
	session *sseStreamSession,
	params physicalStageParams,
) (*domain.ERDesign, bool) {
	dialect := normalizeDialect(params.Dialect)
	session.ensureConversation()

	conceptualDesign := params.ConceptualDesign
	if (conceptualDesign == nil || len(conceptualDesign.Concepts) == 0) && a.ProjectService != nil && params.ProjectID != "" {
		if cd, err := a.ProjectService.GetConceptualDesign(session.ctx, params.ProjectID); err == nil && cd != nil && len(cd.Concepts) > 0 {
			conceptualDesign = cd
		}
	}
	if conceptualDesign == nil || len(conceptualDesign.Concepts) == 0 {
		session.send(StreamEvent{Type: EventError, Data: "未找到有效的概念模型，请先进行业务概念建模"})
		return nil, false
	}

	currentDesign := params.CurrentERDesign
	if currentDesign == nil && a.ProjectService != nil && params.ProjectID != "" {
		if design, err := a.ProjectService.GetERDesign(session.ctx, params.ProjectID); err == nil {
			currentDesign = design
		}
	}

	statusMsg := fmt.Sprintf("物理架构工程师正在推导物理表与索引 (目标方言: %s)…", dialect)
	if !session.send(StreamEvent{Type: EventStatus, Data: statusMsg}) {
		return nil, false
	}

	erDesign, err := a.DerivePhysicalSchema(session.ctx, DerivePhysicalInput{
		ProjectID:        params.ProjectID,
		Dialect:          dialect,
		ConceptualDesign: conceptualDesign,
		CurrentERDesign:  currentDesign,
		ModelProvider:    params.ModelProvider,
		ModelName:        params.ModelName,
	}, session.onThinking)
	if err != nil {
		session.failWithError("物理数据表推导遇到异常", "", err)
		return nil, false
	}

	session.send(StreamEvent{Type: EventStatus, Data: "物理模型推导完成，正在持久化落库…"})

	finalDesign := erDesign
	if a.ProjectService != nil && params.ProjectID != "" {
		savedResult, err := a.ProjectService.SaveERDesign(session.ctx, params.ProjectID, *erDesign)
		if err != nil {
			session.failWithError("物理表落库失败", "物理表落库失败: ", err)
			return nil, false
		}
		finalDesign = savedResult.Design
	}

	var entityNames []string
	for _, e := range finalDesign.Entities {
		if e.Name != "" {
			entityNames = append(entityNames, e.Name)
		}
	}

	summary := strings.TrimSpace(params.SummaryOverride)
	if summary == "" {
		summary = fmt.Sprintf("物理表推导完成（目标方言: %s）：共生成 %d 张物理数据表、%d 条物理约束关联。",
			strings.ToUpper(dialect), len(finalDesign.Entities), len(finalDesign.Relations))
	}
	assistantStatus := params.AssistantStatus
	if assistantStatus == "" {
		assistantStatus = "physical_ready"
	}

	session.saveAssistant(map[string]any{
		"summary":                 summary,
		"thinking":                session.thinking.String(),
		"status":                  assistantStatus,
		"need_clarification":      false,
		"applied_entities_count":  len(finalDesign.Entities),
		"applied_relations_count": len(finalDesign.Relations),
		"applied_entities":        entityNames,
	})

	if params.EmitToolCallEvent {
		if !session.send(StreamEvent{Type: EventToolCall, Data: finalDesign}) {
			return finalDesign, false
		}
	}
	if !session.send(StreamEvent{Type: EventResult, Data: finalDesign}) {
		return finalDesign, false
	}
	session.send(StreamEvent{Type: EventDone, Data: true})
	return finalDesign, true
}

// ProposeConcepts Layer 1: 业务需求与概念建模算子接口
func (a *AgentService) ProposeConcepts(
	ctx context.Context,
	req dto.ProposeConceptsReq,
) (<-chan StreamEvent, error) {
	return a.launchSSETask(ctx, req.ProjectID, sseTaskOptions{Access: accessWritable}, func(session *sseStreamSession) {
		outcome, ok := a.runConceptStage(session, conceptStageParams{
			ProjectID:     req.ProjectID,
			Input:         req.Input,
			ModelProvider: req.ModelProvider,
			ModelName:     req.ModelName,
		})
		if !ok || outcome.Clarified {
			return
		}

		session.saveAssistant(map[string]any{
			"summary":           outcome.ReqOutput.Summary,
			"thinking":          session.thinking.String(),
			"status":            "concept_ready",
			"conceptual_design": *outcome.ConceptualDesign,
		})

		if !session.send(StreamEvent{Type: EventStatus, Data: "业务概念与陈氏关联推导完成，请在白板中审阅或直接推导物理表"}) {
			return
		}
		resultPayload := map[string]any{
			"conceptual_design":  *outcome.ConceptualDesign,
			"need_clarification": false,
			"summary":            outcome.ReqOutput.Summary,
		}
		if !session.send(StreamEvent{Type: EventResult, Data: resultPayload}) {
			return
		}
		session.send(StreamEvent{Type: EventDone, Data: true})
	})
}

// DerivePhysical Layer 2: 逻辑规范化与物理表工程推导算子接口
func (a *AgentService) DerivePhysical(
	ctx context.Context,
	req dto.DerivePhysicalReq,
) (<-chan StreamEvent, error) {
	// 在启动异步协程前深拷贝传入的指针结构，防范调用方并发修改共享内存
	reqConceptSnapshot := domain.CloneConceptualDesign(req.ConceptualDesign)

	return a.launchSSETask(ctx, req.ProjectID, sseTaskOptions{Access: accessWritable}, func(session *sseStreamSession) {
		a.runPhysicalStage(session, physicalStageParams{
			ProjectID:        req.ProjectID,
			Dialect:          req.Dialect,
			ConceptualDesign: reqConceptSnapshot,
			ModelProvider:    req.ModelProvider,
			ModelName:        req.ModelName,
			AssistantStatus:  "physical_ready",
		})
	})
}

// ReviewSchema Layer 3: 架构师质量与性能守卫接口
func (a *AgentService) ReviewSchema(
	ctx context.Context,
	req dto.ReviewSchemaReq,
) (<-chan StreamEvent, error) {
	return a.launchSSETask(ctx, req.ProjectID, sseTaskOptions{Access: accessReadable}, func(session *sseStreamSession) {
		session.ensureConversation()

		if !session.send(StreamEvent{Type: EventStatus, Data: "首席数据架构师正在进行全方位质量与性能体检…"}) {
			return
		}

		var erDesign *domain.ERDesign
		if a.ProjectService != nil && req.ProjectID != "" {
			if design, err := a.ProjectService.GetERDesign(session.ctx, req.ProjectID); err == nil {
				erDesign = design
			}
		}
		if erDesign == nil || len(erDesign.Entities) == 0 {
			session.send(StreamEvent{Type: EventError, Data: "当前画布无物理数据表，无法执行架构体检"})
			return
		}

		report, err := a.ReviewPhysicalSchema(session.ctx, ReviewSchemaInput{
			ProjectID:       req.ProjectID,
			Dialect:         req.Dialect,
			CurrentERDesign: erDesign,
			ModelProvider:   req.ModelProvider,
			ModelName:       req.ModelName,
		}, session.onThinking)
		if err != nil {
			session.failWithError("架构体检遇到异常", "", err)
			return
		}

		session.saveAssistant(map[string]any{
			"summary":       fmt.Sprintf("数据库架构体检完成：综合评分 %d 分（共审查 %d 项指标，通过 %d 项，发现 %d 项需关注的架构隐患）。", report.Score, report.TotalCount, report.PassedCount, len(report.Issues)),
			"thinking":      session.thinking.String(),
			"status":        "review_ready",
			"review_report": report,
		})

		if !session.send(StreamEvent{Type: EventStatus, Data: fmt.Sprintf("体检完成！健康度得分: %d 分", report.Score)}) {
			return
		}
		if !session.send(StreamEvent{Type: EventResult, Data: report}) {
			return
		}
		session.send(StreamEvent{Type: EventDone, Data: true})
	})
}

func mergeConceptualDesign(existing *domain.ConceptualDesign, incoming domain.ConceptualDesign) domain.ConceptualDesign {
	return domain.MergeConceptualDesign(existing, incoming)
}
