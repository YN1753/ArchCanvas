package service

import (
	"fmt"
	"strings"

	"archcanvas/internal/dialect"
	"archcanvas/internal/domain"
	"archcanvas/pkg/id"
	"archcanvas/pkg/naming"
)

var monetaryColumnKeywords = []string{"price", "amount", "fee", "balance", "cost"}

// IsMonetaryColumnName 判断字段名是否属于金融/金额类敏感数值字段（供物理推导与静态审查共享）。
func IsMonetaryColumnName(colName string) bool {
	lower := strings.ToLower(strings.TrimSpace(colName))
	for _, kw := range monetaryColumnKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

// sanitizeERDesign 清洗、校验并保持已有表/字段的 UUID 与坐标稳定，统一保留合法关联（含树形自引用关联）。
func sanitizeERDesign(entities []domain.Entity, relations []domain.Relation, current *domain.ERDesign) *domain.ERDesign {
	entityMap := make(map[string]string)
	oldEntityPos := make(map[string]*domain.Position)
	oldAttrIDMap := make(map[string]map[string]string)

	if current != nil {
		for _, e := range current.Entities {
			lowerEnt := strings.ToLower(strings.TrimSpace(e.Name))
			entityMap[lowerEnt] = e.ID
			entityMap[e.ID] = e.ID
			if e.Position != nil {
				oldEntityPos[e.ID] = domain.ClonePosition(e.Position)
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
				e.Position = domain.ClonePosition(pos)
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
			card := r.EffectiveCardinality()
			r.RelationTypeID = card
			r.Cardinality = card
			cleanRelations = append(cleanRelations, r)
		}
	}

	return &domain.ERDesign{
		Entities:  entities,
		Relations: cleanRelations,
	}
}

// derivePhysicalRuleBased 内置确定性规则推导引擎（依托 dialect.Spec 驱动目标数据库物理类型）。
func derivePhysicalRuleBased(input DerivePhysicalInput) *domain.ERDesign {
	concepts := input.ConceptualDesign.Concepts
	relations := input.ConceptualDesign.Relations
	spec := dialect.Get(input.Dialect)

	entities := make([]domain.Entity, 0, len(concepts))
	entityIndexByID := make(map[string]int, len(concepts))
	conceptKeyToEntityID := make(map[string]string, len(concepts)*3)

	for _, c := range concepts {
		if c.Operation == domain.OpDelete {
			continue
		}
		ent := buildPhysicalEntityFromConcept(c, spec)
		conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(c.Name))] = ent.ID
		conceptKeyToEntityID[ent.Name] = ent.ID
		if c.ID != "" {
			conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(c.ID))] = ent.ID
		}
		if c.DisplayName != "" {
			conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(c.DisplayName))] = ent.ID
		}
		entityIndexByID[ent.ID] = len(entities)
		entities = append(entities, ent)
	}

	physicalRelations := make([]domain.Relation, 0, len(relations)*2)
	junctionEntities := make([]domain.Entity, 0)
	usedTableNames := make(map[string]bool, len(entities))
	for _, e := range entities {
		usedTableNames[e.Name] = true
	}

	for _, rel := range relations {
		srcID := conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(rel.SourceConcept))]
		tgtID := conceptKeyToEntityID[strings.ToLower(strings.TrimSpace(rel.TargetConcept))]
		srcIdx, okSrc := entityIndexByID[srcID]
		tgtIdx, okTgt := entityIndexByID[tgtID]
		if srcID == "" || tgtID == "" || !okSrc || !okTgt {
			continue
		}

		if srcID == tgtID {
			selfEnt := &entities[srcIdx]
			injectForeignKeyIfAbsent(selfEnt, "parent_id",
				fmt.Sprintf("上级%s ID", selfEnt.Comment),
				fmt.Sprintf("自引用外键: 关联 %s(id)", selfEnt.Name),
				fmt.Sprintf("idx_%s_parent_id", selfEnt.Name),
				"层级父节点查询索引",
				true, false, spec,
			)
			physicalRelations = append(physicalRelations, newPhysicalRelation(srcID, tgtID, "one_to_many"))
			continue
		}

		srcEnt := &entities[srcIdx]
		tgtEnt := &entities[tgtIdx]

		switch rel.Cardinality {
		case domain.CardOneToMany, "":
			fkName := fmt.Sprintf("%s_id", naming.Singularize(srcEnt.Name))
			injectForeignKeyIfAbsent(tgtEnt, fkName,
				fmt.Sprintf("关联 %s 主键", srcEnt.Comment),
				fmt.Sprintf("外键: 关联 %s(id)", srcEnt.Name),
				fmt.Sprintf("idx_%s_%s", tgtEnt.Name, fkName),
				fmt.Sprintf("外键关联 %s 索引", srcEnt.Name),
				false, false, spec,
			)
			physicalRelations = append(physicalRelations, newPhysicalRelation(srcID, tgtID, "one_to_many"))

		case domain.CardOneToOne:
			fkName := fmt.Sprintf("%s_id", naming.Singularize(srcEnt.Name))
			injectForeignKeyIfAbsent(tgtEnt, fkName,
				fmt.Sprintf("关联 %s 主键", srcEnt.Comment),
				fmt.Sprintf("外键: 关联 %s(id)", srcEnt.Name),
				fmt.Sprintf("uk_%s_%s", tgtEnt.Name, fkName),
				fmt.Sprintf("1:1 关联 %s 唯一索引", srcEnt.Name),
				false, true, spec,
			)
			physicalRelations = append(physicalRelations, newPhysicalRelation(srcID, tgtID, "one_to_one"))

		case domain.CardManyToMany:
			jEnt := buildJunctionEntity(srcEnt, tgtEnt, usedTableNames, spec)
			junctionEntities = append(junctionEntities, jEnt)
			physicalRelations = append(physicalRelations,
				newPhysicalRelation(srcID, jEnt.ID, "one_to_many"),
				newPhysicalRelation(tgtID, jEnt.ID, "one_to_many"),
			)
		}
	}

	entities = append(entities, junctionEntities...)
	return sanitizeERDesign(entities, physicalRelations, input.CurrentERDesign)
}

