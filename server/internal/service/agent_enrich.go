package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/pkg/llmjson"
	"archcanvas/pkg/naming"

	"github.com/cloudwego/eino/schema"
)

type EnrichSemanticsResult struct {
	Design           domain.ERDesign         `json:"design"`
	ConceptualDesign domain.ConceptualDesign `json:"conceptual_design"`
}

type inferredEntitySemantic struct {
	Name        string `json:"name"`
	Comment     string `json:"comment"`
	Description string `json:"description"`
	Attributes  []struct {
		Name    string `json:"name"`
		Comment string `json:"comment"`
	} `json:"attributes"`
}

type inferredRelationSemantic struct {
	SourceConcept string `json:"source_concept"`
	TargetConcept string `json:"target_concept"`
	Name          string `json:"name"`
}

type inferredSemanticsPayload struct {
	Entities  []inferredEntitySemantic   `json:"entities"`
	Relations []inferredRelationSemantic `json:"relations"`
}

// EnrichSemantics 轻量 LLM 全图概念层语义推导核心算子
func (a *AgentService) EnrichSemantics(
	ctx context.Context,
	req dto.EnrichSemanticsReq,
) (*EnrichSemanticsResult, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if a.ProjectService != nil && strings.TrimSpace(req.ProjectID) != "" {
		if _, err := a.ProjectService.EnsureWritableProject(ctx, req.ProjectID); err != nil {
			return nil, err
		}
	}

	runCtx, finishRun := a.lifecycle.beginRun(ctx, req.ProjectID, defaultAgentRunTimeout)
	defer finishRun()

	var currentDesign *domain.ERDesign

	if req.Design != nil && len(req.Design.Entities) > 0 {
		currentDesign = req.Design
	} else if a.ProjectService != nil && req.ProjectID != "" {
		d, err := a.ProjectService.GetERDesign(runCtx, req.ProjectID)
		if err != nil {
			return nil, err
		}
		currentDesign = d
	}

	if currentDesign == nil || len(currentDesign.Entities) == 0 {
		return &EnrichSemanticsResult{
			Design: domain.ERDesign{
				Entities:  []domain.Entity{},
				Relations: []domain.Relation{},
			},
			ConceptualDesign: domain.ConceptualDesign{
				Concepts:  []domain.BusinessConcept{},
				Relations: []domain.ConceptRelation{},
			},
		}, nil
	}

	designCopy := deepCopyERDesign(*currentDesign)

	enrichedPayload, err := a.inferSemanticsWithLLM(runCtx, req, designCopy)
	if err != nil && (errors.Is(err, context.Canceled) || runCtx.Err() != nil) {
		return nil, runCtx.Err()
	}
	if enrichedPayload == nil || len(enrichedPayload.Entities) == 0 {
		if runCtx.Err() != nil {
			return nil, runCtx.Err()
		}
		enrichedPayload = inferSemanticsRuleBased(designCopy)
	}

	applySemanticsToDesign(&designCopy, enrichedPayload)

	rawConceptualDesign := buildConceptualDesignFromEnriched(designCopy, enrichedPayload)
	var existingConceptual *domain.ConceptualDesign
	if a.ProjectService != nil && req.ProjectID != "" {
		existingConceptual, _ = a.ProjectService.GetConceptualDesign(runCtx, req.ProjectID)
	}
	conceptualDesign := domain.MergeConceptualDesign(existingConceptual, rawConceptualDesign)

	if a.ProjectService != nil && req.ProjectID != "" {
		savedRes, err := a.ProjectService.SaveERDesign(runCtx, req.ProjectID, designCopy)
		if err != nil {
			return nil, fmt.Errorf("持久化富化物理模型失败: %w", err)
		}
		if savedRes != nil && savedRes.Design != nil {
			designCopy = *savedRes.Design
		}
		if err := a.ProjectService.SaveConceptualDesign(runCtx, req.ProjectID, conceptualDesign); err != nil {
			return nil, fmt.Errorf("持久化富化概念模型失败: %w", err)
		}
	}

	return &EnrichSemanticsResult{
		Design:           designCopy,
		ConceptualDesign: conceptualDesign,
	}, nil
}

