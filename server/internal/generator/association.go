package generator

import (
	"fmt"
	"strings"

	"archcanvas/internal/domain"
	"archcanvas/pkg/naming"
)

func applyRelationAssociations(design *domain.ERDesign, entityMap map[string]EntityTemplateData) {
	for _, rel := range design.Relations {
		sourceEnt, okSource := entityMap[rel.SourceEntityID]
		if !okSource {
			sourceEnt, okSource = entityMap[strings.ToLower(strings.TrimSpace(rel.SourceEntityID))]
		}
		targetEnt, okTarget := entityMap[rel.TargetEntityID]
		if !okTarget {
			targetEnt, okTarget = entityMap[strings.ToLower(strings.TrimSpace(rel.TargetEntityID))]
		}
		if !okSource || !okTarget {
			continue
		}

		// 0. 同实体树形自引用（仅当实体存在自引用外键列时才注入 Children / Parent）
		if sourceEnt.ID == targetEnt.ID {
			fkFieldName := findSelfReferenceFKField(sourceEnt)
			if fkFieldName == "" {
				continue
			}

			pkFieldName := sourceEnt.PrimaryKey.FieldName
			if pkFieldName == "" {
				pkFieldName = "ID"
			}

			addAssociationSafe(&sourceEnt, AssocFieldData{
				Type:      "HasMany",
				FieldName: "Children",
				FieldType: "[]" + sourceEnt.StructName,
				GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
				JsonTag:   `json:"children,omitempty"`,
			})

			addAssociationSafe(&sourceEnt, AssocFieldData{
				Type:      "BelongsTo",
				FieldName: "Parent",
				FieldType: "*" + sourceEnt.StructName,
				GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
				JsonTag:   `json:"parent,omitempty"`,
			})

			storeEntityData(entityMap, sourceEnt)
			continue
		}

		// 1. 显式声明的多对多关联 (M:N / many_to_many)
		if rel.IsManyToMany() {
			junctionTable := SafeFileStem(sourceEnt.TableName+"_"+targetEnt.TableName, 1)
			addAssociationSafe(&sourceEnt, AssocFieldData{
				Type:      "ManyToMany",
				FieldName: SafeFieldName(targetEnt.TableName),
				FieldType: "[]" + targetEnt.StructName,
				GormTag:   fmt.Sprintf(`gorm:"many2many:%s;"`, junctionTable),
				JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(SafeFieldName(targetEnt.TableName))),
			})
			addAssociationSafe(&targetEnt, AssocFieldData{
				Type:      "ManyToMany",
				FieldName: SafeFieldName(sourceEnt.TableName),
				FieldType: "[]" + sourceEnt.StructName,
				GormTag:   fmt.Sprintf(`gorm:"many2many:%s;"`, junctionTable),
				JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(SafeFieldName(sourceEnt.TableName))),
			})

			storeEntityData(entityMap, sourceEnt)
			storeEntityData(entityMap, targetEnt)
			continue
		}

		// 2. 常规 1:N / 1:1 关联推导：寻找 targetEnt 上实际存在的外键字段
		fkFieldName := findTargetFKField(sourceEnt, targetEnt)
		if fkFieldName == "" {
			continue
		}

		pkFieldName := sourceEnt.PrimaryKey.FieldName
		if pkFieldName == "" {
			pkFieldName = "ID"
		}

		hasManyName := SafeFieldName(targetEnt.TableName)
		addAssociationSafe(&sourceEnt, AssocFieldData{
			Type:      "HasMany",
			FieldName: hasManyName,
			FieldType: "[]" + targetEnt.StructName,
			GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(hasManyName)),
		})

		belongsToName := sourceEnt.StructName
		addAssociationSafe(&targetEnt, AssocFieldData{
			Type:      "BelongsTo",
			FieldName: belongsToName,
			FieldType: "*" + sourceEnt.StructName,
			GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(belongsToName)),
		})

		storeEntityData(entityMap, sourceEnt)
		storeEntityData(entityMap, targetEnt)
	}
}