func buildPhysicalEntityFromConcept(c domain.BusinessConcept, spec dialect.Spec) domain.Entity {
	entID := id.NewUUIDv7()
	if c.ID != "" && id.IsValidUUID(c.ID) {
		entID = c.ID
	}
	tableName := naming.PluralizeTable(c.Name)

	attrs := make([]domain.Attribute, 0, len(c.Attributes)+3)
	attrs = append(attrs, domain.Attribute{
		ID:           id.NewUUIDv7(),
		Name:         "id",
		Comment:      "主键 ID",
		DBType:       spec.PrimaryKeySQL,
		CodeType:     spec.PrimaryKeyGo,
		IsPrimaryKey: true,
		IsNullable:   false,
		IsUnique:     true,
		Description:  "自增主键标识",
	})

	indexes := make([]domain.IndexDefinition, 0)
	seenAttrNames := map[string]bool{"id": true}
	for _, a := range c.Attributes {
		attrName := naming.ToSnakeCase(a.Name)
		if attrName == "" || seenAttrNames[attrName] || attrName == "created_at" || attrName == "updated_at" {
			continue
		}
		seenAttrNames[attrName] = true

		dbType, codeType := mapCategoryToDBType(a.Category, attrName, spec)
		isUnique := a.IsUnique || a.IsBusinessKey
		attrs = append(attrs, domain.Attribute{
			ID:          id.NewUUIDv7(),
			Name:        attrName,
			Comment:     a.DisplayName,
			DBType:      dbType,
			CodeType:    codeType,
			IsNullable:  !a.Required && !isUnique,
			IsUnique:    isUnique,
			Description: a.Description,
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

	attrs = append(attrs,
		domain.Attribute{ID: id.NewUUIDv7(), Name: "created_at", Comment: "创建时间", DBType: spec.DateTimeSQL, CodeType: "time.Time", Description: "数据创建时间戳"},
		domain.Attribute{ID: id.NewUUIDv7(), Name: "updated_at", Comment: "更新时间", DBType: spec.DateTimeSQL, CodeType: "time.Time", Description: "数据最后修改时间戳"},
	)

	comment := strings.TrimSpace(c.DisplayName)
	if comment == "" {
		comment = strings.TrimSpace(c.Description)
	}
	if comment == "" {
		comment = c.Name
	}

	return domain.Entity{
		ID:         entID,
		Name:       tableName,
		Comment:    comment,
		Position:   domain.ClonePosition(c.Position),
		Attributes: attrs,
		Indexes:    indexes,
	}
}

func injectForeignKeyIfAbsent(
	ent *domain.Entity,
	fkName, comment, desc, idxName, idxComment string,
	nullable, unique bool,
	spec dialect.Spec,
) {
	for _, attr := range ent.Attributes {
		if attr.Name == fkName {
			return
		}
	}
	ent.Attributes = append(ent.Attributes, domain.Attribute{
		ID:          id.NewUUIDv7(),
		Name:        fkName,
		Comment:     comment,
		DBType:      spec.ForeignKeySQL,
		CodeType:    spec.ForeignKeyGo,
		IsNullable:  nullable,
		IsUnique:    unique,
		Description: desc,
	})
	ent.Indexes = append(ent.Indexes, domain.IndexDefinition{
		Name:     idxName,
		Columns:  []string{fkName},
		IsUnique: unique,
		Comment:  idxComment,
	})
}

func buildJunctionEntity(srcEnt, tgtEnt *domain.Entity, usedTableNames map[string]bool, spec dialect.Spec) domain.Entity {
	srcSing := naming.Singularize(srcEnt.Name)
	tgtSing := naming.Singularize(tgtEnt.Name)
	baseName := fmt.Sprintf("%s_%s", srcSing, tgtEnt.Name)
	junctionName := baseName
	for suffix := 2; usedTableNames[junctionName]; suffix++ {
		junctionName = fmt.Sprintf("%s_%d", baseName, suffix)
	}
	usedTableNames[junctionName] = true

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
	return domain.Entity{
		ID:              id.NewUUIDv7(),
		Name:            junctionName,
		Comment:         fmt.Sprintf("%s与%s关联", srcEnt.Comment, tgtEnt.Comment),
		IsJunctionTable: &isJunc,
		Position:        jPos,
		Attributes: []domain.Attribute{
			{ID: id.NewUUIDv7(), Name: "id", Comment: "主键 ID", DBType: spec.ForeignKeySQL, CodeType: spec.ForeignKeyGo, IsPrimaryKey: true, IsUnique: true, Description: "自增主键标识"},
			{ID: id.NewUUIDv7(), Name: srcFK, Comment: fmt.Sprintf("%s 外键", srcEnt.Comment), DBType: spec.ForeignKeySQL, CodeType: spec.ForeignKeyGo, Description: fmt.Sprintf("外键: 关联 %s(id)", srcEnt.Name)},
			{ID: id.NewUUIDv7(), Name: tgtFK, Comment: fmt.Sprintf("%s 外键", tgtEnt.Comment), DBType: spec.ForeignKeySQL, CodeType: spec.ForeignKeyGo, Description: fmt.Sprintf("外键: 关联 %s(id)", tgtEnt.Name)},
			{ID: id.NewUUIDv7(), Name: "created_at", Comment: "创建时间", DBType: spec.DateTimeSQL, CodeType: "time.Time", Description: "关联创建时间戳"},
		},
		Indexes: []domain.IndexDefinition{
			{Name: fmt.Sprintf("uk_%s_%s_%s", junctionName, srcSing, tgtSing), Columns: []string{srcFK, tgtFK}, IsUnique: true, Comment: "防重复关联联合唯一索引"},
			{Name: fmt.Sprintf("idx_%s_%s", junctionName, tgtFK), Columns: []string{tgtFK}, Comment: "反向查询索引"},
		},
	}
}

func newPhysicalRelation(srcID, tgtID, cardinality string) domain.Relation {
	return domain.Relation{
		ID:             id.NewUUIDv7(),
		SourceEntityID: srcID,
		TargetEntityID: tgtID,
		RelationTypeID: cardinality,
		Cardinality:    cardinality,
	}
}

func mapCategoryToDBType(category domain.AttributeCategory, attrName string, spec dialect.Spec) (string, string) {
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
		return spec.StringSQL, "string"

	case domain.AttrNumber:
		if IsMonetaryColumnName(attrName) {
			return spec.DecimalSQL, "float64"
		}
		if strings.Contains(attrName, "count") || strings.Contains(attrName, "num") || strings.Contains(attrName, "qty") || strings.Contains(attrName, "age") || strings.Contains(attrName, "score") {
			return "INT", "int"
		}
		return spec.BigIntSQL, "int64"

	case domain.AttrBoolean:
		return spec.BooleanSQL, "bool"

	case domain.AttrDateTime:
		return spec.DateTimeSQL, "time.Time"

	case domain.AttrEnum:
		return "VARCHAR(32)", "string"

	case domain.AttrMedia:
		return "VARCHAR(255)", "string"

	default:
		return spec.StringSQL, "string"
	}
}
