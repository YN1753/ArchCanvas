package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/pkg/id"
)

func clonePosition(pos *domain.Position) *domain.Position {
	if pos == nil {
		return nil
	}
	return &domain.Position{X: pos.X, Y: pos.Y}
}

func deepCopyConceptualDesign(src *domain.ConceptualDesign) *domain.ConceptualDesign {
	if src == nil {
		return nil
	}
	b, err := json.Marshal(src)
	if err != nil {
		cp := *src
		return &cp
	}
	var out domain.ConceptualDesign
	if err := json.Unmarshal(b, &out); err != nil {
		cp := *src
		return &cp
	}
	return &out
}

// ProposeConcepts Layer 1: 业务需求与概念建模算子接口
func (a *AgentService) ProposeConcepts(
	ctx context.Context,
	req dto.ProposeConceptsReq,
) (<-chan StreamEvent, error) {
	outCh := make(chan StreamEvent, sseChannelBufferSize)
	runCtx, finishRun := a.lifecycle.beginRun(ctx, req.ProjectID, defaultAgentRunTimeout)

	go func() {
		defer close(outCh)
		defer finishRun()

		sendEvent := makeStreamSender(runCtx, outCh)
		var thinkingBuffer strings.Builder

		convID, currentConceptualDesign, currentDesign, historyMessages, storedConstraints, storedDecisions :=
			a.loadProjectTurnContext(runCtx, req.ProjectID, req.Input, 6)

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "AI 需求分析师正在梳理业务概念与实体边界…"}) {
			return
		}

		reqOutput, err := a.AnalyzeRequirement(runCtx, RequirementInput{
			ProjectID:               req.ProjectID,
			Message:                 req.Input,
			HistoryMessages:         historyMessages,
			Constraints:             storedConstraints,
			Decisions:               storedDecisions,
			CurrentConceptualDesign: currentConceptualDesign,
			CurrentERDesign:         currentDesign,
			ModelProvider:           req.ModelProvider,
			ModelName:               req.ModelName,
		}, func(chunk string) {
			thinkingBuffer.WriteString(chunk)
			sendEvent(StreamEvent{Type: EventThinking, Data: chunk})
		})
		if err != nil {
			if errors.Is(err, context.Canceled) || runCtx.Err() != nil {
				return
			}
			sendEvent(StreamEvent{Type: EventError, Data: err.Error()})
			a.saveAssistantMessage(convID, map[string]any{
				"summary":  "业务概念分析遇到异常",
				"thinking": thinkingBuffer.String(),
				"status":   "error",
				"error":    err.Error(),
			})
			return
		}

		// [P0-DATA-02] 当触发澄清追问且本次未生成新概念时，绝不覆盖清空项目已有的概念模型与 AIContext！
		if reqOutput.NeedClarification {
			var preservedConcept domain.ConceptualDesign
			if currentConceptualDesign != nil && len(currentConceptualDesign.Concepts) > 0 {
				preservedConcept = *deepCopyConceptualDesign(currentConceptualDesign)
			} else if len(reqOutput.Concepts) > 0 {
				preservedConcept = mergeConceptualDesign(currentConceptualDesign, domain.ConceptualDesign{
					Summary:   reqOutput.Summary,
					Concepts:  reqOutput.Concepts,
					Relations: reqOutput.Relations,
				})
				if a.ProjectService != nil && req.ProjectID != "" {
					_ = a.ProjectService.SaveConceptualDesign(runCtx, req.ProjectID, preservedConcept)
				}
			}

			a.saveAssistantMessage(convID, map[string]any{
				"summary":             reqOutput.Summary,
				"thinking":            thinkingBuffer.String(),
				"status":              "clarification",
				"need_clarification":  true,
				"clarification_cards": reqOutput.ClarificationCards,
				"questions":           reqOutput.Questions,
				"conceptual_design":   preservedConcept,
			})

			if !sendEvent(StreamEvent{Type: EventStatus, Data: "检测到业务需求存在模糊点，已生成澄清卡片"}) {
				return
			}
			resultPayload := map[string]any{
				"conceptual_design":   preservedConcept,
				"need_clarification":  true,
				"clarification_cards": reqOutput.ClarificationCards,
				"questions":           reqOutput.Questions,
				"summary":             reqOutput.Summary,
			}
			if !sendEvent(StreamEvent{Type: EventResult, Data: resultPayload}) {
				return
			}
			sendEvent(StreamEvent{Type: EventDone, Data: true})
			return
		}

		if a.ProjectService != nil && req.ProjectID != "" {
			_ = a.ProjectService.MergeAndSaveAIContext(
				runCtx,
				req.ProjectID,
				reqOutput.Summary,
				reqOutput.Assumptions,
				reqOutput.NegativeConstraints,
			)
		}

		rawConceptualDesign := domain.ConceptualDesign{
			Summary:   reqOutput.Summary,
			Concepts:  reqOutput.Concepts,
			Relations: reqOutput.Relations,
		}
		conceptualDesign := mergeConceptualDesign(currentConceptualDesign, rawConceptualDesign)

		if a.ProjectService != nil && req.ProjectID != "" {
			if err := a.ProjectService.SaveConceptualDesign(runCtx, req.ProjectID, conceptualDesign); err != nil {
				sendEvent(StreamEvent{Type: EventError, Data: "概念模型持久化失败: " + err.Error()})
				a.saveAssistantMessage(convID, map[string]any{
					"summary":  "概念模型持久化失败",
					"thinking": thinkingBuffer.String(),
					"status":   "error",
					"error":    err.Error(),
				})
				return
			}
		}

		a.saveAssistantMessage(convID, map[string]any{
			"summary":           reqOutput.Summary,
			"thinking":          thinkingBuffer.String(),
			"status":            "concept_ready",
			"conceptual_design": conceptualDesign,
		})

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "业务概念与陈氏关联推导完成，请在白板中审阅或直接推导物理表"}) {
			return
		}
		resultPayload := map[string]any{
			"conceptual_design":  conceptualDesign,
			"need_clarification": false,
			"summary":            reqOutput.Summary,
		}
		if !sendEvent(StreamEvent{Type: EventResult, Data: resultPayload}) {
			return
		}
		sendEvent(StreamEvent{Type: EventDone, Data: true})
	}()

	return outCh, nil
}

