package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"archcanvas/internal/domain"
	"archcanvas/request"

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
	req request.EnrichSemanticsReq,
) (*EnrichSemanticsResult, error) {
	var currentDesign *domain.ERDesign

	if req.Design != nil && len(req.Design.Entities) > 0 {
		currentDesign = req.Design
	} else if a.ProjectService != nil && req.ProjectID != "" {
		d, err := a.ProjectService.GetERDesign(ctx, req.ProjectID)
		if err == nil && d != nil && len(d.Entities) > 0 {
			currentDesign = d
		}
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

	// 深拷贝一份以防外部并发修改
	designCopy := deepCopyERDesign(*currentDesign)

	// 1. 尝试使用轻量 LLM 进行全图语义推导
	enrichedPayload, err := a.inferSemanticsWithLLM(ctx, req, designCopy)
	if err != nil || enrichedPayload == nil || len(enrichedPayload.Entities) == 0 {
		// LLM 调用失败或不可用时，优雅降级至启发式规则语义推导
		enrichedPayload = inferSemanticsRuleBased(designCopy)
	}

	// 2. 将推导出的语义合并回物理表 ERDesign
	applySemanticsToDesign(&designCopy, enrichedPayload)

	// 3. 构建/同步概念数据模型 (ConceptualDesign / 陈氏图)
	conceptualDesign := buildConceptualDesignFromEnriched(designCopy, enrichedPayload)

	// 4. 若有 project_id，持久化到服务端数据库
	if a.ProjectService != nil && req.ProjectID != "" {
		_, _ = a.ProjectService.SaveERDesign(ctx, req.ProjectID, designCopy)
		_ = a.ProjectService.SaveConceptualDesign(ctx, req.ProjectID, conceptualDesign)
	}

	return &EnrichSemanticsResult{
		Design:           designCopy,
		ConceptualDesign: conceptualDesign,
	}, nil
}

func (a *AgentService) inferSemanticsWithLLM(
	ctx context.Context,
	req request.EnrichSemanticsReq,
	design domain.ERDesign,
) (*inferredSemanticsPayload, error) {
	if a.ModelManager == nil {
		return nil, fmt.Errorf("model manager not configured")
	}

	chatModel, err := a.ModelManager.GetModel(ctx, req.ModelProvider, req.ModelName)
	if err != nil {
		return nil, err
	}

	messages := buildEnrichSemanticsMessages(design)

	stream, err := chatModel.Stream(ctx, messages)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	var sb strings.Builder
	for {
		chunk, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if chunk.Content != "" {
			sb.WriteString(chunk.Content)
		}
	}

	raw := sb.String()
	candidates := extractJSONCandidates(raw)
	for _, cand := range candidates {
		var payload inferredSemanticsPayload
		if err := json.Unmarshal([]byte(cand), &payload); err == nil && len(payload.Entities) > 0 {
			return &payload, nil
		}
		cleaned := CleanJSONSyntax(cand)
		if cleaned != cand {
			var pClean inferredSemanticsPayload
			if err := json.Unmarshal([]byte(cleaned), &pClean); err == nil && len(pClean.Entities) > 0 {
				return &pClean, nil
			}
		}
	}

	return nil, fmt.Errorf("failed to parse inferred semantics JSON")
}

func buildEnrichSemanticsMessages(design domain.ERDesign) []*schema.Message {
	var system strings.Builder
	system.WriteString("你是一位精通领域驱动设计（DDD）与数据库逆向工程的资深概念建模专家。\n")
	system.WriteString("请深入分析以下数据库物理表结构、字段命名及关联关系，结合全局业务上下文（如企业ERP、电商交易、多租户SaaS、CRM等），为全图推导地道、准确的**业务概念中文名称与释义**。\n\n")
	system.WriteString("【命名核心铁律（必须严格执行）】：\n")
	system.WriteString("1. 【实体概念名（comment）】：必须是纯粹、地道的高阶中文名词（如'租户'、'岗位'、'员工'、'角色'、'订单'、'商品'），绝对严禁拼接'表'、'实体'、'概念'等技术噪音后缀！\n")
	system.WriteString("2. 【属性名称（comment）】：根据字段名与所在业务实体推导简洁准确的中文释义（如'租户编码'、'岗位名称'、'联系电话'、'启用状态'、'创建时间'）。\n")
	system.WriteString("3. 【联系动词（relation name）】：推导简洁明了的概念层动词（如'包含'、'拥有'、'担任'、'归属'、'购买'）。\n\n")
	system.WriteString("【输出要求】：\n")
	system.WriteString("直接且仅输出标准的 JSON 格式：\n")
	system.WriteString("```json\n")
	system.WriteString("{\n")
	system.WriteString("  \"entities\": [\n")
	system.WriteString("    {\n")
	system.WriteString("      \"name\": \"表名（英文）\",\n")
	system.WriteString("      \"comment\": \"纯粹中文概念名\",\n")
	system.WriteString("      \"description\": \"一句话业务含义\",\n")
	system.WriteString("      \"attributes\": [\n")
	system.WriteString("        { \"name\": \"字段名\", \"comment\": \"字段中文释义\" }\n")
	system.WriteString("      ]\n")
	system.WriteString("    }\n")
	system.WriteString("  ],\n")
	system.WriteString("  \"relations\": [\n")
	system.WriteString("    { \"source_concept\": \"源表名\", \"target_concept\": \"目标表名\", \"name\": \"动词\" }\n")
	system.WriteString("  ]\n")
	system.WriteString("}\n")
	system.WriteString("```")

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
		entityNameMap := make(map[string]string)
		for _, e := range design.Entities {
			entityNameMap[e.ID] = e.Name
			entityNameMap[strings.ToLower(e.Name)] = e.Name
		}
		for _, r := range design.Relations {
			src := entityNameMap[r.SourceEntityID]
			if src == "" {
				src = r.SourceEntityID
			}
			tgt := entityNameMap[r.TargetEntityID]
			if tgt == "" {
				tgt = r.TargetEntityID
			}
			user.WriteString(fmt.Sprintf("- %s -> %s (%s)\n", src, tgt, r.Cardinality))
		}
	}

	user.WriteString("\n请推导并输出完整的 JSON 语义映射方案。")

	return []*schema.Message{
		schema.SystemMessage(system.String()),
		schema.UserMessage(user.String()),
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
		} else {
			// 若未匹配，执行规范清洗
			if ent.Comment != "" {
				ent.Comment = sanitizeConceptName(ent.Comment)
			}
		}
	}
}

