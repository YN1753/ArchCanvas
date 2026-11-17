package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"archcanvas/internal/domain"
	"archcanvas/internal/model"
	"archcanvas/internal/validator"
	"archcanvas/pkg/id"

	"gorm.io/gorm"
)

var ErrProjectIDRequired = errors.New("project id is required")

type ERDesignRepository struct {
	db *gorm.DB
}

func NewERDesignRepository(db *gorm.DB) *ERDesignRepository {
	return &ERDesignRepository{db: db}
}

func (r *ERDesignRepository) GetByProjectID(
	ctx context.Context,
	projectID string,
) (*domain.ERDesign, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("er design repository database is nil")
	}
	if projectID == "" {
		return nil, ErrProjectIDRequired
	}

	return getERDesignWithDB(r.db.WithContext(ctx), projectID)
}

func getERDesignWithDB(tx *gorm.DB, projectID string) (*domain.ERDesign, error) {
	entities := make([]model.Entity, 0)
	if err := tx.
		Where("project_id = ?", projectID).
		Order("id ASC").
		Find(&entities).Error; err != nil {
		return nil, fmt.Errorf("find entities for project %q: %w", projectID, err)
	}

	attributes := make([]model.Attribute, 0)
	if len(entities) > 0 {
		entityIDs := make([]string, 0, len(entities))
		for _, entity := range entities {
			entityIDs = append(entityIDs, entity.ID)
		}

		if err := tx.
			Where("entity_id IN ?", entityIDs).
			Order("entity_id ASC, sort_order ASC, id ASC").
			Find(&attributes).Error; err != nil {
			return nil, fmt.Errorf("find attributes for project %q: %w", projectID, err)
		}
	}

	relations := make([]model.Relation, 0)
	if err := tx.
		Where("project_id = ?", projectID).
		Order("id ASC").
		Find(&relations).Error; err != nil {
		return nil, fmt.Errorf("find relations for project %q: %w", projectID, err)
	}

	attributesByEntityID := make(map[string][]domain.Attribute, len(entities))
	for _, attribute := range attributes {
		attributesByEntityID[attribute.EntityID] = append(
			attributesByEntityID[attribute.EntityID],
			toDomainAttribute(attribute),
		)
	}

	design := &domain.ERDesign{
		Entities:  make([]domain.Entity, 0, len(entities)),
		Relations: make([]domain.Relation, 0, len(relations)),
	}
	for _, entity := range entities {
		entityAttributes := attributesByEntityID[entity.ID]
		if entityAttributes == nil {
			entityAttributes = make([]domain.Attribute, 0)
		}

		var pos *domain.Position
		if entity.PosX != nil && entity.PosY != nil {
			pos = &domain.Position{
				X: *entity.PosX,
				Y: *entity.PosY,
			}
		}

		var indexes []domain.IndexDefinition
		if entity.Indexes != "" && entity.Indexes != "[]" {
			if err := json.Unmarshal([]byte(entity.Indexes), &indexes); err != nil {
				return nil, fmt.Errorf("unmarshal indexes for entity %q: %w", entity.Name, err)
			}
		}
		if indexes == nil {
			indexes = make([]domain.IndexDefinition, 0)
		}

		design.Entities = append(design.Entities, domain.Entity{
			ID:              entity.ID,
			Name:            entity.Name,
			Comment:         entity.Comment,
			Position:        pos,
			Attributes:      entityAttributes,
			Indexes:         indexes,
			IsJunctionTable: entity.IsJunctionTable,
		})
	}
	for _, relation := range relations {
		relType := relation.RelationTypeID
		if relType == "" {
			relType = "one_to_many"
		}
		design.Relations = append(design.Relations, domain.Relation{
			ID:             relation.ID,
			SourceEntityID: relation.SourceEntityID,
			TargetEntityID: relation.TargetEntityID,
			RelationTypeID: relType,
			Cardinality:    relType,
		})
	}

	return design, nil
}