// DerivePhysical Layer 2: 逻辑规范化与物理表工程推导算子接口
func (a *AgentService) DerivePhysical(
	ctx context.Context,
	req dto.DerivePhysicalReq,
) (<-chan StreamEvent, error) {
	outCh := make(chan StreamEvent, sseChannelBufferSize)
	// 在启动异步协程前深拷贝传入的指针结构，防范调用方并发修改共享内存
	reqConceptSnapshot := deepCopyConceptualDesign(req.ConceptualDesign)
	runCtx, finishRun := a.lifecycle.beginRun(ctx, req.ProjectID, defaultAgentRunTimeout)

	go func() {
		defer close(outCh)
		defer finishRun()

		sendEvent := makeStreamSender(runCtx, outCh)

		dialect := strings.ToLower(strings.TrimSpace(req.Dialect))
		if dialect == "" {
			dialect = "mysql"
		}

		var thinkingBuffer strings.Builder
		var currentDesign *domain.ERDesign
		var conceptualDesign *domain.ConceptualDesign
		var convID string

		if a.ProjectService != nil && a.ProjectService.MessageRepo != nil && req.ProjectID != "" {
			if conv, err := a.ProjectService.MessageRepo.GetOrCreateConversation(runCtx, req.ProjectID); err == nil && conv != nil {
				convID = conv.ID
			}
		}

		if reqConceptSnapshot != nil && len(reqConceptSnapshot.Concepts) > 0 {
			conceptualDesign = reqConceptSnapshot
		} else if a.ProjectService != nil && req.ProjectID != "" {
			if cd, err := a.ProjectService.GetConceptualDesign(runCtx, req.ProjectID); err == nil && cd != nil && len(cd.Concepts) > 0 {
				conceptualDesign = cd
			}
		}

		if conceptualDesign == nil || len(conceptualDesign.Concepts) == 0 {
			sendEvent(StreamEvent{Type: EventError, Data: "未找到有效的概念模型，请先进行业务概念建模"})
			return
		}

		if a.ProjectService != nil && req.ProjectID != "" {
			if design, err := a.ProjectService.GetERDesign(runCtx, req.ProjectID); err == nil {
				currentDesign = design
			}
		}

		statusMsg := fmt.Sprintf("物理架构工程师正在推导物理表与索引 (目标方言: %s)…", dialect)
		if !sendEvent(StreamEvent{Type: EventStatus, Data: statusMsg}) {
			return
		}

		erDesign, err := a.DerivePhysicalSchema(runCtx, DerivePhysicalInput{
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
			if errors.Is(err, context.Canceled) || runCtx.Err() != nil {
				return
			}
			sendEvent(StreamEvent{Type: EventError, Data: err.Error()})
			a.saveAssistantMessage(convID, map[string]any{
				"summary":  "物理数据表推导遇到异常",
				"thinking": thinkingBuffer.String(),
				"status":   "error",
				"error":    err.Error(),
			})
			return
		}

		sendEvent(StreamEvent{Type: EventStatus, Data: "物理模型推导完成，正在持久化落库…"})

		finalDesign := erDesign
		if a.ProjectService != nil && req.ProjectID != "" {
			savedResult, err := a.ProjectService.SaveERDesign(runCtx, req.ProjectID, *erDesign)
			if err != nil {
				sendEvent(StreamEvent{Type: EventError, Data: "物理表落库失败: " + err.Error()})
				a.saveAssistantMessage(convID, map[string]any{
					"summary":  "物理表落库失败",
					"thinking": thinkingBuffer.String(),
					"status":   "error",
					"error":    err.Error(),
				})
				return
			}
			finalDesign = savedResult.Design
		}

		var entityNames []string
		for _, e := range finalDesign.Entities {
			if e.Name != "" {
				entityNames = append(entityNames, e.Name)
			}
		}

		a.saveAssistantMessage(convID, map[string]any{
			"summary":                 fmt.Sprintf("物理表推导完成（目标方言: %s）：共生成 %d 张物理数据表、%d 条物理约束关联。", strings.ToUpper(dialect), len(finalDesign.Entities), len(finalDesign.Relations)),
			"thinking":                thinkingBuffer.String(),
			"status":                  "physical_ready",
			"applied_entities_count":  len(finalDesign.Entities),
			"applied_relations_count": len(finalDesign.Relations),
			"applied_entities":        entityNames,
		})

		if !sendEvent(StreamEvent{Type: EventResult, Data: finalDesign}) {
			return
		}
		sendEvent(StreamEvent{Type: EventDone, Data: true})
	}()

	return outCh, nil
}

// ReviewSchema Layer 3: 架构师质量与性能守卫接口
func (a *AgentService) ReviewSchema(
	ctx context.Context,
	req dto.ReviewSchemaReq,
) (<-chan StreamEvent, error) {
	outCh := make(chan StreamEvent, sseChannelBufferSize)
	runCtx, finishRun := a.lifecycle.beginRun(ctx, req.ProjectID, defaultAgentRunTimeout)

	go func() {
		defer close(outCh)
		defer finishRun()

		sendEvent := makeStreamSender(runCtx, outCh)

		var convID string
		if a.ProjectService != nil && a.ProjectService.MessageRepo != nil && req.ProjectID != "" {
			if conv, err := a.ProjectService.MessageRepo.GetOrCreateConversation(runCtx, req.ProjectID); err == nil && conv != nil {
				convID = conv.ID
			}
		}

		var thinkingBuffer strings.Builder

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "首席数据架构师正在进行全方位质量与性能体检…"}) {
			return
		}

		var erDesign *domain.ERDesign
		if a.ProjectService != nil && req.ProjectID != "" {
			if design, err := a.ProjectService.GetERDesign(runCtx, req.ProjectID); err == nil {
				erDesign = design
			}
		}

		if erDesign == nil || len(erDesign.Entities) == 0 {
			sendEvent(StreamEvent{Type: EventError, Data: "当前画布无物理数据表，无法执行架构体检"})
			return
		}

		report, err := a.ReviewPhysicalSchema(runCtx, ReviewSchemaInput{
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
			if errors.Is(err, context.Canceled) || runCtx.Err() != nil {
				return
			}
			sendEvent(StreamEvent{Type: EventError, Data: err.Error()})
			a.saveAssistantMessage(convID, map[string]any{
				"summary":  "架构体检遇到异常",
				"thinking": thinkingBuffer.String(),
				"status":   "error",
				"error":    err.Error(),
			})
			return
		}

		a.saveAssistantMessage(convID, map[string]any{
			"summary":       fmt.Sprintf("数据库架构体检完成：综合评分 %d 分（共审查 %d 项指标，通过 %d 项，发现 %d 项需关注的架构隐患）。", report.Score, report.TotalCount, report.PassedCount, len(report.Issues)),
			"thinking":      thinkingBuffer.String(),
			"status":        "review_ready",
			"review_report": report,
		})

		if !sendEvent(StreamEvent{Type: EventStatus, Data: fmt.Sprintf("体检完成！健康度得分: %d 分", report.Score)}) {
			return
		}
		if !sendEvent(StreamEvent{Type: EventResult, Data: report}) {
			return
		}
		sendEvent(StreamEvent{Type: EventDone, Data: true})
	}()

	return outCh, nil
}

