package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"archcanvas/internal/domain"
	"archcanvas/internal/model"

	"strings"

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

	entities := make([]model.Entity, 0)
	if err := r.db.WithContext(ctx).
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

		if err := r.db.WithContext(ctx).
			Where("entity_id IN ?", entityIDs).
			Order("entity_id ASC, id ASC").
			Find(&attributes).Error; err != nil {
			return nil, fmt.Errorf("find attributes for project %q: %w", projectID, err)
		}
	}

	relations := make([]model.Relation, 0)
	if err := r.db.WithContext(ctx).
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
			_ = json.Unmarshal([]byte(entity.Indexes), &indexes)
		}
		if indexes == nil {
			indexes = make([]domain.IndexDefinition, 0)
		}

		design.Entities = append(design.Entities, domain.Entity{
			ID:         entity.ID,
			Name:       entity.Name,
			Comment:    entity.Comment,
			Position:   pos,
			Attributes: entityAttributes,
			Indexes:    indexes,
		})
	}
	for _, relation := range relations {
		design.Relations = append(design.Relations, domain.Relation{
			ID:             relation.ID,
			SourceEntityID: relation.SourceEntityID,
			TargetEntityID: relation.TargetEntityID,
			RelationTypeID: relation.RelationTypeID,
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

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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

		// 2. 映射与 Diff 计算：实体 (Entities)
		entityIDMap := make(map[string]string, len(entities)*3)
		matchedOldEntityIDs := make(map[string]bool, len(oldEntities))

		var entitiesToInsert []model.Entity
		var entitiesToUpdate []model.Entity

		for _, e := range entities {
			var entityID string
			if oldEnt, ok := oldEntitiesByID[e.ID]; ok {
				entityID = oldEnt.ID
			} else if oldEnt, ok := oldEntitiesByName[strings.ToLower(e.Name)]; ok {
				entityID = oldEnt.ID
			} else if id.IsValidUUID(e.ID) {
				entityID = e.ID
			} else {
				entityID = id.NewUUIDv7()
			}

			if e.ID != "" {
				entityIDMap[e.ID] = entityID
				entityIDMap[strings.ToLower(e.ID)] = entityID
			}
			entityIDMap[e.Name] = entityID
			entityIDMap[strings.ToLower(e.Name)] = entityID
			entityIDMap[entityID] = entityID

			matchedOldEntityIDs[entityID] = true

			// 解析坐标（优先使用传入坐标，缺失则沿用旧坐标）
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
			} else if oldPos, ok := oldPosByName[strings.ToLower(e.Name)]; ok {
				posX = oldPos[0]
				posY = oldPos[1]
			}

			indexesJSON := ""
			if len(e.Indexes) > 0 {
				if bytes, err := json.Marshal(e.Indexes); err == nil {
					indexesJSON = string(bytes)
				}
			}

			entModel := model.Entity{
				ID:        entityID,
				ProjectID: projectID,
				Name:      e.Name,
				Comment:   e.Comment,
				Indexes:   indexesJSON,
				PosX:      posX,
				PosY:      posY,
			}

			if oldEnt, ok := oldEntitiesByID[entityID]; ok {
				if oldEnt.Name != entModel.Name ||
					oldEnt.Comment != entModel.Comment ||
					oldEnt.Indexes != entModel.Indexes ||
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

		// 3. Diff 计算：属性 (Attributes)
		var attrsToInsert []model.Attribute
		var attrsToUpdate []model.Attribute
		var attrsToDeleteIDs []string

		for _, e := range entities {
			entityID := entityIDMap[e.ID]
			if entityID == "" {
				entityID = entityIDMap[e.Name]
			}
			if entityID == "" {
				entityID = entityIDMap[strings.ToLower(e.Name)]
			}

			existingAttrs := oldAttrsByEntityID[entityID]
			existingAttrsByID := make(map[string]model.Attribute, len(existingAttrs))
			existingAttrsByName := make(map[string]model.Attribute, len(existingAttrs))
			for _, a := range existingAttrs {
				existingAttrsByID[a.ID] = a
				existingAttrsByName[strings.ToLower(a.Name)] = a
			}

			matchedAttrIDs := make(map[string]bool, len(e.Attributes))
			for _, attr := range e.Attributes {
				var attrID string
				if oldA, ok := existingAttrsByID[attr.ID]; ok {
					attrID = oldA.ID
				} else if oldA, ok := existingAttrsByName[strings.ToLower(attr.Name)]; ok {
					attrID = oldA.ID
				} else if id.IsValidUUID(attr.ID) {
					attrID = attr.ID
				} else {
					attrID = id.NewUUIDv7()
				}

				matchedAttrIDs[attrID] = true

				attrModel := model.Attribute{
					ID:           attrID,
					EntityID:     entityID,
					Name:         attr.Name,
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
		var relsToInsert []model.Relation
		var relsToUpdate []model.Relation

		for _, rel := range relations {
			sourceID := rel.SourceEntityID
			if mapped, ok := entityIDMap[sourceID]; ok {
				sourceID = mapped
			} else if mapped, ok := entityIDMap[strings.ToLower(sourceID)]; ok {
				sourceID = mapped
			}

			targetID := rel.TargetEntityID
			if mapped, ok := entityIDMap[targetID]; ok {
				targetID = mapped
			} else if mapped, ok := entityIDMap[strings.ToLower(targetID)]; ok {
				targetID = mapped
			}

			var relID string
			if _, ok := oldRelationsByID[rel.ID]; ok {
				relID = rel.ID
			} else {
				// 尝试通过 source + target + type 匹配历史关系，保持 ID 稳定
				for _, oldR := range oldRelations {
					if !matchedOldRelIDs[oldR.ID] &&
						oldR.SourceEntityID == sourceID &&
						oldR.TargetEntityID == targetID &&
						oldR.RelationTypeID == rel.RelationTypeID {
						relID = oldR.ID
						break
					}
				}
				if relID == "" {
					// 宽松匹配：source + target
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
					if id.IsValidUUID(rel.ID) {
						relID = rel.ID
					} else {
						relID = id.NewUUIDv7()
					}
				}
			}

			matchedOldRelIDs[relID] = true

			relModel := model.Relation{
				ID:             relID,
				ProjectID:      projectID,
				SourceEntityID: sourceID,
				TargetEntityID: targetID,
				RelationTypeID: rel.RelationTypeID,
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
		// 5.1 删除废弃的关联关系
		if len(relsToDeleteIDs) > 0 {
			if err := tx.Where("id IN ?", relsToDeleteIDs).Delete(&model.Relation{}).Error; err != nil {
				return fmt.Errorf("delete obsolete relations: %w", err)
			}
		}

		// 5.2 删除废弃的属性
		if len(attrsToDeleteIDs) > 0 {
			if err := tx.Where("id IN ?", attrsToDeleteIDs).Delete(&model.Attribute{}).Error; err != nil {
				return fmt.Errorf("delete obsolete attributes: %w", err)
			}
		}

		// 5.3 删除被移除的实体（及其孤立属性和关联）
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

		// 5.4 避免重命名实体时触发 SQLite (project_id, name) 唯一索引冲突
		for _, ent := range entitiesToUpdate {
			if oldEnt, ok := oldEntitiesByID[ent.ID]; ok && oldEnt.Name != ent.Name {
				if conflicting, exists := oldEntitiesByName[strings.ToLower(ent.Name)]; exists && conflicting.ID != ent.ID {
					tempName := fmt.Sprintf("%s__renaming_%s", conflicting.Name, id.NewUUIDv7()[:8])
					if err := tx.Model(&model.Entity{}).Where("id = ?", conflicting.ID).Update("name", tempName).Error; err != nil {
						return fmt.Errorf("rename collision resolution: %w", err)
					}
				}
			}
		}

		// 5.5 更新已有实体
		for _, ent := range entitiesToUpdate {
			if err := tx.Model(&model.Entity{}).
				Where("id = ?", ent.ID).
				Updates(map[string]interface{}{
					"name":    ent.Name,
					"comment": ent.Comment,
					"indexes": ent.Indexes,
					"pos_x":   ent.PosX,
					"pos_y":   ent.PosY,
				}).Error; err != nil {
				return fmt.Errorf("update entity %s: %w", ent.ID, err)
			}
		}

		// 5.6 批量插入新实体
		if len(entitiesToInsert) > 0 {
			if err := tx.Create(&entitiesToInsert).Error; err != nil {
				return fmt.Errorf("insert new entities: %w", err)
			}
		}

		// 5.7 避免属性重命名时触发 (entity_id, name) 唯一索引冲突
		for _, attr := range attrsToUpdate {
			existingAttrs := oldAttrsByEntityID[attr.EntityID]
			for _, oldA := range existingAttrs {
				if oldA.ID != attr.ID && strings.EqualFold(oldA.Name, attr.Name) {
					tempName := fmt.Sprintf("%s__renaming_%s", oldA.Name, id.NewUUIDv7()[:8])
					_ = tx.Model(&model.Attribute{}).Where("id = ?", oldA.ID).Update("name", tempName).Error
				}
			}
		}

		// 5.8 更新已有属性
		for _, attr := range attrsToUpdate {
			if err := tx.Model(&model.Attribute{}).
				Where("id = ?", attr.ID).
				Updates(map[string]interface{}{
					"name":           attr.Name,
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

		// 5.9 批量插入新属性
		if len(attrsToInsert) > 0 {
			if err := tx.Create(&attrsToInsert).Error; err != nil {
				return fmt.Errorf("insert new attributes: %w", err)
			}
		}

		// 5.10 更新已有关系
		for _, rel := range relsToUpdate {
			if err := tx.Model(&model.Relation{}).
				Where("id = ?", rel.ID).
				Updates(map[string]interface{}{
					"source_entity_id": rel.SourceEntityID,
					"target_entity_id": rel.TargetEntityID,
					"relation_type_id": rel.RelationTypeID,
				}).Error; err != nil {
				return fmt.Errorf("update relation %s: %w", rel.ID, err)
			}
		}

		// 5.11 批量插入新关系
		if len(relsToInsert) > 0 {
			if err := tx.Create(&relsToInsert).Error; err != nil {
				return fmt.Errorf("insert new relations: %w", err)
			}
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("save er design for project %q: %w", projectID, err)
	}

	return r.GetByProjectID(ctx, projectID)
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