func findSelfReferenceFKField(ent EntityTemplateData) string {
	for _, a := range ent.Attributes {
		aLower := strings.ToLower(a.Name)
		if aLower == "parent_id" || aLower == "pid" {
			return a.FieldName
		}
	}
	for _, a := range ent.Attributes {
		if !a.IsPrimaryKey && strings.HasSuffix(strings.ToLower(a.Name), "_id") {
			return a.FieldName
		}
	}
	return ""
}

func findTargetFKField(sourceEnt, targetEnt EntityTemplateData) string {
	srcTableLower := strings.ToLower(sourceEnt.TableName)
	srcSingLower := naming.Singularize(sourceEnt.TableName)
	var genericFKCandidates []string

	for _, a := range targetEnt.Attributes {
		if a.IsPrimaryKey {
			continue
		}
		aLower := strings.ToLower(a.Name)
		if aLower == srcTableLower+"_id" || aLower == srcSingLower+"_id" {
			return a.FieldName
		}
		if strings.HasSuffix(aLower, "_id") {
			genericFKCandidates = append(genericFKCandidates, a.FieldName)
		}
	}
	if len(genericFKCandidates) == 1 {
		return genericFKCandidates[0]
	}
	return ""
}

func storeEntityData(entityMap map[string]EntityTemplateData, ent EntityTemplateData) {
	entityMap[ent.ID] = ent
	if ent.TableName != "" {
		entityMap[strings.ToLower(ent.TableName)] = ent
	}
}

func addAssociationSafe(ent *EntityTemplateData, assoc AssocFieldData) {
	usedNames := map[string]bool{
		"id":        true,
		"createdat": true,
		"updatedat": true,
		"deletedat": true,
		"basemodel": true,
		"tablename": true,
	}

	for _, a := range ent.Attributes {
		usedNames[strings.ToLower(a.FieldName)] = true
	}

	for _, existing := range ent.Associations {
		if existing.Type == assoc.Type &&
			existing.FieldType == assoc.FieldType &&
			existing.GormTag == assoc.GormTag {
			return
		}
		usedNames[strings.ToLower(existing.FieldName)] = true
	}

	baseName := SafeFieldName(assoc.FieldName)
	if baseName == "" {
		baseName = "Relation"
	}
	fieldName := baseName
	counter := 2
	for usedNames[strings.ToLower(fieldName)] {
		fieldName = fmt.Sprintf("%s%d", baseName, counter)
		counter++
	}

	assoc.FieldName = fieldName
	assoc.JsonTag = fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(fieldName))
	ent.Associations = append(ent.Associations, assoc)
}

func lookupEntityData(ent domain.Entity, entityMap map[string]EntityTemplateData) (EntityTemplateData, bool) {
	if ent.ID != "" {
		if d, ok := entityMap[ent.ID]; ok {
			return d, true
		}
	}
	if ent.Name != "" {
		if d, ok := entityMap[strings.ToLower(strings.TrimSpace(ent.Name))]; ok {
			return d, true
		}
	}
	return EntityTemplateData{}, false
}

func applyJunctionTableManyToMany(design *domain.ERDesign, entityMap map[string]EntityTemplateData) {
	matches := domain.DetectJunctionTables(design)
	for _, m := range matches {
		entA, okA := lookupEntityData(m.LeftTarget, entityMap)
		entB, okB := lookupEntityData(m.RightTarget, entityMap)
		juncData, okJ := lookupEntityData(m.Entity, entityMap)
		if !okA || !okB || !okJ {
			continue
		}
		junctionTable := sanitizeStructTagValue(juncData.TableName)
		junctionTable = strings.ReplaceAll(junctionTable, ";", "")

		addAssociationSafe(&entA, AssocFieldData{
			Type:      "ManyToMany",
			FieldName: SafeFieldName(entB.TableName),
			FieldType: "[]" + entB.StructName,
			GormTag:   fmt.Sprintf(`gorm:"many2many:%s;"`, junctionTable),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(SafeFieldName(entB.TableName))),
		})

		addAssociationSafe(&entB, AssocFieldData{
			Type:      "ManyToMany",
			FieldName: SafeFieldName(entA.TableName),
			FieldType: "[]" + entA.StructName,
			GormTag:   fmt.Sprintf(`gorm:"many2many:%s;"`, junctionTable),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(SafeFieldName(entA.TableName))),
		})

		storeEntityData(entityMap, entA)
		storeEntityData(entityMap, entB)
	}
}