func (a *AgentService) inferSemanticsWithLLM(
	ctx context.Context,
	req dto.EnrichSemanticsReq,
	design domain.ERDesign,
) (*inferredSemanticsPayload, error) {
	payload, _, err := executeStructuredStream(ctx, a, structuredStreamConfig[inferredSemanticsPayload]{
		ModelProvider:      req.ModelProvider,
		ModelName:          req.ModelName,
		InitialMessages:    buildEnrichSemanticsMessages(design),
		MaxRetries:         2,
		RetryOnStreamError: true,
		ParseContent: func(raw string) (*inferredSemanticsPayload, error) {
			return llmjson.Parse[inferredSemanticsPayload](raw, func(p *inferredSemanticsPayload) error {
				if len(p.Entities) == 0 {
					return errors.New("entities in inferred semantics payload cannot be empty")
				}
				return nil
			})
		},
		BuildRetryPrompt: func(_ error) string {
			return "【语义推导格式纠错】你上一轮输出未能通过系统 JSON 结构化解析，请必须返回包含 entities 与 relations 的纯标准 JSON，确保括号闭合，勿输出无关的解释性文字。"
		},
		FinalErrorMessage: "failed to parse inferred semantics JSON after retries",
	})
	return payload, err
}

func buildEnrichSemanticsMessages(design domain.ERDesign) []*schema.Message {
	var system strings.Builder
	system.WriteString("你是一位精通领域驱动设计（DDD）与数据库逆向工程的资深概念建模专家。\n")
	system.WriteString("请深入分析以下数据库物理表结构、字段命名及关联关系，结合全局业务上下文，为全图推导地道、准确的**业务概念中文名称与释义**。\n\n")
	system.WriteString("【命名核心铁律（必须严格执行）】：\n")
	system.WriteString("1. 【实体概念名（comment）】：必须是纯粹、地道的高阶中文名词（如'租户'、'岗位'、'员工'、'角色'、'订单'、'商品'），严禁拼接'表'、'实体'、'概念'等技术后缀！\n")
	system.WriteString("2. 【属性名称（comment）】：根据字段名与所在业务实体推导简洁准确的中文释义。\n")
	system.WriteString("3. 【联系动词（relation name）】：推导简洁明了的概念层动词（如'包含'、'拥有'、'担任'、'归属'、'购买'）。\n\n")
	system.WriteString("【输出要求】：直接且仅输出包含 entities 与 relations 的标准 JSON 对象。")

	var user strings.Builder
	user.WriteString("【当前待推导全图数据模型】：\n")
	for i, e := range design.Entities {
		user.WriteString(fmt.Sprintf("%d. 表名: %s", i+1, e.Name))
		if e.Comment != "" {
			user.WriteString(fmt.Sprintf(" (已有注释: %s)", e.Comment))
		}
		user.WriteString("\n   字段列表: ")
		colNames := make([]string, 0, len(e.Attributes))
		for _, a := range e.Attributes {
			colDesc := a.Name
			if a.Comment != "" {
				colDesc += fmt.Sprintf("(%s)", a.Comment)
			}
			colNames = append(colNames, colDesc)
		}
		user.WriteString(strings.Join(colNames, ", "))
		user.WriteString("\n")
	}

	if len(design.Relations) > 0 {
		user.WriteString("\n【已有表间关联】：\n")
		lookup := design.EntityLookup()
		for _, r := range design.Relations {
			src := r.SourceEntityID
			if ent, ok := design.FindEntity(src, lookup); ok {
				src = ent.Name
			}
			tgt := r.TargetEntityID
			if ent, ok := design.FindEntity(tgt, lookup); ok {
				tgt = ent.Name
			}
			user.WriteString(fmt.Sprintf("- %s -> %s (%s)\n", src, tgt, r.EffectiveCardinality()))
		}
	}

	user.WriteString("\n请推导并输出完整的 JSON 语义映射方案。")

	return []*schema.Message{
		schema.SystemMessage(system.String()),
		schema.UserMessage(truncateRunes(user.String(), maxPromptContextChars)),
	}
}

func applySemanticsToDesign(design *domain.ERDesign, payload *inferredSemanticsPayload) {
	if payload == nil {
		return
	}

	semanticByEntityName := make(map[string]inferredEntitySemantic, len(payload.Entities))
	for _, sem := range payload.Entities {
		semanticByEntityName[strings.ToLower(strings.TrimSpace(sem.Name))] = sem
	}

	for i := range design.Entities {
		ent := &design.Entities[i]
		cleanName := strings.ToLower(strings.TrimSpace(ent.Name))

		if sem, ok := semanticByEntityName[cleanName]; ok {
			cleanComment := sanitizeConceptName(sem.Comment)
			if cleanComment != "" {
				ent.Comment = cleanComment
			}

			attrSemMap := make(map[string]string, len(sem.Attributes))
			for _, a := range sem.Attributes {
				attrSemMap[strings.ToLower(strings.TrimSpace(a.Name))] = strings.TrimSpace(a.Comment)
			}

			for j := range ent.Attributes {
				attr := &ent.Attributes[j]
				cleanAttrName := strings.ToLower(strings.TrimSpace(attr.Name))
				if c, exists := attrSemMap[cleanAttrName]; exists && c != "" {
					attr.Comment = c
				}
			}
		} else if ent.Comment != "" {
			ent.Comment = sanitizeConceptName(ent.Comment)
		}
	}
}

