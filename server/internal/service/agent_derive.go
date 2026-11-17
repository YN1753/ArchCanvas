package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode"

	"archcanvas/internal/domain"
	"archcanvas/internal/service/tools"
	"archcanvas/pkg/id"

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

	dialect := strings.ToLower(strings.TrimSpace(input.Dialect))
	if dialect == "" {
		dialect = "mysql"
	}
	input.Dialect = dialect

	if a.ModelManager == nil {
		return derivePhysicalRuleBased(input), nil
	}

	chatModel, err := a.ModelManager.GetModel(ctx, input.ModelProvider, input.ModelName)
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return derivePhysicalRuleBased(input), nil
	}

	toolList, err := tools.BuildDesignTools(ctx)
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return derivePhysicalRuleBased(input), nil
	}
	toolModel, err := chatModel.WithTools(toolList)
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return derivePhysicalRuleBased(input), nil
	}

	messages := a.buildDerivePhysicalMessages(input)

	const maxRetries = 2
	currentMessages := messages

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if attempt > 0 && onThinking != nil {
			onThinking(fmt.Sprintf("\n[提示] 物理表结构解析未通过，正在携带错误上下文向大模型发起第 %d 次纠错重试…\n", attempt))
		}

		stream, err := toolModel.Stream(ctx, currentMessages)
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if attempt == maxRetries {
				return derivePhysicalRuleBased(input), nil
			}
			continue
		}

		var accumulatedMses []*schema.Message
		var streamErr error
		for {
			select {
			case <-ctx.Done():
				stream.Close()
				return nil, ctx.Err()
			default:
			}
			chunk, err := stream.Recv()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				stream.Close()
				if errors.Is(err, context.Canceled) || ctx.Err() != nil {
					return nil, ctx.Err()
				}
				streamErr = err
				break
			}

			if chunk.Content != "" && onThinking != nil {
				onThinking(chunk.Content)
			}
			accumulatedMses = append(accumulatedMses, chunk)
		}
		stream.Close()

		if streamErr != nil {
			if errors.Is(streamErr, context.Canceled) || ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if attempt == maxRetries {
				return derivePhysicalRuleBased(input), nil
			}
			continue
		}

		concatMsg, err := schema.ConcatMessages(accumulatedMses)
		var parseErr error

		if err == nil && len(concatMsg.ToolCalls) > 0 {
			for _, tc := range concatMsg.ToolCalls {
				if tc.Function.Name == tools.SaveERDesignToolName || tc.Function.Name == tools.ProposeSchemaDesignToolName {
					var args tools.ProposeSchemaDesignArgs
					if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err == nil && hasValidEntities(args.Entities) {
						return sanitizeERDesign(args.Entities, args.Relations, input.CurrentERDesign), nil
					} else if err != nil {
						parseErr = fmt.Errorf("参数反序列化失败: %w", err)
					} else {
						parseErr = errors.New("实体列表或字段列表 (attributes) 为空")
					}
				}
			}
		}

		if concatMsg != nil && concatMsg.Content != "" {
			if parsed, err := tryParseSchemaJSON(concatMsg.Content); err == nil && hasValidEntities(parsed.Entities) {
				return sanitizeERDesign(parsed.Entities, parsed.Relations, input.CurrentERDesign), nil
			} else if err != nil {
				parseErr = fmt.Errorf("正文 JSON 提取失败: %w", err)
			} else {
				parseErr = errors.New("正文 JSON 中实体列表或字段列表为空")
			}
		}

		if attempt < maxRetries {
			errMsg := "输出未包含合法的实体表与字段结构"
			if parseErr != nil {
				errMsg = parseErr.Error()
			}
			feedbackPrompt := fmt.Sprintf("【物理推导格式纠错】上一轮输出未能通过系统结构化反序列化校验，错误原因：%s。请严格调用 `save_er_design` 工具输出包含 entities（每张表含非空 attributes 数组及 id 主键）与 relations 的完整物理数据模型。", errMsg)

			currentMessages = append(currentMessages,
				schema.AssistantMessage(buildRetryAssistantContent(concatMsg), nil),
				schema.UserMessage(feedbackPrompt),
			)
		}
	}

	return derivePhysicalRuleBased(input), nil
}

