package repository

import (
	"encoding/json"
	"fmt"
	"strings"

	"archcanvas/internal/domain"
	"archcanvas/internal/model"
	"archcanvas/internal/validator"
	"archcanvas/pkg/id"
)

type erTakenForeignUUIDs struct {
	Entities   map[string]bool
	Attributes map[string]bool
	Relations  map[string]bool
}

type erRenameWorkaround struct {
	ID       string
	TempName string
}

// erDiffPlan 表示纯内存确定性计算出的物理 ER 设计增量变更计划（零数据库依赖）。
type erDiffPlan struct {
	EntitiesToInsert  []model.Entity
	EntitiesToUpdate  []model.Entity
	EntityDeleteIDs   []string
	EntityTempRenames []erRenameWorkaround

	AttrsToInsert   []model.Attribute
	AttrsToUpdate   []model.Attribute
	AttrDeleteIDs   []string
	AttrTempRenames []erRenameWorkaround

	RelsToInsert []model.Relation
	RelsToUpdate []model.Relation
	RelDeleteIDs []string

	CanonicalEntityIDs map[string]string
}

func ptrEqual[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// planERDiff 在纯内存中对比既有快照与目标设计，生成无副作用的增删改与重命名避障执行计划。
func planERDiff(
	projectID string,
	oldEntities []model.Entity,
	oldAttributes []model.Attribute,
	oldRelations []model.Relation,
	taken erTakenForeignUUIDs,
	incoming domain.ERDesign,
) (*erDiffPlan, error) {
	entities := incoming.Entities
	relations := incoming.Relations

	oldEntitiesByID := make(map[string]model.Entity, len(oldEntities))
	oldEntitiesByName := make(map[string]model.Entity, len(oldEntities))
	oldPosByID := make(map[string][2]*float64, len(oldEntities))
	oldPosByName := make(map[string][2]*float64, len(oldEntities))

	for _, e := range oldEntities {
		oldEntitiesByID[e.ID] = e
		oldEntitiesByName[strings.ToLower(e.Name)] = e
		if e.PosX != nil && e.PosY != nil {
			oldPosByID[e.ID] = [2]*float64{e.PosX, e.PosY}
			oldPosByName[strings.ToLower(e.Name)] = [2]*float64{e.PosX, e.PosY}
		}
	}

	oldAttrsByEntityID := make(map[string][]model.Attribute, len(oldEntities))
	for _, a := range oldAttributes {
		oldAttrsByEntityID[a.EntityID] = append(oldAttrsByEntityID[a.EntityID], a)
	}

	oldRelationsByID := make(map[string]model.Relation, len(oldRelations))
	for _, rel := range oldRelations {
		oldRelationsByID[rel.ID] = rel
	}

	// 1. 两阶段实体 ID 解析（Pass 1: 严格按已有 ID 绑定；Pass 2: 对未绑定项按未占用的旧表名回退匹配）
	entityIDMap := make(map[string]string, len(entities)*3)
	matchedOldEntityIDs := make(map[string]bool, len(oldEntities))
	usedNewEntityIDs := make(map[string]bool, len(entities))
	resolvedEntityIDs := make([]string, len(entities))

	for i, e := range entities {
		if oldEnt, ok := oldEntitiesByID[e.ID]; ok && !matchedOldEntityIDs[oldEnt.ID] {
			resolvedEntityIDs[i] = oldEnt.ID
			matchedOldEntityIDs[oldEnt.ID] = true
			usedNewEntityIDs[oldEnt.ID] = true
		}
	}

	for i, e := range entities {
		if resolvedEntityIDs[i] != "" {
			continue
		}
		entNameClean := strings.TrimSpace(e.Name)
		if oldEnt, ok := oldEntitiesByName[strings.ToLower(entNameClean)]; ok && !matchedOldEntityIDs[oldEnt.ID] {
			resolvedEntityIDs[i] = oldEnt.ID
			matchedOldEntityIDs[oldEnt.ID] = true
			usedNewEntityIDs[oldEnt.ID] = true
		} else if id.IsValidUUID(e.ID) && !taken.Entities[e.ID] && !usedNewEntityIDs[e.ID] {
			resolvedEntityIDs[i] = e.ID
			usedNewEntityIDs[e.ID] = true
		} else {
			newID := id.NewUUIDv7()
			resolvedEntityIDs[i] = newID
			usedNewEntityIDs[newID] = true
		}
	}

	plan := &erDiffPlan{
		CanonicalEntityIDs: entityIDMap,
	}
	validSavedEntityIDs := make(map[string]bool, len(entities))

	for i, e := range entities {
		entityID := resolvedEntityIDs[i]
		entNameClean := strings.TrimSpace(e.Name)
		validSavedEntityIDs[entityID] = true

		if e.ID != "" {
			entityIDMap[e.ID] = entityID
			entityIDMap[strings.ToLower(e.ID)] = entityID
		}
		entityIDMap[entNameClean] = entityID
		entityIDMap[strings.ToLower(entNameClean)] = entityID
		entityIDMap[entityID] = entityID

		var posX, posY *float64
		if e.Position != nil {
			x := e.Position.X
			y := e.Position.Y
			posX = &x
			posY = &y
		} else if oldPos, ok := oldPosByID[entityID]; ok {
			posX = oldPos[0]
			posY = oldPos[1]
		} else if oldPos, ok := oldPosByID[e.ID]; ok {
			posX = oldPos[0]
			posY = oldPos[1]
		} else if oldPos, ok := oldPosByName[strings.ToLower(entNameClean)]; ok {
			posX = oldPos[0]
			posY = oldPos[1]
		}

		indexesJSON := ""
		if len(e.Indexes) > 0 {
			bytes, err := json.Marshal(e.Indexes)
			if err != nil {
				return nil, fmt.Errorf("marshal indexes for entity %q: %w", entNameClean, err)
			}
			indexesJSON = string(bytes)
		}

		entModel := model.Entity{
			ID:              entityID,
			ProjectID:       projectID,
			Name:            entNameClean,
			Comment:         e.Comment,
			Indexes:         indexesJSON,
			IsJunctionTable: e.IsJunctionTable,
			PosX:            posX,
			PosY:            posY,
		}

		if oldEnt, ok := oldEntitiesByID[entityID]; ok {
			if oldEnt.Name != entModel.Name ||
				oldEnt.Comment != entModel.Comment ||
				oldEnt.Indexes != entModel.Indexes ||
				!ptrEqual(oldEnt.IsJunctionTable, entModel.IsJunctionTable) ||
				!ptrEqual(oldEnt.PosX, entModel.PosX) ||
				!ptrEqual(oldEnt.PosY, entModel.PosY) {
				plan.EntitiesToUpdate = append(plan.EntitiesToUpdate, entModel)
			}
		} else {
			plan.EntitiesToInsert = append(plan.EntitiesToInsert, entModel)
		}
	}

	deletedEntitySet := make(map[string]bool)
	for _, oldEnt := range oldEntities {
		if !matchedOldEntityIDs[oldEnt.ID] {
			plan.EntityDeleteIDs = append(plan.EntityDeleteIDs, oldEnt.ID)
			deletedEntitySet[oldEnt.ID] = true
		}
	}

	for _, ent := range plan.EntitiesToUpdate {
		if oldEnt, ok := oldEntitiesByID[ent.ID]; ok && oldEnt.Name != ent.Name {
			if conflicting, exists := oldEntitiesByName[strings.ToLower(ent.Name)]; exists && conflicting.ID != ent.ID && !deletedEntitySet[conflicting.ID] {
				plan.EntityTempRenames = append(plan.EntityTempRenames, erRenameWorkaround{
					ID:       conflicting.ID,
					TempName: fmt.Sprintf("%s__renaming_%s", conflicting.Name, id.NewUUIDv7()[:8]),
				})
			}
		}
	}

	// 2. 两阶段属性 ID 解析与列顺序 (sort_order) 规划
	usedGlobalAttrIDs := make(map[string]bool)

	for i, e := range entities {
		entityID := resolvedEntityIDs[i]
		existingAttrs := oldAttrsByEntityID[entityID]
		existingAttrsByID := make(map[string]model.Attribute, len(existingAttrs))
		existingAttrsByName := make(map[string]model.Attribute, len(existingAttrs))
		for _, a := range existingAttrs {
			existingAttrsByID[a.ID] = a
			existingAttrsByName[strings.ToLower(a.Name)] = a
		}

		matchedAttrIDs := make(map[string]bool, len(e.Attributes))
		resolvedAttrIDs := make([]string, len(e.Attributes))

		for j, attr := range e.Attributes {
			if oldA, ok := existingAttrsByID[attr.ID]; ok && !matchedAttrIDs[oldA.ID] {
				resolvedAttrIDs[j] = oldA.ID
				matchedAttrIDs[oldA.ID] = true
				usedGlobalAttrIDs[oldA.ID] = true
			}
		}

		for j, attr := range e.Attributes {
			if resolvedAttrIDs[j] != "" {
				continue
			}
			attrNameClean := strings.TrimSpace(attr.Name)
			if oldA, ok := existingAttrsByName[strings.ToLower(attrNameClean)]; ok && !matchedAttrIDs[oldA.ID] {
				resolvedAttrIDs[j] = oldA.ID
				matchedAttrIDs[oldA.ID] = true
				usedGlobalAttrIDs[oldA.ID] = true
			} else if id.IsValidUUID(attr.ID) && !taken.Attributes[attr.ID] && !usedGlobalAttrIDs[attr.ID] {
				var ownedElsewhere bool
				for _, oa := range oldAttributes {
					if oa.ID == attr.ID && oa.EntityID != entityID {
						ownedElsewhere = true
						break
					}
				}
				if !ownedElsewhere {
					resolvedAttrIDs[j] = attr.ID
					usedGlobalAttrIDs[attr.ID] = true
				} else {
					newID := id.NewUUIDv7()
					resolvedAttrIDs[j] = newID
					usedGlobalAttrIDs[newID] = true
				}
			} else {
				newID := id.NewUUIDv7()
				resolvedAttrIDs[j] = newID
				usedGlobalAttrIDs[newID] = true
			}
		}

		var entityAttrUpdates []model.Attribute
		for j, attr := range e.Attributes {
			attrID := resolvedAttrIDs[j]
			attrModel := model.Attribute{
				ID:           attrID,
				EntityID:     entityID,
				SortOrder:    j,
				Name:         strings.TrimSpace(attr.Name),
				Comment:      attr.Comment,
				DBType:       attr.DBType,
				CodeType:     attr.CodeType,
				IsPrimaryKey: attr.IsPrimaryKey,
				IsNullable:   attr.IsNullable,
				IsUnique:     attr.IsUnique,
				DefaultValue: attr.DefaultValue,
				Description:  attr.Description,
			}

			if oldA, ok := existingAttrsByID[attrID]; ok {
				if oldA.Name != attrModel.Name ||
					oldA.SortOrder != attrModel.SortOrder ||
					oldA.Comment != attrModel.Comment ||
					oldA.DBType != attrModel.DBType ||
					oldA.CodeType != attrModel.CodeType ||
					oldA.IsPrimaryKey != attrModel.IsPrimaryKey ||
					oldA.IsNullable != attrModel.IsNullable ||
					oldA.IsUnique != attrModel.IsUnique ||
					!ptrEqual(oldA.DefaultValue, attrModel.DefaultValue) ||
					oldA.Description != attrModel.Description {
					plan.AttrsToUpdate = append(plan.AttrsToUpdate, attrModel)
					entityAttrUpdates = append(entityAttrUpdates, attrModel)
				}
			} else {
				plan.AttrsToInsert = append(plan.AttrsToInsert, attrModel)
			}
		}

		deletedAttrSet := make(map[string]bool)
		for _, oldA := range existingAttrs {
			if !matchedAttrIDs[oldA.ID] {
				plan.AttrDeleteIDs = append(plan.AttrDeleteIDs, oldA.ID)
				deletedAttrSet[oldA.ID] = true
			}
		}

		for _, attr := range entityAttrUpdates {
			for _, oldA := range existingAttrs {
				if oldA.ID != attr.ID && !deletedAttrSet[oldA.ID] && strings.EqualFold(oldA.Name, attr.Name) {
					plan.AttrTempRenames = append(plan.AttrTempRenames, erRenameWorkaround{
						ID:       oldA.ID,
						TempName: fmt.Sprintf("%s__renaming_%s", oldA.Name, id.NewUUIDv7()[:8]),
					})
				}
			}
		}
	}

	// 3. 关联关系 (Relations) Diff 规划与端点重映射
	matchedOldRelIDs := make(map[string]bool, len(oldRelations))
	usedRelIDs := make(map[string]bool, len(relations))

	for _, rel := range relations {
		sourceID := strings.TrimSpace(rel.SourceEntityID)
		if mapped, ok := entityIDMap[sourceID]; ok {
			sourceID = mapped
		} else if mapped, ok := entityIDMap[strings.ToLower(sourceID)]; ok {
			sourceID = mapped
		}

		targetID := strings.TrimSpace(rel.TargetEntityID)
		if mapped, ok := entityIDMap[targetID]; ok {
			targetID = mapped
		} else if mapped, ok := entityIDMap[strings.ToLower(targetID)]; ok {
			targetID = mapped
		}

		if !validSavedEntityIDs[sourceID] || !validSavedEntityIDs[targetID] {
			return nil, validator.NewValidationError("关联关系引用了不存在的实体端点 (%q -> %q)", rel.SourceEntityID, rel.TargetEntityID)
		}

		relType := rel.EffectiveCardinality()

		var relID string
		if _, ok := oldRelationsByID[rel.ID]; ok && !matchedOldRelIDs[rel.ID] {
			relID = rel.ID
		} else {
			for _, oldR := range oldRelations {
				if !matchedOldRelIDs[oldR.ID] &&
					oldR.SourceEntityID == sourceID &&
					oldR.TargetEntityID == targetID &&
					oldR.RelationTypeID == relType {
					relID = oldR.ID
					break
				}
			}
			if relID == "" {
				for _, oldR := range oldRelations {
					if !matchedOldRelIDs[oldR.ID] &&
						oldR.SourceEntityID == sourceID &&
						oldR.TargetEntityID == targetID {
						relID = oldR.ID
						break
					}
				}
			}
			if relID == "" {
				if id.IsValidUUID(rel.ID) && !taken.Relations[rel.ID] && !usedRelIDs[rel.ID] {
					relID = rel.ID
				} else {
					relID = id.NewUUIDv7()
				}
			}
		}

		matchedOldRelIDs[relID] = true
		usedRelIDs[relID] = true

		relModel := model.Relation{
			ID:             relID,
			ProjectID:      projectID,
			SourceEntityID: sourceID,
			TargetEntityID: targetID,
			RelationTypeID: relType,
		}

		if oldR, ok := oldRelationsByID[relID]; ok {
			if oldR.SourceEntityID != relModel.SourceEntityID ||
				oldR.TargetEntityID != relModel.TargetEntityID ||
				oldR.RelationTypeID != relModel.RelationTypeID {
				plan.RelsToUpdate = append(plan.RelsToUpdate, relModel)
			}
		} else {
			plan.RelsToInsert = append(plan.RelsToInsert, relModel)
		}
	}

	for _, oldR := range oldRelations {
		if !matchedOldRelIDs[oldR.ID] {
			plan.RelDeleteIDs = append(plan.RelDeleteIDs, oldR.ID)
		}
	}

	return plan, nil
}
