package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"archcanvas/internal/domain"
	"archcanvas/internal/model"
	"archcanvas/pkg/id"
	"archcanvas/request"
)

// ProposeConcepts Layer 1: 业务需求与概念建模算子接口
func (a *AgentService) ProposeConcepts(
	ctx context.Context,
	req request.ProposeConceptsReq,
) (<-chan StreamEvent, error) {
	outCh := make(chan StreamEvent, 20)

	go func() {
		defer close(outCh)

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

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "AI 需求分析师正在梳理业务概念与实体边界…"}) {
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
				"summary":  "业务概念分析遇到异常",
				"thinking": thinkingBuffer.String(),
				"status":   "error",
				"error":    err.Error(),
			})
			return
		}

		// 组装并平滑合并业务概念聚合（保留已有概念坐标与稳定 ID）
		rawConceptualDesign := domain.ConceptualDesign{
			Summary:   reqOutput.Summary,
			Concepts:  reqOutput.Concepts,
			Relations: reqOutput.Relations,
		}
		conceptualDesign := mergeConceptualDesign(currentConceptualDesign, rawConceptualDesign)

		// 持久化至项目陈氏图字段
		if a.ProjectService != nil && req.ProjectID != "" {
			_ = a.ProjectService.SaveConceptualDesign(ctx, req.ProjectID, conceptualDesign)
		}

		// 检查是否需要澄清
		if reqOutput.NeedClarification {
			if !sendEvent(StreamEvent{Type: EventStatus, Data: "检测到业务需求存在模糊点，已生成澄清卡片"}) {
				return
			}
			resultPayload := map[string]interface{}{
				"conceptual_design":   conceptualDesign,
				"need_clarification":  true,
				"clarification_cards": reqOutput.ClarificationCards,
				"questions":           reqOutput.Questions,
				"summary":             reqOutput.Summary,
			}
			if !sendEvent(StreamEvent{Type: EventResult, Data: resultPayload}) {
				return
			}
			saveAssistantMsg(map[string]interface{}{
				"summary":             reqOutput.Summary,
				"thinking":            thinkingBuffer.String(),
				"status":              "clarification",
				"need_clarification":  true,
				"clarification_cards": reqOutput.ClarificationCards,
				"questions":           reqOutput.Questions,
				"conceptual_design":   conceptualDesign,
			})
			sendEvent(StreamEvent{Type: EventDone, Data: true})
			return
		}

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "业务概念与陈氏关联推导完成，请在白板中审阅或直接推导物理表"}) {
			return
		}

		resultPayload := map[string]interface{}{
			"conceptual_design":  conceptualDesign,
			"need_clarification": false,
			"summary":            reqOutput.Summary,
		}
		if !sendEvent(StreamEvent{Type: EventResult, Data: resultPayload}) {
			return
		}

		saveAssistantMsg(map[string]interface{}{
			"summary":           reqOutput.Summary,
			"thinking":          thinkingBuffer.String(),
			"status":            "concept_ready",
			"conceptual_design": conceptualDesign,
		})

		sendEvent(StreamEvent{Type: EventDone, Data: true})
	}()

	return outCh, nil
}