// buildDerivePhysicalMessages 组装 Layer 2 物理工程推导 Prompt（仅声明已注册的 save_er_design 工具并压缩上下文坐标噪声）
func (a *AgentService) buildDerivePhysicalMessages(input DerivePhysicalInput) []*schema.Message {
	var prompt strings.Builder
	prompt.WriteString("你是一位资深的生产级物理数据库架构师（Production Schema Engineer）。\n")
	prompt.WriteString("你的核心职责是将业务概念模型（Chen's ER Model）规范化推导为面向生产环境的物理关系表（Relational Schema with Indexes & Foreign Keys）。\n\n")

	prompt.WriteString(fmt.Sprintf("【目标数据库方言】：%s\n\n", strings.ToUpper(input.Dialect)))

	prompt.WriteString("【生产级物理推导核心守则（必须严格执行）】：\n")
	prompt.WriteString("1. 【主键规范】：每张表必须拥有且仅有一个通用主键列，统一命名为 `id`，并置于表的第一列（is_primary_key: true，is_nullable: false，is_unique: true）。\n")
	switch input.Dialect {
	case "postgres":
		prompt.WriteString("   - PostgreSQL 主键类型推荐 `BIGINT` 或 `UUID`，code_type 对应 `int64` 或 `string`。\n")
	case "sqlite":
		prompt.WriteString("   - SQLite 主键类型为 `INTEGER` 或 `TEXT`。\n")
	default:
		prompt.WriteString("   - MySQL 主键类型推荐 `BIGINT UNSIGNED` 或 `VARCHAR(36)`，code_type 为 `uint64` 或 `string`。\n")
	}

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

// sanitizeERDesign 清洗、校验并保持已有表/字段的 UUID 与坐标稳定，统一保留合法关联（含树形自引用关联）。
func sanitizeERDesign(entities []domain.Entity, relations []domain.Relation, current *domain.ERDesign) *domain.ERDesign {
	entityMap := make(map[string]string)
	oldEntityPos := make(map[string]*domain.Position)
	oldAttrIDMap := make(map[string]map[string]string) // lowerTableName -> lowerColName -> attrID

	if current != nil {
		for _, e := range current.Entities {
			lowerEnt := strings.ToLower(strings.TrimSpace(e.Name))
			entityMap[lowerEnt] = e.ID
			entityMap[e.ID] = e.ID
			if e.Position != nil {
				oldEntityPos[e.ID] = clonePosition(e.Position)
			}
			aMap := make(map[string]string, len(e.Attributes))
			for _, a := range e.Attributes {
				aMap[strings.ToLower(strings.TrimSpace(a.Name))] = a.ID
			}
			oldAttrIDMap[lowerEnt] = aMap
		}
	}

	validIDs := make(map[string]bool, len(entities))
	for i := range entities {
		e := &entities[i]
		rawID := strings.TrimSpace(e.ID)
		lowerEnt := strings.ToLower(strings.TrimSpace(e.Name))

		if existingID, ok := entityMap[lowerEnt]; ok {
			e.ID = existingID
		} else if e.ID == "" || !id.IsValidUUID(e.ID) {
			e.ID = id.NewUUIDv7()
		}
		if e.Position == nil {
			if pos, ok := oldEntityPos[e.ID]; ok {
				e.Position = clonePosition(pos)
			}
		}

		if rawID != "" {
			entityMap[strings.ToLower(rawID)] = e.ID
		}
		entityMap[lowerEnt] = e.ID
		entityMap[strings.ToLower(e.ID)] = e.ID
		validIDs[e.ID] = true

		aMap := oldAttrIDMap[lowerEnt]
		for j := range e.Attributes {
			a := &e.Attributes[j]
			if aMap != nil {
				if oldAID, ok := aMap[strings.ToLower(strings.TrimSpace(a.Name))]; ok && oldAID != "" {
					a.ID = oldAID
				}
			}
			if a.ID == "" || !id.IsValidUUID(a.ID) {
				a.ID = id.NewUUIDv7()
			}
		}

		if e.Indexes == nil {
			e.Indexes = make([]domain.IndexDefinition, 0)
		}
	}

	cleanRelations := make([]domain.Relation, 0, len(relations))
	for _, r := range relations {
		src := strings.TrimSpace(r.SourceEntityID)
		tgt := strings.TrimSpace(r.TargetEntityID)
		if mapped, ok := entityMap[strings.ToLower(src)]; ok {
			src = mapped
		}
		if mapped, ok := entityMap[strings.ToLower(tgt)]; ok {
			tgt = mapped
		}

		if src != "" && tgt != "" && validIDs[src] && validIDs[tgt] {
			if r.ID == "" || !id.IsValidUUID(r.ID) {
				r.ID = id.NewUUIDv7()
			}
			r.SourceEntityID = src
			r.TargetEntityID = tgt
			if r.RelationTypeID == "" {
				if r.Cardinality != "" {
					r.RelationTypeID = r.Cardinality
				} else {
					r.RelationTypeID = "one_to_many"
				}
			}
			if r.Cardinality == "" {
				r.Cardinality = r.RelationTypeID
			}
			cleanRelations = append(cleanRelations, r)
		}
	}

	return &domain.ERDesign{
		Entities:  entities,
		Relations: cleanRelations,
	}
}

func toSnakeCaseIdentifier(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	var sb strings.Builder
	sb.Grow(len(runes) + 4)
	for i, r := range runes {
		if r == ' ' || r == '-' || r == '.' {
			sb.WriteRune('_')
			continue
		}
		if unicode.IsUpper(r) {
			if i > 0 && runes[i-1] != '_' && (unicode.IsLower(runes[i-1]) || unicode.IsDigit(runes[i-1]) || (i+1 < len(runes) && unicode.IsLower(runes[i+1]))) {
				sb.WriteRune('_')
			}
			sb.WriteRune(unicode.ToLower(r))
		} else {
			sb.WriteRune(unicode.ToLower(r))
		}
	}
	res := strings.Trim(sb.String(), "_")
	for strings.Contains(res, "__") {
		res = strings.ReplaceAll(res, "__", "_")
	}
	return res
}

func toPluralTableName(conceptName string) string {
	snake := toSnakeCaseIdentifier(conceptName)
	if snake == "" {
		return "entities"
	}
	// 非 ASCII（如中文名）不追加英文复数 s
	lastRune := []rune(snake)[len([]rune(snake))-1]
	if lastRune > unicode.MaxASCII {
		return snake
	}
	singular := toSingularName(snake)
	if singular != snake {
		return snake // 本身已经是复数表名
	}
	if strings.HasSuffix(snake, "y") && len(snake) > 1 {
		prev := snake[len(snake)-2]
		if prev != 'a' && prev != 'e' && prev != 'i' && prev != 'o' && prev != 'u' {
			return snake[:len(snake)-1] + "ies"
		}
	}
	if strings.HasSuffix(snake, "s") || strings.HasSuffix(snake, "x") || strings.HasSuffix(snake, "z") ||
		strings.HasSuffix(snake, "ch") || strings.HasSuffix(snake, "sh") {
		return snake + "es"
	}
	return snake + "s"
}

// derivePhysicalRuleBased 内置确定性规则推导引擎（修复 [P0-DATA-03] 切片扩容导致指针悬空丢失全部外键与索引的严重缺陷）
func derivePhysicalRuleBased(input DerivePhysicalInput) *domain.ERDesign {
	concepts := input.ConceptualDesign.Concepts
	relations := input.ConceptualDesign.Relations
	dialect := strings.ToLower(strings.TrimSpace(input.Dialect))
	if dialect == "" {
		dialect = "mysql"
	}

	entities := make([]domain.Entity, 0, len(concepts))
	entityIndexByID := make(map[string]int, len(concepts))
	conceptKeyToEntityID := make(map[string]string, len(concepts)*3)

	// 1. 将概念映射为物理实体（排除标记删除的概念）
	for _, c := range concepts {
		if c.Operation == domain.OpDelete {
			continue
		}
		entID := id.NewUUIDv7()
		if c.ID != "" && id.IsValidUUID(c.ID) {
			entID = c.ID
		}
		tableName := toPluralTableName(c.Name)

		conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(c.Name))] = entID
		conceptKeyToEntityID[tableName] = entID
		if c.ID != "" {
			conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(c.ID))] = entID
		}
		if c.DisplayName != "" {
			conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(c.DisplayName))] = entID
		}

		attrs := make([]domain.Attribute, 0, len(c.Attributes)+3)

		pkDBType := "BIGINT UNSIGNED"
		pkCodeType := "uint64"
		if dialect == "postgres" {
			pkDBType = "BIGINT"
			pkCodeType = "int64"
		} else if dialect == "sqlite" {
			pkDBType = "INTEGER"
			pkCodeType = "int64"
		}
		attrs = append(attrs, domain.Attribute{
			ID:           id.NewUUIDv7(),
			Name:         "id",
			Comment:      "主键 ID",
			DBType:       pkDBType,
			CodeType:     pkCodeType,
			IsPrimaryKey: true,
			IsNullable:   false,
			IsUnique:     true,
			Description:  "自增主键标识",
		})

		indexes := make([]domain.IndexDefinition, 0)
		seenAttrNames := map[string]bool{"id": true}

		for _, a := range c.Attributes {
			attrName := toSnakeCaseIdentifier(a.Name)
			if attrName == "" || seenAttrNames[attrName] || attrName == "created_at" || attrName == "updated_at" {
				continue
			}
			seenAttrNames[attrName] = true

			dbType, codeType := mapCategoryToDBType(a.Category, attrName, dialect)
			isUnique := a.IsUnique || a.IsBusinessKey
			isNullable := !a.Required && !isUnique

			attrs = append(attrs, domain.Attribute{
				ID:           id.NewUUIDv7(),
				Name:         attrName,
				Comment:      a.DisplayName,
				DBType:       dbType,
				CodeType:     codeType,
				IsPrimaryKey: false,
				IsNullable:   isNullable,
				IsUnique:     isUnique,
				Description:  a.Description,
			})

			if isUnique {
				indexes = append(indexes, domain.IndexDefinition{
					Name:     fmt.Sprintf("uk_%s_%s", tableName, attrName),
					Columns:  []string{attrName},
					IsUnique: true,
					Comment:  fmt.Sprintf("%s 唯一索引", a.DisplayName),
				})
			}
		}

		dtType := "DATETIME"
		if dialect == "postgres" {
			dtType = "TIMESTAMPTZ"
		}
		attrs = append(attrs,
			domain.Attribute{
				ID:           id.NewUUIDv7(),
				Name:         "created_at",
				Comment:      "创建时间",
				DBType:       dtType,
				CodeType:     "time.Time",
				IsPrimaryKey: false,
				IsNullable:   false,
				Description:  "数据创建时间戳",
			},
			domain.Attribute{
				ID:           id.NewUUIDv7(),
				Name:         "updated_at",
				Comment:      "更新时间",
				DBType:       dtType,
				CodeType:     "time.Time",
				IsPrimaryKey: false,
				IsNullable:   false,
				Description:  "数据最后修改时间戳",
			},
		)

		comment := strings.TrimSpace(c.DisplayName)
		if comment == "" {
			comment = strings.TrimSpace(c.Description)
		}
		if comment == "" {
			comment = c.Name
		}

		entityIndexByID[entID] = len(entities)
		entities = append(entities, domain.Entity{
			ID:         entID,
			Name:       tableName,
			Comment:    comment,
			Position:   clonePosition(c.Position),
			Attributes: attrs,
			Indexes:    indexes,
		})
	}

	physicalRelations := make([]domain.Relation, 0, len(relations)*2)
	// 暂存 M:N 生成的中间表，循环结束后统一追加，彻底杜绝循环中 append 导致底层数组重分配使指针失效！
	junctionEntities := make([]domain.Entity, 0)
	usedTableNames := make(map[string]bool, len(entities))
	for _, e := range entities {
		usedTableNames[e.Name] = true
	}

	fkDBType := "BIGINT UNSIGNED"
	fkCodeType := "uint64"
	dtType := "DATETIME"
	if dialect == "postgres" {
		fkDBType = "BIGINT"
		fkCodeType = "int64"
		dtType = "TIMESTAMPTZ"
	} else if dialect == "sqlite" {
		fkDBType = "INTEGER"
		fkCodeType = "int64"
	}

	// 2. 映射关联关系与解耦（通过切片索引读写 entities[idx]）
	for _, rel := range relations {
		srcID := conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(rel.SourceConcept))]
		tgtID := conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(rel.TargetConcept))]
		if srcID == "" || tgtID == "" {
			continue
		}
		srcIdx, okSrc := entityIndexByID[srcID]
		tgtIdx, okTgt := entityIndexByID[tgtID]
		if !okSrc || !okTgt {
			continue
		}

		// 支持树形自引用关系（注入 parent_id + 索引）
		if srcID == tgtID {
			selfEnt := &entities[srcIdx]
			hasParentFK := false
			for _, attr := range selfEnt.Attributes {
				if attr.Name == "parent_id" {
					hasParentFK = true
					break
				}
			}
			if !hasParentFK {
				selfEnt.Attributes = append(selfEnt.Attributes, domain.Attribute{
					ID:          id.NewUUIDv7(),
					Name:        "parent_id",
					Comment:     fmt.Sprintf("上级%s ID", selfEnt.Comment),
					DBType:      fkDBType,
					CodeType:    fkCodeType,
					IsNullable:  true,
					Description: fmt.Sprintf("自引用外键: 关联 %s(id)", selfEnt.Name),
				})
				selfEnt.Indexes = append(selfEnt.Indexes, domain.IndexDefinition{
					Name:    fmt.Sprintf("idx_%s_parent_id", selfEnt.Name),
					Columns: []string{"parent_id"},
					Comment: "层级父节点查询索引",
				})
			}
			physicalRelations = append(physicalRelations, domain.Relation{
				ID:             id.NewUUIDv7(),
				SourceEntityID: srcID,
				TargetEntityID: tgtID,
				RelationTypeID: "one_to_many",
				Cardinality:    "one_to_many",
			})
			continue
		}

		srcEnt := &entities[srcIdx]
		tgtEnt := &entities[tgtIdx]

		switch rel.Cardinality {
		case domain.CardOneToMany, "":
			fkName := fmt.Sprintf("%s_id", toSingularName(srcEnt.Name))
			hasFK := false
			for _, attr := range tgtEnt.Attributes {
				if attr.Name == fkName {
					hasFK = true
					break
				}
			}
			if !hasFK {
				tgtEnt.Attributes = append(tgtEnt.Attributes, domain.Attribute{
					ID:          id.NewUUIDv7(),
					Name:        fkName,
					Comment:     fmt.Sprintf("关联 %s 主键", srcEnt.Comment),
					DBType:      fkDBType,
					CodeType:    fkCodeType,
					IsNullable:  false,
					Description: fmt.Sprintf("外键: 关联 %s(id)", srcEnt.Name),
				})
				tgtEnt.Indexes = append(tgtEnt.Indexes, domain.IndexDefinition{
					Name:     fmt.Sprintf("idx_%s_%s", tgtEnt.Name, fkName),
					Columns:  []string{fkName},
					IsUnique: false,
					Comment:  fmt.Sprintf("外键关联 %s 索引", srcEnt.Name),
				})
			}
			physicalRelations = append(physicalRelations, domain.Relation{
				ID:             id.NewUUIDv7(),
				SourceEntityID: srcID,
				TargetEntityID: tgtID,
				RelationTypeID: "one_to_many",
				Cardinality:    "one_to_many",
			})

		case domain.CardOneToOne:
			fkName := fmt.Sprintf("%s_id", toSingularName(srcEnt.Name))
			hasFK := false
			for _, attr := range tgtEnt.Attributes {
				if attr.Name == fkName {
					hasFK = true
					break
				}
			}
			if !hasFK {
				tgtEnt.Attributes = append(tgtEnt.Attributes, domain.Attribute{
					ID:          id.NewUUIDv7(),
					Name:        fkName,
					Comment:     fmt.Sprintf("关联 %s 主键", srcEnt.Comment),
					DBType:      fkDBType,
					CodeType:    fkCodeType,
					IsNullable:  false,
					IsUnique:    true,
					Description: fmt.Sprintf("外键: 关联 %s(id)", srcEnt.Name),
				})
				tgtEnt.Indexes = append(tgtEnt.Indexes, domain.IndexDefinition{
					Name:     fmt.Sprintf("uk_%s_%s", tgtEnt.Name, fkName),
					Columns:  []string{fkName},
					IsUnique: true,
					Comment:  fmt.Sprintf("1:1 关联 %s 唯一索引", srcEnt.Name),
				})
			}
			physicalRelations = append(physicalRelations, domain.Relation{
				ID:             id.NewUUIDv7(),
				SourceEntityID: srcID,
				TargetEntityID: tgtID,
				RelationTypeID: "one_to_one",
				Cardinality:    "one_to_one",
			})

		case domain.CardManyToMany:
			srcSing := toSingularName(srcEnt.Name)
			tgtSing := toSingularName(tgtEnt.Name)
			baseJunctionName := fmt.Sprintf("%s_%s", srcSing, tgtEnt.Name)
			junctionName := baseJunctionName
			suffix := 2
			for usedTableNames[junctionName] {
				junctionName = fmt.Sprintf("%s_%d", baseJunctionName, suffix)
				suffix++
			}
			usedTableNames[junctionName] = true

			junctionID := id.NewUUIDv7()
			var jPos *domain.Position
			if srcEnt.Position != nil && tgtEnt.Position != nil {
				jPos = &domain.Position{
					X: (srcEnt.Position.X + tgtEnt.Position.X) / 2,
					Y: (srcEnt.Position.Y+tgtEnt.Position.Y)/2 + 80,
				}
			}

			srcFK := fmt.Sprintf("%s_id", srcSing)
			tgtFK := fmt.Sprintf("%s_id", tgtSing)
			if srcFK == tgtFK {
				tgtFK = fmt.Sprintf("target_%s_id", tgtSing)
			}

			isJunc := true
			junctionEntity := domain.Entity{
				ID:              junctionID,
				Name:            junctionName,
				Comment:         fmt.Sprintf("%s与%s关联", srcEnt.Comment, tgtEnt.Comment),
				IsJunctionTable: &isJunc,
				Position:        jPos,
				Attributes: []domain.Attribute{
					{
						ID:           id.NewUUIDv7(),
						Name:         "id",
						Comment:      "主键 ID",
						DBType:       fkDBType,
						CodeType:     fkCodeType,
						IsPrimaryKey: true,
						IsNullable:   false,
						IsUnique:     true,
						Description:  "自增主键标识",
					},
					{
						ID:          id.NewUUIDv7(),
						Name:        srcFK,
						Comment:     fmt.Sprintf("%s 外键", srcEnt.Comment),
						DBType:      fkDBType,
						CodeType:    fkCodeType,
						IsNullable:  false,
						Description: fmt.Sprintf("外键: 关联 %s(id)", srcEnt.Name),
					},
					{
						ID:          id.NewUUIDv7(),
						Name:        tgtFK,
						Comment:     fmt.Sprintf("%s 外键", tgtEnt.Comment),
						DBType:      fkDBType,
						CodeType:    fkCodeType,
						IsNullable:  false,
						Description: fmt.Sprintf("外键: 关联 %s(id)", tgtEnt.Name),
					},
					{
						ID:          id.NewUUIDv7(),
						Name:        "created_at",
						Comment:     "创建时间",
						DBType:      dtType,
						CodeType:    "time.Time",
						IsNullable:  false,
						Description: "关联创建时间戳",
					},
				},
				Indexes: []domain.IndexDefinition{
					{
						Name:     fmt.Sprintf("uk_%s_%s_%s", junctionName, srcSing, tgtSing),
						Columns:  []string{srcFK, tgtFK},
						IsUnique: true,
						Comment:  "防重复关联联合唯一索引",
					},
					{
						Name:     fmt.Sprintf("idx_%s_%s", junctionName, tgtFK),
						Columns:  []string{tgtFK},
						IsUnique: false,
						Comment:  "反向查询索引",
					},
				},
			}

			junctionEntities = append(junctionEntities, junctionEntity)
			physicalRelations = append(physicalRelations,
				domain.Relation{
					ID:             id.NewUUIDv7(),
					SourceEntityID: srcID,
					TargetEntityID: junctionID,
					RelationTypeID: "one_to_many",
					Cardinality:    "one_to_many",
				},
				domain.Relation{
					ID:             id.NewUUIDv7(),
					SourceEntityID: tgtID,
					TargetEntityID: junctionID,
					RelationTypeID: "one_to_many",
					Cardinality:    "one_to_many",
				},
			)
		}
	}

	entities = append(entities, junctionEntities...)
	return sanitizeERDesign(entities, physicalRelations, input.CurrentERDesign)
}

