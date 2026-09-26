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
			return
		}

		if !sendEvent(StreamEvent{Type: EventStatus, Data: "物理模型推导完成，正在持久化落库…"}) {
			return
		}

		if a.ProjectService != nil && req.ProjectID != "" {
			savedResult, err := a.ProjectService.SaveERDesign(ctx, req.ProjectID, *erDesign)
			if err != nil {
				sendEvent(StreamEvent{Type: EventError, Data: "物理表落库失败: " + err.Error()})
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

		report := evaluateSchemaHealth(erDesign, req.Dialect)

		// 模拟架构师审查流式日志
		thinking := fmt.Sprintf("已扫描 %d 张物理表与 %d 组关系，开始多维度架构审查：\n"+
			"1. 外键与查询索引覆盖度检查...\n"+
			"2. 范式合规度与主键完整性核对...\n"+
			"3. 命名一致性与注释完备性校验...\n"+
			"体检完成，当前健康度评分: %d/100。", len(erDesign.Entities), len(erDesign.Relations), report.Score)

		sendEvent(StreamEvent{Type: EventThinking, Data: thinking})

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

// evaluateSchemaHealth 对物理模型进行静态架构体检分析并生成打分报告
func evaluateSchemaHealth(design *domain.ERDesign, dialect string) domain.SchemaReviewReport {
	issues := make([]domain.SchemaIssue, 0)
	totalChecks := 0

	for _, entity := range design.Entities {
		totalChecks += 4

		// 1. 主键检查
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
				Title:       "缺失主键定义",
				Description: fmt.Sprintf("数据表 %q 缺少主键字段，会导致无法唯一定位行记录，并在复制或集群同步时引发严重性能问题。", entity.Name),
				EntityName:  entity.Name,
				Suggestion:  "为该表增加名为 `id` 的主键列 (如 BIGINT 或 UUIDv7)。",
			})
		}

		// 2. 索引盲区检查：外键字段是否具有索引覆盖
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
						Title:       fmt.Sprintf("外键字段 %q 缺少前缀索引", attr.Name),
						Description: fmt.Sprintf("表 %q 的关联字段 %q 未被任何索引的最左前缀覆盖，多表 JOIN 时将退化为全表扫描并容易造成行锁升级。", entity.Name, attr.Name),
						EntityName:  entity.Name,
						ColumnName:  attr.Name,
						Suggestion:  fmt.Sprintf("为字段 %q 建立单列索引或将其置于联合索引第一列：idx_%s_%s", attr.Name, entity.Name, attr.Name),
					})
				}
			}
		}

		// 3. 注释规范检查
		if strings.TrimSpace(entity.Comment) == "" {
			issues = append(issues, domain.SchemaIssue{
				ID:          id.NewUUIDv7(),
				Category:    domain.CategoryNaming,
				Severity:    domain.SeverityInfo,
				Title:       "缺少表业务注释",
				Description: fmt.Sprintf("物理表 %q 缺少中文业务注释，不利于团队协作与 SQL COMMENT 生成。", entity.Name),
				EntityName:  entity.Name,
				Suggestion:  "在表配置中补充明确的业务领域中文释义。",
			})
		}

		// 4. 大字段集中度检查
		textColCount := 0
		for _, attr := range entity.Attributes {
			t := strings.ToUpper(attr.DBType)
			if strings.Contains(t, "TEXT") || strings.Contains(t, "BLOB") {
				textColCount++
			}
		}
		if textColCount >= 3 {
			issues = append(issues, domain.SchemaIssue{
				ID:          id.NewUUIDv7(),
				Category:    domain.CategoryPerformance,
				Severity:    domain.SeverityWarning,
				Title:       "单表包含过多大文本字段",
				Description: fmt.Sprintf("表 %q 包含了 %d 个 TEXT/BLOB 大字段，容易触发数据库行溢出（Row Overflow），大幅降低主索引页缓存命中率。", entity.Name, textColCount),
				EntityName:  entity.Name,
				Suggestion:  "建议将富文本或大 JSON 数据拆分到独立的扩展附表（如垂直分表）按需加载。",
			})
		}
	}

	// 评分算法：满分 100，Critical 扣 20 分，Warning 扣 8 分，Info 扣 2 分
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

	summary := "架构设计非常规范，未发现重大结构缺陷与性能风险！"
	if score < 60 {
		summary = "存在重大架构缺陷（如缺失主键或大面积外键无索引），强烈建议采纳修复方案后再行建表上线。"
	} else if score < 85 {
		summary = "物理模型基本合格，但存在若干性能优化点（如建议补充外键索引或完善业务注释）。"
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
