package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

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
		// 回退至内置启发式规则推导
		return derivePhysicalRuleBased(input), nil
	}

	toolList, err := tools.BuildDesignTools(ctx)
	if err != nil {
		return derivePhysicalRuleBased(input), nil
	}
	toolModel, err := chatModel.WithTools(toolList)
	if err != nil {
		return derivePhysicalRuleBased(input), nil
	}

	messages := a.buildDerivePhysicalMessages(input)

	stream, err := toolModel.Stream(ctx, messages)
	if err != nil {
		return derivePhysicalRuleBased(input), nil
	}
	defer stream.Close()

	var accumulatedMses []*schema.Message

	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return derivePhysicalRuleBased(input), nil
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
				if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err == nil && len(args.Entities) > 0 {
					return sanitizeERDesign(args.Entities, args.Relations, input.CurrentERDesign), nil
				}
			}
		}
	}

	if concatMsg != nil && concatMsg.Content != "" {
		if parsed, err := tryParseSchemaJSON(concatMsg.Content); err == nil && len(parsed.Entities) > 0 {
			return sanitizeERDesign(parsed.Entities, parsed.Relations, input.CurrentERDesign), nil
		}
	}

	return derivePhysicalRuleBased(input), nil
}

// buildDerivePhysicalMessages 组装 Layer 2 物理工程推导 Prompt
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
	default: // mysql
		prompt.WriteString("   - MySQL 主键类型推荐 `BIGINT UNSIGNED` 或 `VARCHAR(36)`，code_type 为 `uint64` 或 `string`。\n")
	}

	prompt.WriteString("2. 【审计时间戳规范】：每张常规业务表必须配置基础审计列：\n")
	prompt.WriteString("   - `created_at`：记录创建时间（MySQL 为 DATETIME，PostgreSQL 为 TIMESTAMPTZ，SQLite 为 DATETIME）；\n")
	prompt.WriteString("   - `updated_at`：记录更新时间。\n")

	prompt.WriteString("3. 【多对多(M:N)菱形解耦】：\n")
	prompt.WriteString("   - 概念模型中所有的多对多(many_to_many)关联，必须解耦拆分为独立的物理中间关联表（如 Student 与 Course 的关联拆为 `student_courses` 表）；\n")
	prompt.WriteString("   - 中间表必须包含两个实体引用的外键列（如 `student_id`, `course_id`）；\n")
	prompt.WriteString("   - 为防止重复关联，必须在中间表上配置联合唯一索引（`IndexDefinition`，is_unique: true）；\n")
	prompt.WriteString("   - 物理关系列表中建立从主表到中间表的两组一对多关联。\n")

	prompt.WriteString("4. 【一对多(1:N)外键布局】：\n")
	prompt.WriteString("   - 在“多端”物理实体中增加对应“一端”的外键列（例如一个 User 有多个 Order，则在 `orders` 表中注入 `user_id` 列）；\n")
	prompt.WriteString("   - 外键类型需与主表主键保持严格一致（如 BIGINT UNSIGNED）。\n")

	prompt.WriteString("5. 【字段数据类型精化】：\n")
	prompt.WriteString("   - 严禁出现模糊的泛型。金额类字段必须精化为 `DECIMAL(10,2)` 或 `NUMERIC(10,2)`，严禁使用浮点数；\n")
	prompt.WriteString("   - 状态/类型类字段精化为 `TINYINT` / `VARCHAR(32)`，并在 description 和 comment 中标明枚举可选值；\n")
	prompt.WriteString("   - 短文本精化为 `VARCHAR(64)` 或 `VARCHAR(128)`，长描述精化为 `TEXT`。\n")

	prompt.WriteString("6. 【智能索引推导（IndexDefinition）】：\n")
	prompt.WriteString("   - 必须为每一个外键列（如 `xxx_id`）建立前缀普通索引，命名规范为 `idx_{表名}_{字段名}`；\n")
	prompt.WriteString("   - 业务唯一标识（如 username, order_no, sku）必须建立唯一索引，命名为 `uk_{表名}_{字段名}`；\n")
	prompt.WriteString("   - 高频查询场景（如租户+状态、用户+状态）可建立复合索引；\n")
	prompt.WriteString("   - 索引清单挂载在实体对象的 `indexes` 数组中。\n")

	prompt.WriteString("7. 【业务中文注释对齐】：\n")
	prompt.WriteString("   - 实体的 `comment` 必须继承自概念的 `display_name` 与业务说明；\n")
	prompt.WriteString("   - 属性的 `comment` 必须填入清晰的中文释义（对齐 SQL COMMENT 语法）。\n")

	prompt.WriteString("8. 【输出方式】：\n")
	prompt.WriteString("   - 请先输出你的架构推导思考与类型设计考量（将流式展示给用户）；\n")
	prompt.WriteString("   - 最终通过调用 `save_er_design` 或 `propose_schema_design` 工具提交完整的物理表与关系方案。\n\n")

	cdJSON, _ := json.Marshal(input.ConceptualDesign)
	userContent := fmt.Sprintf("【待推导的业务概念模型（Chen's ER）】：\n%s\n", string(cdJSON))

	if input.CurrentERDesign != nil && len(input.CurrentERDesign.Entities) > 0 {
		erJSON, _ := json.Marshal(input.CurrentERDesign)
		userContent += fmt.Sprintf("\n【系统当前已有的物理表模型（请保持已有实体与字段 ID/命名稳定，执行增量推导）】：\n%s\n", string(erJSON))
	}

	return []*schema.Message{
		schema.SystemMessage(prompt.String()),
		schema.UserMessage(userContent),
	}
}