func mapCategoryToDBType(category domain.AttributeCategory, attrName, dialect string) (string, string) {
	switch category {
	case domain.AttrString:
		if strings.Contains(attrName, "desc") || strings.Contains(attrName, "content") || strings.Contains(attrName, "intro") || strings.Contains(attrName, "detail") {
			return "TEXT", "string"
		}
		if strings.Contains(attrName, "phone") || strings.Contains(attrName, "mobile") {
			return "VARCHAR(20)", "string"
		}
		if strings.Contains(attrName, "code") || strings.Contains(attrName, "sn") || strings.Contains(attrName, "no") {
			return "VARCHAR(64)", "string"
		}
		return "VARCHAR(128)", "string"

	case domain.AttrNumber:
		if strings.Contains(attrName, "price") || strings.Contains(attrName, "amount") || strings.Contains(attrName, "fee") || strings.Contains(attrName, "balance") || strings.Contains(attrName, "cost") {
			if dialect == "postgres" {
				return "NUMERIC(10,2)", "float64"
			} else if dialect == "sqlite" {
				return "REAL", "float64"
			}
			return "DECIMAL(10,2)", "float64"
		}
		if strings.Contains(attrName, "count") || strings.Contains(attrName, "num") || strings.Contains(attrName, "qty") || strings.Contains(attrName, "age") || strings.Contains(attrName, "score") {
			return "INT", "int"
		}
		if dialect == "sqlite" {
			return "INTEGER", "int64"
		}
		return "BIGINT", "int64"

	case domain.AttrBoolean:
		if dialect == "postgres" {
			return "BOOLEAN", "bool"
		} else if dialect == "sqlite" {
			return "INTEGER", "bool"
		}
		return "TINYINT(1)", "bool"

	case domain.AttrDateTime:
		if dialect == "postgres" {
			return "TIMESTAMPTZ", "time.Time"
		}
		return "DATETIME", "time.Time"

	case domain.AttrEnum:
		return "VARCHAR(32)", "string"

	case domain.AttrMedia:
		return "VARCHAR(255)", "string"

	default:
		return "VARCHAR(128)", "string"
	}
}