func (r *ERDesignRepository) SaveByProjectID(
	ctx context.Context,
	projectID string,
	entities []domain.Entity,
	relations []domain.Relation,
) (*domain.ERDesign, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("er design repository database is nil")
	}
	if projectID == "" {
		return nil, ErrProjectIDRequired
	}
	if err := validator.ValidateERDesignInput(entities, relations); err != nil {
		return nil, err
	}

	var saved *domain.ERDesign
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 0. 校验目标项目存在，防止写入孤儿实体记录
		var projectCount int64
		if err := tx.Model(&model.Project{}).Where("id = ?", projectID).Count(&projectCount).Error; err != nil {
			return fmt.Errorf("verify project existence: %w", err)
		}
		if projectCount == 0 {
			return gorm.ErrRecordNotFound
		}

		// 1. 读取当前项目已有的实体、属性和关系快照
		var oldEntities []model.Entity
		if err := tx.Where("project_id = ?", projectID).Find(&oldEntities).Error; err != nil {
			return fmt.Errorf("query existing entities: %w", err)
		}

		oldEntitiesByID := make(map[string]model.Entity, len(oldEntities))
		oldEntitiesByName := make(map[string]model.Entity, len(oldEntities))
		oldPosByID := make(map[string][2]*float64, len(oldEntities))
		oldPosByName := make(map[string][2]*float64, len(oldEntities))
		oldEntityIDs := make([]string, 0, len(oldEntities))

		for _, e := range oldEntities {
			oldEntitiesByID[e.ID] = e
			oldEntitiesByName[strings.ToLower(e.Name)] = e
			oldEntityIDs = append(oldEntityIDs, e.ID)
			if e.PosX != nil && e.PosY != nil {
				oldPosByID[e.ID] = [2]*float64{e.PosX, e.PosY}
				oldPosByName[strings.ToLower(e.Name)] = [2]*float64{e.PosX, e.PosY}
			}
		}

		var oldAttributes []model.Attribute
		if len(oldEntityIDs) > 0 {
			if err := tx.Where("entity_id IN ?", oldEntityIDs).Find(&oldAttributes).Error; err != nil {
				return fmt.Errorf("query existing attributes: %w", err)
			}
		}
		oldAttrsByEntityID := make(map[string][]model.Attribute, len(oldEntities))
		for _, a := range oldAttributes {
			oldAttrsByEntityID[a.EntityID] = append(oldAttrsByEntityID[a.EntityID], a)
		}

		var oldRelations []model.Relation
		if err := tx.Where("project_id = ?", projectID).Find(&oldRelations).Error; err != nil {
			return fmt.Errorf("query existing relations: %w", err)
		}
		oldRelationsByID := make(map[string]model.Relation, len(oldRelations))
		for _, rel := range oldRelations {
			oldRelationsByID[rel.ID] = rel
		}

		// 预查询所有候选外部 UUID 是否已被其他项目占用，彻底根除跨项目 JSON 导入导致的全局主键冲突
		foreignEntCandidates := make([]string, 0)
		foreignAttrCandidates := make([]string, 0)
		foreignRelCandidates := make([]string, 0)
		for _, e := range entities {
			if id.IsValidUUID(e.ID) {
				if _, owned := oldEntitiesByID[e.ID]; !owned {
					foreignEntCandidates = append(foreignEntCandidates, e.ID)
				}
			}
			for _, a := range e.Attributes {
				if id.IsValidUUID(a.ID) {
					foreignAttrCandidates = append(foreignAttrCandidates, a.ID)
				}
			}
		}
		for _, rel := range relations {
			if id.IsValidUUID(rel.ID) {
				if _, owned := oldRelationsByID[rel.ID]; !owned {
					foreignRelCandidates = append(foreignRelCandidates, rel.ID)
				}
			}
		}

		takenEntUUIDs := make(map[string]bool)
		if len(foreignEntCandidates) > 0 {
			var taken []string
			if err := tx.Model(&model.Entity{}).Where("id IN ? AND project_id <> ?", foreignEntCandidates, projectID).Pluck("id", &taken).Error; err != nil {
				return fmt.Errorf("check taken entity UUIDs: %w", err)
			}
			for _, u := range taken {
				takenEntUUIDs[u] = true
			}
		}

		takenAttrUUIDs := make(map[string]bool)
		if len(foreignAttrCandidates) > 0 {
			var existingForeignAttrs []model.Attribute
			if err := tx.Select("id", "entity_id").Where("id IN ?", foreignAttrCandidates).Find(&existingForeignAttrs).Error; err != nil {
				return fmt.Errorf("check taken attribute UUIDs: %w", err)
			}
			for _, a := range existingForeignAttrs {
				if _, ownedEnt := oldEntitiesByID[a.EntityID]; !ownedEnt {
					takenAttrUUIDs[a.ID] = true
				}
			}
		}

		takenRelUUIDs := make(map[string]bool)
		if len(foreignRelCandidates) > 0 {
			var taken []string
			if err := tx.Model(&model.Relation{}).Where("id IN ? AND project_id <> ?", foreignRelCandidates, projectID).Pluck("id", &taken).Error; err != nil {
				return fmt.Errorf("check taken relation UUIDs: %w", err)
			}
			for _, u := range taken {
				takenRelUUIDs[u] = true
			}
		}

		// 2. 两阶段实体 ID 解析（Pass 1: 严格按已有 ID 绑定；Pass 2: 对未绑定项按未占用的旧表名回退匹配）
		// 彻底解决「将 users 改名为 accounts 同时新增一张 users 表」时新表劫持旧表 ID 误删字段的缺陷。
		entityIDMap := make(map[string]string, len(entities)*3)
		matchedOldEntityIDs := make(map[string]bool, len(oldEntities))
		usedNewEntityIDs := make(map[string]bool, len(entities))
		resolvedEntityIDs := make([]string, len(entities))

		// Pass 1: 按当前项目已拥有的 Entity ID 精确锁定
		for i, e := range entities {
			if oldEnt, ok := oldEntitiesByID[e.ID]; ok && !matchedOldEntityIDs[oldEnt.ID] {
				resolvedEntityIDs[i] = oldEnt.ID
				matchedOldEntityIDs[oldEnt.ID] = true
				usedNewEntityIDs[oldEnt.ID] = true
			}
		}

		// Pass 2: 按未占用的旧表名回退匹配，或签发/保留无冲突的新 UUIDv7
		for i, e := range entities {
			if resolvedEntityIDs[i] != "" {
				continue
			}
			entNameClean := strings.TrimSpace(e.Name)
			if oldEnt, ok := oldEntitiesByName[strings.ToLower(entNameClean)]; ok && !matchedOldEntityIDs[oldEnt.ID] {
				resolvedEntityIDs[i] = oldEnt.ID
				matchedOldEntityIDs[oldEnt.ID] = true
				usedNewEntityIDs[oldEnt.ID] = true
			} else if id.IsValidUUID(e.ID) && !takenEntUUIDs[e.ID] && !usedNewEntityIDs[e.ID] {
				resolvedEntityIDs[i] = e.ID
				usedNewEntityIDs[e.ID] = true
			} else {
				newID := id.NewUUIDv7()
				resolvedEntityIDs[i] = newID
				usedNewEntityIDs[newID] = true
			}
		}

		var entitiesToInsert []model.Entity
		var entitiesToUpdate []model.Entity
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
					return fmt.Errorf("marshal indexes for entity %q: %w", entNameClean, err)
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
					!boolPtrEqual(oldEnt.IsJunctionTable, entModel.IsJunctionTable) ||
					!float64PtrEqual(oldEnt.PosX, entModel.PosX) ||
					!float64PtrEqual(oldEnt.PosY, entModel.PosY) {
					entitiesToUpdate = append(entitiesToUpdate, entModel)
				}
			} else {
				entitiesToInsert = append(entitiesToInsert, entModel)
			}
		}

		var entitiesToDeleteIDs []string
		for _, oldEnt := range oldEntities {
			if !matchedOldEntityIDs[oldEnt.ID] {
				entitiesToDeleteIDs = append(entitiesToDeleteIDs, oldEnt.ID)
			}
		}

		// 3. 两阶段属性 ID 解析与列顺序 (sort_order) 持久化
		var attrsToInsert []model.Attribute
		var attrsToUpdate []model.Attribute
		var attrsToDeleteIDs []string
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

			// Pass 1: 按所属表的已有 Attribute ID 精确锁定
			for j, attr := range e.Attributes {
				if oldA, ok := existingAttrsByID[attr.ID]; ok && !matchedAttrIDs[oldA.ID] {
					resolvedAttrIDs[j] = oldA.ID
					matchedAttrIDs[oldA.ID] = true
					usedGlobalAttrIDs[oldA.ID] = true
				}
			}

			// Pass 2: 按未占用的字段名回退匹配，或签发无冲突 UUIDv7
			for j, attr := range e.Attributes {
				if resolvedAttrIDs[j] != "" {
					continue
				}
				attrNameClean := strings.TrimSpace(attr.Name)
				if oldA, ok := existingAttrsByName[strings.ToLower(attrNameClean)]; ok && !matchedAttrIDs[oldA.ID] {
					resolvedAttrIDs[j] = oldA.ID
					matchedAttrIDs[oldA.ID] = true
					usedGlobalAttrIDs[oldA.ID] = true
				} else if id.IsValidUUID(attr.ID) && !takenAttrUUIDs[attr.ID] && !usedGlobalAttrIDs[attr.ID] {
					// 同时避免与当前项目中其他表的旧属性 ID 冲突
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
						!strPtrEqual(oldA.DefaultValue, attrModel.DefaultValue) ||
						oldA.Description != attrModel.Description {
						attrsToUpdate = append(attrsToUpdate, attrModel)
					}
				} else {
					attrsToInsert = append(attrsToInsert, attrModel)
				}
			}

			for _, oldA := range existingAttrs {
				if !matchedAttrIDs[oldA.ID] {
					attrsToDeleteIDs = append(attrsToDeleteIDs, oldA.ID)
				}
			}
		}

		// 4. Diff 计算：关联关系 (Relations)
		matchedOldRelIDs := make(map[string]bool, len(oldRelations))
		usedRelIDs := make(map[string]bool, len(relations))
		var relsToInsert []model.Relation
		var relsToUpdate []model.Relation

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
				return validator.NewValidationError("关联关系引用了不存在的实体端点 (%q -> %q)", rel.SourceEntityID, rel.TargetEntityID)
			}

			relType := strings.TrimSpace(rel.Cardinality)
			if relType == "" {
				relType = strings.TrimSpace(rel.RelationTypeID)
			}
			if relType == "" {
				relType = "one_to_many"
			}

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
					if id.IsValidUUID(rel.ID) && !takenRelUUIDs[rel.ID] && !usedRelIDs[rel.ID] {
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
					relsToUpdate = append(relsToUpdate, relModel)
				}
			} else {
				relsToInsert = append(relsToInsert, relModel)
			}
		}

		var relsToDeleteIDs []string
		for _, oldR := range oldRelations {
			if !matchedOldRelIDs[oldR.ID] {
				relsToDeleteIDs = append(relsToDeleteIDs, oldR.ID)
			}
		}

		// 5. 按照安全依赖顺序执行数据库增删改
		if len(relsToDeleteIDs) > 0 {
			if err := tx.Where("id IN ?", relsToDeleteIDs).Delete(&model.Relation{}).Error; err != nil {
				return fmt.Errorf("delete obsolete relations: %w", err)
			}
		}

		if len(attrsToDeleteIDs) > 0 {
			if err := tx.Where("id IN ?", attrsToDeleteIDs).Delete(&model.Attribute{}).Error; err != nil {
				return fmt.Errorf("delete obsolete attributes: %w", err)
			}
		}

		if len(entitiesToDeleteIDs) > 0 {
			if err := tx.Where("entity_id IN ?", entitiesToDeleteIDs).Delete(&model.Attribute{}).Error; err != nil {
				return fmt.Errorf("delete cascade attributes of removed entities: %w", err)
			}
			if err := tx.Where("source_entity_id IN ? OR target_entity_id IN ?", entitiesToDeleteIDs, entitiesToDeleteIDs).Delete(&model.Relation{}).Error; err != nil {
				return fmt.Errorf("delete cascade relations of removed entities: %w", err)
			}
			if err := tx.Where("id IN ?", entitiesToDeleteIDs).Delete(&model.Entity{}).Error; err != nil {
				return fmt.Errorf("delete removed entities: %w", err)
			}
		}

		// 避免重命名实体时触发 SQLite (project_id, name) 唯一索引冲突
		for _, ent := range entitiesToUpdate {
			if oldEnt, ok := oldEntitiesByID[ent.ID]; ok && !strings.EqualFold(oldEnt.Name, ent.Name) || (ok && oldEnt.Name != ent.Name) {
				if conflicting, exists := oldEntitiesByName[strings.ToLower(ent.Name)]; exists && conflicting.ID != ent.ID {
					tempName := fmt.Sprintf("%s__renaming_%s", conflicting.Name, id.NewUUIDv7()[:8])
					if err := tx.Model(&model.Entity{}).Where("id = ?", conflicting.ID).Update("name", tempName).Error; err != nil {
						return fmt.Errorf("entity rename collision resolution: %w", err)
					}
				}
			}
		}

		for _, ent := range entitiesToUpdate {
			if err := tx.Model(&model.Entity{}).
				Where("id = ?", ent.ID).
				Updates(map[string]any{
					"name":              ent.Name,
					"comment":           ent.Comment,
					"indexes":           ent.Indexes,
					"is_junction_table": ent.IsJunctionTable,
					"pos_x":             ent.PosX,
					"pos_y":             ent.PosY,
				}).Error; err != nil {
				return fmt.Errorf("update entity %s: %w", ent.ID, err)
			}
		}

		if len(entitiesToInsert) > 0 {
			if err := tx.Create(&entitiesToInsert).Error; err != nil {
				return fmt.Errorf("insert new entities: %w", err)
			}
		}

		// 避免属性重命名时触发 (entity_id, name) 唯一索引冲突（严格检查错误）
		for _, attr := range attrsToUpdate {
			existingAttrs := oldAttrsByEntityID[attr.EntityID]
			for _, oldA := range existingAttrs {
				if oldA.ID != attr.ID && strings.EqualFold(oldA.Name, attr.Name) {
					tempName := fmt.Sprintf("%s__renaming_%s", oldA.Name, id.NewUUIDv7()[:8])
					if err := tx.Model(&model.Attribute{}).Where("id = ?", oldA.ID).Update("name", tempName).Error; err != nil {
						return fmt.Errorf("attribute rename collision resolution: %w", err)
					}
				}
			}
		}

		for _, attr := range attrsToUpdate {
			if err := tx.Model(&model.Attribute{}).
				Where("id = ?", attr.ID).
				Updates(map[string]any{
					"name":           attr.Name,
					"sort_order":     attr.SortOrder,
					"comment":        attr.Comment,
					"db_type":        attr.DBType,
					"code_type":      attr.CodeType,
					"is_primary_key": attr.IsPrimaryKey,
					"is_nullable":    attr.IsNullable,
					"is_unique":      attr.IsUnique,
					"default_value":  attr.DefaultValue,
					"description":    attr.Description,
				}).Error; err != nil {
				return fmt.Errorf("update attribute %s: %w", attr.ID, err)
			}
		}

		if len(attrsToInsert) > 0 {
			if err := tx.Create(&attrsToInsert).Error; err != nil {
				return fmt.Errorf("insert new attributes: %w", err)
			}
		}

		for _, rel := range relsToUpdate {
			if err := tx.Model(&model.Relation{}).
				Where("id = ?", rel.ID).
				Updates(map[string]any{
					"source_entity_id": rel.SourceEntityID,
					"target_entity_id": rel.TargetEntityID,
					"relation_type_id": rel.RelationTypeID,
				}).Error; err != nil {
				return fmt.Errorf("update relation %s: %w", rel.ID, err)
			}
		}

		if len(relsToInsert) > 0 {
			if err := tx.Create(&relsToInsert).Error; err != nil {
				return fmt.Errorf("insert new relations: %w", err)
			}
		}

		// 联动更新所属项目的 updated_at 时间戳
		if err := tx.Model(&model.Project{}).Where("id = ?", projectID).Update("updated_at", time.Now()).Error; err != nil {
			return fmt.Errorf("touch project updated_at: %w", err)
		}

		// 在同一事务快照中读取返回最新状态，保证可重复读一致性
		resDesign, err := getERDesignWithDB(tx, projectID)
		if err != nil {
			return err
		}
		saved = resDesign
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("save er design for project %q: %w", projectID, err)
	}

	return saved, nil
}

func float64PtrEqual(a, b *float64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func strPtrEqual(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func toDomainAttribute(attribute model.Attribute) domain.Attribute {
	return domain.Attribute{
		ID:           attribute.ID,
		Name:         attribute.Name,
		Comment:      attribute.Comment,
		DBType:       attribute.DBType,
		CodeType:     attribute.CodeType,
		IsPrimaryKey: attribute.IsPrimaryKey,
		IsNullable:   attribute.IsNullable,
		IsUnique:     attribute.IsUnique,
		DefaultValue: attribute.DefaultValue,
		Description:  attribute.Description,
	}
}

func boolPtrEqual(a, b *bool) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}