// sanitizeERDesign 清洗、校验并确保 ID 与关系的规范性
func sanitizeERDesign(entities []domain.Entity, relations []domain.Relation, current *domain.ERDesign) *domain.ERDesign {
	entityMap := make(map[string]string) // name / oldID -> currentID
	if current != nil {
		for _, e := range current.Entities {
			entityMap[strings.ToLower(e.Name)] = e.ID
			entityMap[e.ID] = e.ID
		}
	}

	for i := range entities {
		e := &entities[i]
		if existingID, ok := entityMap[strings.ToLower(e.Name)]; ok {
			e.ID = existingID
		} else if e.ID == "" || !id.IsValidUUID(e.ID) {
			e.ID = id.NewUUIDv7()
		}
		entityMap[strings.ToLower(e.Name)] = e.ID
		entityMap[e.ID] = e.ID

		for j := range e.Attributes {
			a := &e.Attributes[j]
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
		src := r.SourceEntityID
		tgt := r.TargetEntityID
		if mapped, ok := entityMap[strings.ToLower(src)]; ok {
			src = mapped
		}
		if mapped, ok := entityMap[strings.ToLower(tgt)]; ok {
			tgt = mapped
		}

		if src != "" && tgt != "" && !strings.EqualFold(src, tgt) {
			if r.ID == "" || !id.IsValidUUID(r.ID) {
				r.ID = id.NewUUIDv7()
			}
			r.SourceEntityID = src
			r.TargetEntityID = tgt
			if r.RelationTypeID == "" {
				r.RelationTypeID = "one_to_many"
			}
			cleanRelations = append(cleanRelations, r)
		}
	}

	return &domain.ERDesign{
		Entities:  entities,
		Relations: cleanRelations,
	}
}

// derivePhysicalRuleBased 内置规则推导引擎（在大模型离线或降级时提供确定性、高可用的物理建表推导）
func derivePhysicalRuleBased(input DerivePhysicalInput) *domain.ERDesign {
	concepts := input.ConceptualDesign.Concepts
	relations := input.ConceptualDesign.Relations
	dialect := input.Dialect

	entities := make([]domain.Entity, 0, len(concepts))
	conceptNameToEntityID := make(map[string]string)
	conceptIDToEntityID := make(map[string]string)
	conceptByID := make(map[string]domain.BusinessConcept)

	for _, c := range concepts {
		conceptByID[c.ID] = c
		conceptByID[c.Name] = c
	}

	// 1. 将概念映射为物理实体
	for _, c := range concepts {
		entID := id.NewUUIDv7()
		if c.ID != "" && id.IsValidUUID(c.ID) {
			entID = c.ID
		}
		conceptNameToEntityID[strings.ToLower(c.Name)] = entID
		if c.ID != "" {
			conceptIDToEntityID[c.ID] = entID
		}

		attrs := make([]domain.Attribute, 0)

		// 1.1 主键 id
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

		// 1.2 映射业务属性
		for _, a := range c.Attributes {
			attrName := strings.ToLower(strings.TrimSpace(a.Name))
			if attrName == "id" {
				continue
			}

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
					Name:     fmt.Sprintf("uk_%s_%s", strings.ToLower(c.Name), attrName),
					Columns:  []string{attrName},
					IsUnique: true,
					Comment:  fmt.Sprintf("%s 唯一索引", a.DisplayName),
				})
			}
		}

		// 1.3 审计时间戳
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

		comment := c.DisplayName
		if comment == "" {
			comment = c.Description
		}

		entities = append(entities, domain.Entity{
			ID:         entID,
			Name:       strings.ToLower(c.Name),
			Comment:    comment,
			Position:   c.Position,
			Attributes: attrs,
			Indexes:    indexes,
		})
	}

	physicalRelations := make([]domain.Relation, 0)
	entitiesMap := make(map[string]*domain.Entity, len(entities))
	for i := range entities {
		entitiesMap[entities[i].ID] = &entities[i]
	}

	// 2. 映射关联关系与解耦
	for _, rel := range relations {
		srcID := conceptNameToEntityID[strings.ToLower(rel.SourceConcept)]
		if srcID == "" {
			srcID = conceptIDToEntityID[rel.SourceConcept]
		}
		tgtID := conceptNameToEntityID[strings.ToLower(rel.TargetConcept)]
		if tgtID == "" {
			tgtID = conceptIDToEntityID[rel.TargetConcept]
		}

		if srcID == "" || tgtID == "" || srcID == tgtID {
			continue
		}

		srcEnt := entitiesMap[srcID]
		tgtEnt := entitiesMap[tgtID]
		if srcEnt == nil || tgtEnt == nil {
			continue
		}

		switch rel.Cardinality {
		case domain.CardOneToMany:
			// 1:N 在多端 (tgt) 注入外键列 src_id
			fkName := fmt.Sprintf("%s_id", srcEnt.Name)
			hasFK := false
			for _, attr := range tgtEnt.Attributes {
				if attr.Name == fkName {
					hasFK = true
					break
				}
			}
			if !hasFK {
				fkDBType := "BIGINT UNSIGNED"
				fkCodeType := "uint64"
				if dialect == "postgres" {
					fkDBType = "BIGINT"
					fkCodeType = "int64"
				} else if dialect == "sqlite" {
					fkDBType = "INTEGER"
					fkCodeType = "int64"
				}
				tgtEnt.Attributes = append(tgtEnt.Attributes, domain.Attribute{
					ID:           id.NewUUIDv7(),
					Name:         fkName,
					Comment:      fmt.Sprintf("关联 %s 主键", srcEnt.Comment),
					DBType:       fkDBType,
					CodeType:     fkCodeType,
					IsPrimaryKey: false,
					IsNullable:   false,
					Description:  fmt.Sprintf("外键: 关联 %s(id)", srcEnt.Name),
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
			})

		case domain.CardOneToOne:
			// 1:1 在 tgt 注入外键且设为唯一索引
			fkName := fmt.Sprintf("%s_id", srcEnt.Name)
			hasFK := false
			for _, attr := range tgtEnt.Attributes {
				if attr.Name == fkName {
					hasFK = true
					break
				}
			}
			if !hasFK {
				fkDBType := "BIGINT UNSIGNED"
				fkCodeType := "uint64"
				if dialect == "postgres" {
					fkDBType = "BIGINT"
					fkCodeType = "int64"
				} else if dialect == "sqlite" {
					fkDBType = "INTEGER"
					fkCodeType = "int64"
				}
				tgtEnt.Attributes = append(tgtEnt.Attributes, domain.Attribute{
					ID:           id.NewUUIDv7(),
					Name:         fkName,
					Comment:      fmt.Sprintf("关联 %s 主键", srcEnt.Comment),
					DBType:       fkDBType,
					CodeType:     fkCodeType,
					IsPrimaryKey: false,
					IsNullable:   false,
					IsUnique:     true,
					Description:  fmt.Sprintf("外键: 关联 %s(id)", srcEnt.Name),
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
			})

		case domain.CardManyToMany:
			// M:N 解耦为中间关联表
			junctionName := fmt.Sprintf("%s_%s", srcEnt.Name, tgtEnt.Name)
			junctionID := id.NewUUIDv7()

			var jPos *domain.Position
			if srcEnt.Position != nil && tgtEnt.Position != nil {
				jPos = &domain.Position{
					X: (srcEnt.Position.X + tgtEnt.Position.X) / 2,
					Y: (srcEnt.Position.Y+tgtEnt.Position.Y)/2 + 80,
				}
			}

			srcFK := fmt.Sprintf("%s_id", srcEnt.Name)
			tgtFK := fmt.Sprintf("%s_id", tgtEnt.Name)

			idDBType := "BIGINT UNSIGNED"
			idCodeType := "uint64"
			dtType := "DATETIME"
			if dialect == "postgres" {
				idDBType = "BIGINT"
				idCodeType = "int64"
				dtType = "TIMESTAMPTZ"
			} else if dialect == "sqlite" {
				idDBType = "INTEGER"
				idCodeType = "int64"
			}

			junctionEntity := domain.Entity{
				ID:       junctionID,
				Name:     junctionName,
				Comment:  fmt.Sprintf("%s与%s的关联关系", srcEnt.Comment, tgtEnt.Comment),
				Position: jPos,
				Attributes: []domain.Attribute{
					{
						ID:           id.NewUUIDv7(),
						Name:         "id",
						Comment:      "主键 ID",
						DBType:       idDBType,
						CodeType:     idCodeType,
						IsPrimaryKey: true,
						IsNullable:   false,
						IsUnique:     true,
						Description:  "自增主键标识",
					},
					{
						ID:           id.NewUUIDv7(),
						Name:         srcFK,
						Comment:      fmt.Sprintf("%s 外键", srcEnt.Comment),
						DBType:       idDBType,
						CodeType:     idCodeType,
						IsPrimaryKey: false,
						IsNullable:   false,
						Description:  fmt.Sprintf("外键: 关联 %s(id)", srcEnt.Name),
					},
					{
						ID:           id.NewUUIDv7(),
						Name:         tgtFK,
						Comment:      fmt.Sprintf("%s 外键", tgtEnt.Comment),
						DBType:       idDBType,
						CodeType:     idCodeType,
						IsPrimaryKey: false,
						IsNullable:   false,
						Description:  fmt.Sprintf("外键: 关联 %s(id)", tgtEnt.Name),
					},
					{
						ID:           id.NewUUIDv7(),
						Name:         "created_at",
						Comment:      "创建时间",
						DBType:       dtType,
						CodeType:     "time.Time",
						IsPrimaryKey: false,
						IsNullable:   false,
						Description:  "关联创建时间戳",
					},
				},
				Indexes: []domain.IndexDefinition{
					{
						Name:     fmt.Sprintf("uk_%s_%s", junctionName, srcFK[:min(4, len(srcFK))]),
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

			entities = append(entities, junctionEntity)

			physicalRelations = append(physicalRelations,
				domain.Relation{
					ID:             id.NewUUIDv7(),
					SourceEntityID: srcID,
					TargetEntityID: junctionID,
					RelationTypeID: "one_to_many",
				},
				domain.Relation{
					ID:             id.NewUUIDv7(),
					SourceEntityID: tgtID,
					TargetEntityID: junctionID,
					RelationTypeID: "one_to_many",
				},
			)
		}
	}

	return &domain.ERDesign{
		Entities:  entities,
		Relations: physicalRelations,
	}
}

// mapCategoryToDBType 将高阶概念属性类别映射为目标方言精确 SQL 类型与 Go 语言类型
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

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