var uncountableSingularWords = map[string]bool{
	"status": true, "campus": true, "focus": true, "virus": true, "bonus": true, "corpus": true,
	"analysis": true, "basis": true, "diagnosis": true, "thesis": true, "crisis": true, "synopsis": true,
	"news": true, "series": true, "species": true, "media": true, "data": true, "meta": true,
}

// toSingularName 统一规范的英文单数转换函数（保护 -us/-is/-ss 与不规则名词，精确处理 -ies/-xes/-ches/-shes/-zes/-ses）
func toSingularName(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" {
		return ""
	}
	baseWord := lower
	prefix := ""
	if idx := strings.LastIndexByte(lower, '_'); idx >= 0 {
		prefix = lower[:idx+1]
		baseWord = lower[idx+1:]
	}
	if uncountableSingularWords[baseWord] {
		return prefix + baseWord
	}
	if strings.HasSuffix(baseWord, "ies") && len(baseWord) > 3 {
		prev := baseWord[len(baseWord)-4]
		if prev == 'a' || prev == 'e' || prev == 'i' || prev == 'o' || prev == 'u' {
			return prefix + baseWord[:len(baseWord)-1]
		}
		return prefix + baseWord[:len(baseWord)-3] + "y"
	}
	if strings.HasSuffix(baseWord, "xes") || strings.HasSuffix(baseWord, "zes") ||
		strings.HasSuffix(baseWord, "ches") || strings.HasSuffix(baseWord, "shes") ||
		strings.HasSuffix(baseWord, "sses") || strings.HasSuffix(baseWord, "uses") {
		if len(baseWord) > 3 {
			return prefix + baseWord[:len(baseWord)-2]
		}
	}
	if strings.HasSuffix(baseWord, "ses") && len(baseWord) > 4 {
		// 如 statuses -> status, addresses -> address；而 courses/cases/licenses -> course/case/license
		stem := baseWord[:len(baseWord)-2]
		if uncountableSingularWords[stem] || strings.HasSuffix(stem, "s") {
			return prefix + stem
		}
		return prefix + baseWord[:len(baseWord)-1]
	}
	if strings.HasSuffix(baseWord, "s") &&
		!strings.HasSuffix(baseWord, "ss") &&
		!strings.HasSuffix(baseWord, "us") &&
		!strings.HasSuffix(baseWord, "is") &&
		len(baseWord) > 1 {
		return prefix + baseWord[:len(baseWord)-1]
	}
	return prefix + baseWord
}