// DerivePhysical Layer 2: 逻辑规范化与物理表工程推导算子接口
func (a *AgentService) DerivePhysical(
	ctx context.Context,
	req request.DerivePhysicalReq,
) (<-chan StreamEvent, error) {
	outCh := make(chan StreamEvent, 20)

	go func() {
		defer close(outCh)

		sendEvent := func(evt StreamEvent) bool {
			select {
			case outCh <- evt:
				return true
			case <-ctx.Done():
				return false
			}
		}

		dialect := strings.ToLower(strings.TrimSpace(req.Dialect))
		if dialect == "" {
			dialect = "mysql"
		}

		var thinkingBuffer strings.Builder
		var currentDesign *domain.ERDesign
		var conceptualDesign *domain.ConceptualDesign
		var convID string

		if a.ProjectService != nil && a.ProjectService.MessageRepo != nil && req.ProjectID != "" {
			conv, err := a.ProjectService.MessageRepo.GetOrCreateConversation(ctx, req.ProjectID)
			if err == nil && conv != nil {
				convID = conv.ID
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

		// 1. 获取现有概念模型（优先使用前端白板传入的当前快照）
		if req.ConceptualDesign != nil && len(req.ConceptualDesign.Concepts) > 0 {
			conceptualDesign = req.ConceptualDesign
		} else if a.ProjectService != nil && req.ProjectID != "" {
			cd, err := a.ProjectService.GetConceptualDesign(ctx, req.ProjectID)
			if err == nil && cd != nil && len(cd.Concepts) > 0 {
				conceptualDesign = cd
			}
		}

		if conceptualDesign == nil || len(conceptualDesign.Concepts) == 0 {
			sendEvent(StreamEvent{Type: EventError, Data: "未找到有效的概念模型，请先进行业务概念建模"})
			return
		}

		if a.ProjectService != nil && req.ProjectID != "" {
			design, err := a.ProjectService.GetERDesign(ctx, req.ProjectID)
			if err == nil {
				currentDesign = design
			}
		}

		statusMsg := fmt.Sprintf("物理架构工程师正在推导物理表与索引 (目标方言: %s)…", dialect)
		if !sendEvent(StreamEvent{Type: EventStatus, Data: statusMsg}) {
			return
		}

		erDesign, err := a.DerivePhysicalSchema(ctx, DerivePhysicalInput{
			ProjectID:        req.ProjectID,
			Dialect:          dialect,
			ConceptualDesign: conceptualDesign,
			CurrentERDesign:  currentDesign,
			ModelProvider:    req.ModelProvider,
			ModelName:        req.ModelName,
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
				"summary":  "物理数据表推导遇到异常",
				"thinking": thinkingBuffer.String(),
				"status":   "error",
				"error":    err.Error(),
			})
			return
		}

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "物理模型推导完成，正在持久化落库…"}) {
			return
		}

		if a.ProjectService != nil && req.ProjectID != "" {
			savedResult, err := a.ProjectService.SaveERDesign(ctx, req.ProjectID, *erDesign)
			if err != nil {
				sendEvent(StreamEvent{Type: EventError, Data: "物理表落库失败: " + err.Error()})
				saveAssistantMsg(map[string]interface{}{
					"summary":  "物理表落库失败",
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
			if e.Name != "" {
				entityNames = append(entityNames, e.Name)
			}
		}

		saveAssistantMsg(map[string]interface{}{
			"summary":                 fmt.Sprintf("物理表推导完成（目标方言: %s）：共生成 %d 张物理数据表、%d 条物理约束关联。", strings.ToUpper(dialect), len(erDesign.Entities), len(erDesign.Relations)),
			"thinking":                thinkingBuffer.String(),
			"status":                  "physical_ready",
			"applied_entities_count":  len(erDesign.Entities),
			"applied_relations_count": len(erDesign.Relations),
			"applied_entities":        entityNames,
		})

		sendEvent(StreamEvent{Type: EventDone, Data: true})
	}()

	return outCh, nil
}

// ReviewSchema Layer 3: 架构师质量与性能守卫接口
func (a *AgentService) ReviewSchema(
	ctx context.Context,
	req request.ReviewSchemaReq,
) (<-chan StreamEvent, error) {
	outCh := make(chan StreamEvent, 20)

	go func() {
		defer close(outCh)

		sendEvent := func(evt StreamEvent) bool {
			select {
			case outCh <- evt:
				return true
			case <-ctx.Done():
				return false
			}
		}

		var convID string
		if a.ProjectService != nil && a.ProjectService.MessageRepo != nil && req.ProjectID != "" {
			conv, err := a.ProjectService.MessageRepo.GetOrCreateConversation(ctx, req.ProjectID)
			if err == nil && conv != nil {
				convID = conv.ID
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

		var thinkingBuffer strings.Builder

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "首席数据架构师正在进行全方位质量与性能体检…"}) {
			return
		}

		var erDesign *domain.ERDesign
		if a.ProjectService != nil && req.ProjectID != "" {
			design, err := a.ProjectService.GetERDesign(ctx, req.ProjectID)
			if err == nil {
				erDesign = design
			}
		}

		if erDesign == nil || len(erDesign.Entities) == 0 {
			sendEvent(StreamEvent{Type: EventError, Data: "当前画布无物理数据表，无法执行架构体检"})
			return
		}

		report, err := a.ReviewPhysicalSchema(ctx, ReviewSchemaInput{
			ProjectID:       req.ProjectID,
			Dialect:         req.Dialect,
			CurrentERDesign: erDesign,
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
				"summary":  "架构体检遇到异常",
				"thinking": thinkingBuffer.String(),
				"status":   "error",
				"error":    err.Error(),
			})
			return
		}

		if !sendEvent(StreamEvent{Type: EventStatus, Data: fmt.Sprintf("体检完成！健康度得分: %d 分", report.Score)}) {
			return
		}

		if !sendEvent(StreamEvent{Type: EventResult, Data: report}) {
			return
		}

		saveAssistantMsg(map[string]interface{}{
			"summary":       fmt.Sprintf("数据库架构体检完成：综合评分 %d 分（共审查 %d 项指标，通过 %d 项，发现 %d 项需关注的架构隐患）。", report.Score, report.TotalCount, report.PassedCount, len(report.Issues)),
			"thinking":      thinkingBuffer.String(),
			"status":        "review_ready",
			"review_report": report,
		})

		sendEvent(StreamEvent{Type: EventDone, Data: true})
	}()

	return outCh, nil
}

// mergeConceptualDesign 对比并合并新旧概念模型，保持已有概念的 ID、坐标 Position 和已有属性稳定
func mergeConceptualDesign(existing *domain.ConceptualDesign, incoming domain.ConceptualDesign) domain.ConceptualDesign {
	if existing == nil || len(existing.Concepts) == 0 {
		for i := range incoming.Concepts {
			if incoming.Concepts[i].ID == "" {
				incoming.Concepts[i].ID = id.NewUUIDv7()
			}
			for j := range incoming.Concepts[i].Attributes {
				if incoming.Concepts[i].Attributes[j].ID == "" {
					incoming.Concepts[i].Attributes[j].ID = id.NewUUIDv7()
				}
			}
		}
		for i := range incoming.Relations {
			if incoming.Relations[i].ID == "" {
				incoming.Relations[i].ID = id.NewUUIDv7()
			}
		}
		return incoming
	}

	existingConceptsByName := make(map[string]domain.BusinessConcept, len(existing.Concepts))
	existingConceptsByID := make(map[string]domain.BusinessConcept, len(existing.Concepts))
	for _, c := range existing.Concepts {
		if c.ID != "" {
			existingConceptsByID[c.ID] = c
		}
		existingConceptsByName[strings.ToLower(c.Name)] = c
		if c.DisplayName != "" {
			existingConceptsByName[strings.ToLower(c.DisplayName)] = c
		}
	}

	for i := range incoming.Concepts {
		inc := &incoming.Concepts[i]
		var matched *domain.BusinessConcept
		if inc.ID != "" {
			if old, ok := existingConceptsByID[inc.ID]; ok {
				matched = &old
			}
		}
		if matched == nil {
			if old, ok := existingConceptsByName[strings.ToLower(inc.Name)]; ok {
				matched = &old
			} else if inc.DisplayName != "" {
				if old, ok := existingConceptsByName[strings.ToLower(inc.DisplayName)]; ok {
					matched = &old
				}
			}
		}

		if matched != nil {
			if inc.ID == "" {
				inc.ID = matched.ID
			}
			if inc.Position == nil && matched.Position != nil {
				inc.Position = matched.Position
			}
			// 保持已有属性的 ID 稳定
			oldAttrMap := make(map[string]string, len(matched.Attributes))
			for _, a := range matched.Attributes {
				oldAttrMap[strings.ToLower(a.Name)] = a.ID
				if a.DisplayName != "" {
					oldAttrMap[strings.ToLower(a.DisplayName)] = a.ID
				}
			}
			for j := range inc.Attributes {
				if inc.Attributes[j].ID == "" {
					if oldID, ok := oldAttrMap[strings.ToLower(inc.Attributes[j].Name)]; ok {
						inc.Attributes[j].ID = oldID
					} else if inc.Attributes[j].DisplayName != "" {
						if oldID, ok := oldAttrMap[strings.ToLower(inc.Attributes[j].DisplayName)]; ok {
							inc.Attributes[j].ID = oldID
						} else {
							inc.Attributes[j].ID = id.NewUUIDv7()
						}
					} else {
						inc.Attributes[j].ID = id.NewUUIDv7()
					}
				}
			}
		} else {
			if inc.ID == "" {
				inc.ID = id.NewUUIDv7()
			}
			for j := range inc.Attributes {
				if inc.Attributes[j].ID == "" {
					inc.Attributes[j].ID = id.NewUUIDv7()
				}
			}
		}
	}

	// 保持关系 ID 与坐标稳定
	for i := range incoming.Relations {
		rel := &incoming.Relations[i]
		if rel.ID == "" {
			for _, oldR := range existing.Relations {
				if strings.EqualFold(oldR.SourceConcept, rel.SourceConcept) &&
					strings.EqualFold(oldR.TargetConcept, rel.TargetConcept) &&
					oldR.Cardinality == rel.Cardinality {
					rel.ID = oldR.ID
					if rel.Position == nil {
						rel.Position = oldR.Position
					}
					break
				}
			}
		}
		if rel.ID == "" {
			rel.ID = id.NewUUIDv7()
		}
	}

	return incoming
}