func sanitizeConceptName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.TrimSuffix(name, "概念")
	name = strings.TrimSuffix(name, "信息表")
	name = strings.TrimSuffix(name, "数据表")
	name = strings.TrimSuffix(name, "主表")
	name = strings.TrimSuffix(name, "表")
	return strings.TrimSpace(name)
}

func buildConceptualDesignFromEnriched(
	design domain.ERDesign,
	payload *inferredSemanticsPayload,
) domain.ConceptualDesign {
	concepts := make([]domain.BusinessConcept, 0, len(design.Entities))
	junctionMatches := domain.DetectJunctionTables(&design)
	junctionByID := make(map[string]domain.JunctionTableMatch, len(junctionMatches))
	junctionByName := make(map[string]domain.JunctionTableMatch, len(junctionMatches))
	for _, m := range junctionMatches {
		if m.Entity.ID != "" {
			junctionByID[m.Entity.ID] = m
		}
		if m.Entity.Name != "" {
			junctionByName[strings.ToLower(strings.TrimSpace(m.Entity.Name))] = m
		}
	}

	relations := make([]domain.ConceptRelation, 0)
	lookup := design.EntityLookup()

	for _, e := range design.Entities {
		m, isJunc := junctionByID[e.ID]
		if !isJunc && e.Name != "" {
			m, isJunc = junctionByName[strings.ToLower(strings.TrimSpace(e.Name))]
		}
		if isJunc {
			relName := e.Comment
			if relName == "" {
				relName = "关联"
			}
			relations = append(relations, domain.ConceptRelation{
				ID:            "junction_" + e.ID,
				Name:          relName,
				SourceConcept: m.LeftTarget.Name,
				TargetConcept: m.RightTarget.Name,
				Cardinality:   domain.CardManyToMany,
			})
			continue
		}

		displayName := e.Comment
		if displayName == "" {
			displayName = capitalize(e.Name)
		}

		attrs := make([]domain.ConceptAttribute, 0, len(e.Attributes))
		for _, a := range e.Attributes {
			if domain.IsTechnicalAuditColumn(a.Name) {
				continue
			}
			attrDisplay := a.Comment
			if attrDisplay == "" {
				attrDisplay = capitalize(a.Name)
			}
			attrs = append(attrs, domain.ConceptAttribute{
				ID:            a.ID,
				Name:          a.Name,
				DisplayName:   attrDisplay,
				Category:      mapDBTypeToCategory(a.DBType),
				IsBusinessKey: a.IsPrimaryKey || a.IsUnique,
				Required:      !a.IsNullable,
			})
		}

		concepts = append(concepts, domain.BusinessConcept{
			ID:          e.ID,
			Name:        e.Name,
			DisplayName: displayName,
			Position:    domain.ClonePosition(e.Position),
			Attributes:  attrs,
		})
	}

	verbMap := make(map[string]string)
	if payload != nil {
		for _, r := range payload.Relations {
			k := fmt.Sprintf("%s->%s", strings.ToLower(r.SourceConcept), strings.ToLower(r.TargetConcept))
			verbMap[k] = r.Name
		}
	}

	for _, r := range design.Relations {
		if _, isSrcJ := junctionByID[r.SourceEntityID]; isSrcJ {
			continue
		}
		if _, isTgtJ := junctionByID[r.TargetEntityID]; isTgtJ {
			continue
		}
		if _, isSrcJ := junctionByName[strings.ToLower(strings.TrimSpace(r.SourceEntityID))]; isSrcJ {
			continue
		}
		if _, isTgtJ := junctionByName[strings.ToLower(strings.TrimSpace(r.TargetEntityID))]; isTgtJ {
			continue
		}

		src := r.SourceEntityID
		if ent, ok := design.FindEntity(src, lookup); ok {
			src = ent.Name
		}
		tgt := r.TargetEntityID
		if ent, ok := design.FindEntity(tgt, lookup); ok {
			tgt = ent.Name
		}

		verb := "关联"
		k := fmt.Sprintf("%s->%s", strings.ToLower(src), strings.ToLower(tgt))
		if v, ok := verbMap[k]; ok && v != "" {
			verb = v
		}

		card := domain.ConceptCardinality(r.EffectiveCardinality())

		relations = append(relations, domain.ConceptRelation{
			ID:            r.ID,
			Name:          verb,
			SourceConcept: src,
			TargetConcept: tgt,
			Cardinality:   card,
		})
	}

	return domain.ConceptualDesign{
		Summary:   "由 AI 智能推导的全图业务概念模型",
		Concepts:  concepts,
		Relations: relations,
	}
}