// mergeConceptualDesign 支持完整 Operation (create/modify/retain/delete) 增量合并语义，保持已有概念 ID、深拷贝 Position 与未提及已有概念稳定。
func mergeConceptualDesign(existing *domain.ConceptualDesign, incoming domain.ConceptualDesign) domain.ConceptualDesign {
	normalizeNewConcept := func(c domain.BusinessConcept) domain.BusinessConcept {
		c.Position = nil
		if c.ID == "" {
			c.ID = id.NewUUIDv7()
		}
		for j := range c.Attributes {
			if c.Attributes[j].ID == "" {
				c.Attributes[j].ID = id.NewUUIDv7()
			}
		}
		return c
	}

	if existing == nil || len(existing.Concepts) == 0 {
		kept := make([]domain.BusinessConcept, 0, len(incoming.Concepts))
		deletedNames := make(map[string]bool)
		for _, c := range incoming.Concepts {
			if c.Operation == domain.OpDelete {
				deletedNames[strings.ToLower(strings.TrimSpace(c.Name))] = true
				if c.ID != "" {
					deletedNames[strings.ToLower(c.ID)] = true
				}
				continue
			}
			kept = append(kept, normalizeNewConcept(c))
		}
		rels := make([]domain.ConceptRelation, 0, len(incoming.Relations))
		for _, r := range incoming.Relations {
			if deletedNames[strings.ToLower(strings.TrimSpace(r.SourceConcept))] ||
				deletedNames[strings.ToLower(strings.TrimSpace(r.TargetConcept))] {
				continue
			}
			r.Position = nil
			if r.ID == "" {
				r.ID = id.NewUUIDv7()
			}
			rels = append(rels, r)
		}
		return domain.ConceptualDesign{
			Summary:   incoming.Summary,
			Concepts:  kept,
			Relations: rels,
		}
	}

	existingByID := make(map[string]domain.BusinessConcept, len(existing.Concepts))
	existingByName := make(map[string]domain.BusinessConcept, len(existing.Concepts))
	for _, c := range existing.Concepts {
		if c.ID != "" {
			existingByID[c.ID] = c
		}
		existingByName[strings.ToLower(strings.TrimSpace(c.Name))] = c
		if c.DisplayName != "" {
			existingByName[strings.ToLower(strings.TrimSpace(c.DisplayName))] = c
		}
	}

	deletedIDs := make(map[string]bool)
	deletedNames := make(map[string]bool)
	handledExistingIDs := make(map[string]bool)
	mergedConcepts := make([]domain.BusinessConcept, 0, len(existing.Concepts)+len(incoming.Concepts))

	matchExisting := func(inc domain.BusinessConcept) *domain.BusinessConcept {
		if inc.ID != "" {
			if old, ok := existingByID[inc.ID]; ok {
				return &old
			}
		}
		if old, ok := existingByName[strings.ToLower(strings.TrimSpace(inc.Name))]; ok {
			return &old
		}
		if inc.DisplayName != "" {
			if old, ok := existingByName[strings.ToLower(strings.TrimSpace(inc.DisplayName))]; ok {
				return &old
			}
		}
		return nil
	}

	for _, inc := range incoming.Concepts {
		matched := matchExisting(inc)
		if inc.Operation == domain.OpDelete {
			deletedNames[strings.ToLower(strings.TrimSpace(inc.Name))] = true
			if inc.DisplayName != "" {
				deletedNames[strings.ToLower(strings.TrimSpace(inc.DisplayName))] = true
			}
			if inc.ID != "" {
				deletedIDs[inc.ID] = true
			}
			if matched != nil {
				deletedIDs[matched.ID] = true
				deletedNames[strings.ToLower(strings.TrimSpace(matched.Name))] = true
				handledExistingIDs[matched.ID] = true
			}
			continue
		}

		if matched != nil {
			handledExistingIDs[matched.ID] = true
			if inc.ID == "" {
				inc.ID = matched.ID
			}
			inc.Position = clonePosition(matched.Position)
			// 若模型输出了 retain 但未重复填写属性列表，继承旧属性防止误清空
			if len(inc.Attributes) == 0 && len(matched.Attributes) > 0 {
				inc.Attributes = append([]domain.ConceptAttribute(nil), matched.Attributes...)
			} else {
				oldAttrMap := make(map[string]string, len(matched.Attributes)*2)
				for _, a := range matched.Attributes {
					oldAttrMap[strings.ToLower(strings.TrimSpace(a.Name))] = a.ID
					if a.DisplayName != "" {
						oldAttrMap[strings.ToLower(strings.TrimSpace(a.DisplayName))] = a.ID
					}
				}
				for j := range inc.Attributes {
					if inc.Attributes[j].ID == "" {
						if oldID, ok := oldAttrMap[strings.ToLower(strings.TrimSpace(inc.Attributes[j].Name))]; ok && oldID != "" {
							inc.Attributes[j].ID = oldID
						} else if inc.Attributes[j].DisplayName != "" {
							if oldID, ok := oldAttrMap[strings.ToLower(strings.TrimSpace(inc.Attributes[j].DisplayName))]; ok && oldID != "" {
								inc.Attributes[j].ID = oldID
							} else {
								inc.Attributes[j].ID = id.NewUUIDv7()
							}
						} else {
							inc.Attributes[j].ID = id.NewUUIDv7()
						}
					}
				}
			}
			mergedConcepts = append(mergedConcepts, inc)
		} else {
			mergedConcepts = append(mergedConcepts, normalizeNewConcept(inc))
		}
	}

	// 增量保护：当模型在增量对话中仅输出了新增/修改/删除的部分概念时，自动保留未被标记删除的既有概念
	hasDeltaOp := false
	for _, inc := range incoming.Concepts {
		if inc.Operation == domain.OpCreate || inc.Operation == domain.OpModify || inc.Operation == domain.OpDelete {
			hasDeltaOp = true
			break
		}
	}
	if hasDeltaOp || len(incoming.Concepts) < len(existing.Concepts) {
		for _, oldC := range existing.Concepts {
			if handledExistingIDs[oldC.ID] || deletedIDs[oldC.ID] || deletedNames[strings.ToLower(strings.TrimSpace(oldC.Name))] {
				continue
			}
			cloned := oldC
			cloned.Position = clonePosition(oldC.Position)
			cloned.Attributes = append([]domain.ConceptAttribute(nil), oldC.Attributes...)
			mergedConcepts = append(mergedConcepts, cloned)
		}
	}

	validConceptKeys := make(map[string]bool, len(mergedConcepts)*2)
	for _, c := range mergedConcepts {
		if c.ID != "" {
			validConceptKeys[strings.ToLower(c.ID)] = true
		}
		validConceptKeys[strings.ToLower(strings.TrimSpace(c.Name))] = true
	}

	isEndpointValid := func(ref string) bool {
		k := strings.ToLower(strings.TrimSpace(ref))
		return k != "" && !deletedNames[k] && validConceptKeys[k]
	}

	mergedRelations := make([]domain.ConceptRelation, 0, len(existing.Relations)+len(incoming.Relations))
	seenRelKeys := make(map[string]bool)

	for _, rel := range incoming.Relations {
		if !isEndpointValid(rel.SourceConcept) || !isEndpointValid(rel.TargetConcept) {
			continue
		}
		foundExisting := false
		if rel.ID == "" {
			for _, oldR := range existing.Relations {
				if strings.EqualFold(oldR.SourceConcept, rel.SourceConcept) &&
					strings.EqualFold(oldR.TargetConcept, rel.TargetConcept) &&
					oldR.Cardinality == rel.Cardinality {
					rel.ID = oldR.ID
					rel.Position = clonePosition(oldR.Position)
					foundExisting = true
					break
				}
			}
		} else {
			for _, oldR := range existing.Relations {
				if oldR.ID == rel.ID {
					rel.Position = clonePosition(oldR.Position)
					foundExisting = true
					break
				}
			}
		}
		if !foundExisting {
			rel.Position = nil
		}
		if rel.ID == "" {
			rel.ID = id.NewUUIDv7()
		}
		relKey := fmt.Sprintf("%s->%s:%s", strings.ToLower(rel.SourceConcept), strings.ToLower(rel.TargetConcept), rel.Cardinality)
		seenRelKeys[relKey] = true
		mergedRelations = append(mergedRelations, rel)
	}

	if hasDeltaOp || len(incoming.Relations) == 0 {
		for _, oldR := range existing.Relations {
			if !isEndpointValid(oldR.SourceConcept) || !isEndpointValid(oldR.TargetConcept) {
				continue
			}
			relKey := fmt.Sprintf("%s->%s:%s", strings.ToLower(oldR.SourceConcept), strings.ToLower(oldR.TargetConcept), oldR.Cardinality)
			if seenRelKeys[relKey] {
				continue
			}
			seenRelKeys[relKey] = true
			clonedR := oldR
			clonedR.Position = clonePosition(oldR.Position)
			mergedRelations = append(mergedRelations, clonedR)
		}
	}

	summary := incoming.Summary
	if strings.TrimSpace(summary) == "" && existing != nil {
		summary = existing.Summary
	}

	return domain.ConceptualDesign{
		Summary:   summary,
		Concepts:  mergedConcepts,
		Relations: mergedRelations,
	}
}