func sanitizeConceptName(name string) string {
	name = strings.TrimSpace(name)
	// 剥离可能带有的假后缀
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
	entityNameMap := make(map[string]string)

	for _, e := range design.Entities {
		entityNameMap[e.ID] = e.Name
		entityNameMap[strings.ToLower(e.Name)] = e.Name

		displayName := e.Comment
		if displayName == "" {
			displayName = capitalize(e.Name)
		}

		attrs := make([]domain.ConceptAttribute, 0, len(e.Attributes))
		for _, a := range e.Attributes {
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
			Attributes:  attrs,
		})
	}

	relations := make([]domain.ConceptRelation, 0)
	verbMap := make(map[string]string)
	if payload != nil {
		for _, r := range payload.Relations {
			k := fmt.Sprintf("%s->%s", strings.ToLower(r.SourceConcept), strings.ToLower(r.TargetConcept))
			verbMap[k] = r.Name
		}
	}

	for _, r := range design.Relations {
		src := entityNameMap[r.SourceEntityID]
		if src == "" {
			src = r.SourceEntityID
		}
		tgt := entityNameMap[r.TargetEntityID]
		if tgt == "" {
			tgt = r.TargetEntityID
		}

		verb := "关联"
		k := fmt.Sprintf("%s->%s", strings.ToLower(src), strings.ToLower(tgt))
		if v, ok := verbMap[k]; ok && v != "" {
			verb = v
		}

		card := domain.ConceptCardinality(r.Cardinality)
		if card == "" {
			card = "one_to_many"
		}

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
	if strings.Contains(u, "INT") || strings.Contains(u, "DECIMAL") || strings.Contains(u, "NUMERIC") || strings.Contains(u, "FLOAT") || strings.Contains(u, "DOUBLE") {
		return "number"
	}
	if strings.Contains(u, "BOOL") || strings.Contains(u, "TINYINT(1)") {
		return "boolean"
	}
	if strings.Contains(u, "TIME") || strings.Contains(u, "DATE") {
		return "datetime"
	}
	if strings.Contains(u, "BLOB") || strings.Contains(u, "BINARY") {
		return "media"
	}
	return "string"
}

func capitalize(s string) string {
	if s == "" {
		return ""
	}
	return strings.ToUpper(s[:1]) + s[1:]
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

// 启发式离线规则推导
func inferSemanticsRuleBased(design domain.ERDesign) *inferredSemanticsPayload {
	dict := map[string]string{
		"tenant": "租户", "tenants": "租户",
		"position": "岗位", "positions": "岗位", "job": "岗位", "jobs": "岗位",
		"user": "用户", "users": "用户", "account": "账号",
		"role": "角色", "roles": "角色", "permission": "权限点", "permissions": "权限点",
		"department": "部门", "departments": "部门", "dept": "部门", "org": "组织机构",
		"employee": "员工", "employees": "员工", "staff": "员工",
		"company": "企业", "enterprise": "企业",
		"order": "订单", "orders": "订单", "order_item": "订单明细", "product": "商品", "sku": "SKU规格",
		"customer": "客户", "client": "客户",
		"log": "日志", "audit_log": "审计日志",
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
			if v, ok := dict[clean]; ok {
				comment = v
			} else {
				comment = capitalize(clean)
			}
		}

		attrs := make([]struct {
			Name    string `json:"name"`
			Comment string `json:"comment"`
		}, 0, len(e.Attributes))

		for _, a := range e.Attributes {
			attrClean := strings.ToLower(strings.TrimSpace(a.Name))
			attrComment := a.Comment
			if attrComment == "" {
				if v, ok := attrDict[attrClean]; ok {
					attrComment = v
				} else {
					attrComment = capitalize(attrClean)
				}
			}
			attrs = append(attrs, struct {
				Name    string `json:"name"`
				Comment string `json:"comment"`
			}{
				Name:    a.Name,
				Comment: attrComment,
			})
		}

		payload.Entities = append(payload.Entities, inferredEntitySemantic{
			Name:        e.Name,
			Comment:     comment,
			Description: fmt.Sprintf("%s业务实体", comment),
			Attributes:  attrs,
		})
	}

	return payload
}