func mapDBTypeToCategory(dbType string) domain.AttributeCategory {
	u := strings.ToUpper(strings.TrimSpace(dbType))
	if strings.Contains(u, "BOOL") || strings.Contains(u, "TINYINT(1)") {
		return domain.AttrBoolean
	}
	if (strings.Contains(u, "INT") && !strings.Contains(u, "POINT") && !strings.Contains(u, "INTERVAL")) ||
		strings.Contains(u, "SERIAL") || strings.Contains(u, "DECIMAL") || strings.Contains(u, "NUMERIC") ||
		strings.Contains(u, "FLOAT") || strings.Contains(u, "DOUBLE") || strings.Contains(u, "REAL") {
		return domain.AttrNumber
	}
	if strings.Contains(u, "TIME") || strings.Contains(u, "DATE") {
		return domain.AttrDateTime
	}
	if strings.Contains(u, "BLOB") || strings.Contains(u, "BINARY") || strings.Contains(u, "BYTEA") {
		return domain.AttrMedia
	}
	return domain.AttrString
}

func capitalize(s string) string {
	runes := []rune(s)
	if len(runes) == 0 {
		return ""
	}
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

func deepCopyERDesign(src domain.ERDesign) domain.ERDesign {
	b, err := json.Marshal(src)
	if err != nil {
		return src
	}
	var out domain.ERDesign
	_ = json.Unmarshal(b, &out)
	return out
}

func inferSemanticsRuleBased(design domain.ERDesign) *inferredSemanticsPayload {
	dict := map[string]string{
		"tenant": "租户", "tenants": "租户",
		"position": "岗位", "positions": "岗位", "job": "岗位", "jobs": "岗位",
		"user": "用户", "users": "用户", "account": "账号", "accounts": "账号",
		"role": "角色", "roles": "角色", "permission": "权限点", "permissions": "权限点",
		"department": "部门", "departments": "部门", "dept": "部门", "org": "组织机构",
		"employee": "员工", "employees": "员工", "staff": "员工",
		"company": "企业", "enterprise": "企业",
		"order": "订单", "orders": "订单", "order_item": "订单明细", "order_items": "订单明细",
		"product": "商品", "products": "商品", "sku": "SKU规格", "skus": "SKU规格",
		"customer": "客户", "customers": "客户", "client": "客户",
		"log": "日志", "logs": "日志", "audit_log": "审计日志", "audit_logs": "审计日志",
	}

	attrDict := map[string]string{
		"id": "主键ID", "tenant_id": "所属租户", "user_id": "关联用户", "role_id": "关联角色",
		"name": "名称", "title": "标题", "code": "编码", "description": "描述", "remark": "备注",
		"status": "状态", "type": "类型", "category": "类别",
		"phone": "手机号", "email": "电子邮箱", "avatar": "头像",
		"created_at": "创建时间", "updated_at": "更新时间", "deleted_at": "删除时间",
		"sort_order": "排序权重", "is_active": "是否启用",
	}

	payload := &inferredSemanticsPayload{
		Entities:  make([]inferredEntitySemantic, 0, len(design.Entities)),
		Relations: make([]inferredRelationSemantic, 0),
	}

	for _, e := range design.Entities {
		clean := strings.ToLower(strings.TrimSpace(e.Name))
		comment := e.Comment
		if comment == "" {
			if c, ok := dict[clean]; ok {
				comment = c
			} else if c, ok := dict[naming.Singularize(clean)]; ok {
				comment = c
			} else {
				comment = capitalize(clean)
			}
		} else {
			comment = sanitizeConceptName(comment)
		}

		entSem := inferredEntitySemantic{
			Name:        e.Name,
			Comment:     comment,
			Description: comment + "业务实体",
		}
		for _, a := range e.Attributes {
			ac := a.Comment
			if ac == "" {
				lowerA := strings.ToLower(strings.TrimSpace(a.Name))
				if v, ok := attrDict[lowerA]; ok {
					ac = v
				} else {
					ac = a.Name
				}
			}
			entSem.Attributes = append(entSem.Attributes, struct {
				Name    string `json:"name"`
				Comment string `json:"comment"`
			}{
				Name:    a.Name,
				Comment: ac,
			})
		}
		payload.Entities = append(payload.Entities, entSem)
	}

	return payload
}
