package repository

import (
	"context"
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

		design.Entities = append(design.Entities, domain.Entity{
			ID:         entity.ID,
			Name:       entity.Name,
			Position:   pos,
			Attributes: entityAttributes,
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
		var oldEntities []model.Entity
		if err := tx.Where("project_id = ?", projectID).Find(&oldEntities).Error; err != nil {
			return err
		}
		oldPosByID := make(map[string][2]*float64, len(oldEntities))
		oldPosByName := make(map[string][2]*float64, len(oldEntities))
		oldUUIDByName := make(map[string]string, len(oldEntities))
		for _, e := range oldEntities {
			if e.PosX != nil && e.PosY != nil {
				oldPosByID[e.ID] = [2]*float64{e.PosX, e.PosY}
				oldPosByName[strings.ToLower(e.Name)] = [2]*float64{e.PosX, e.PosY}
			}
			if id.IsValidUUID(e.ID) {
				oldUUIDByName[strings.ToLower(e.Name)] = e.ID
			}
		}

		if len(oldEntities) > 0 {
			oldEntityIDs := make([]string, 0, len(oldEntities))
			for _, e := range oldEntities {
				oldEntityIDs = append(oldEntityIDs, e.ID)
			}
			if err := tx.Where("entity_id IN ?", oldEntityIDs).Delete(&model.Attribute{}).Error; err != nil {
				return err
			}
		}

		if err := tx.Where("project_id = ?", projectID).Delete(&model.Entity{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", projectID).Delete(&model.Relation{}).Error; err != nil {
			return err
		}

		// entityIDMap 映射：oldID / lower(name) -> newUUIDv7
		entityIDMap := make(map[string]string, len(entities)*3)

		for _, e := range entities {
			entityID := e.ID
			if id.IsValidUUID(entityID) {
				// 已是标准有效 UUID，继续保持
			} else if existingUUID, ok := oldUUIDByName[strings.ToLower(e.Name)]; ok && id.IsValidUUID(existingUUID) {
				// 按表名匹配到了历史的有效 UUIDv7，维持该 ID 稳定
				entityID = existingUUID
			} else {
				// 英文名 ID、前端本地临时 ID 或空 ID，全部统一定向分配为 RFC 9562 UUIDv7
				entityID = id.NewUUIDv7()
			}

			// 记录映射以供关系重连
			if e.ID != "" {
				entityIDMap[e.ID] = entityID
			}
			entityIDMap[strings.ToLower(e.Name)] = entityID
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
			} else if oldPos, ok := oldPosByName[strings.ToLower(e.Name)]; ok {
				posX = oldPos[0]
				posY = oldPos[1]
			}

			entityModel := model.Entity{
				ID:        entityID,
				ProjectID: projectID,
				Name:      e.Name,
				PosX:      posX,
				PosY:      posY,
			}
			if err := tx.Create(&entityModel).Error; err != nil {
				return err
			}

			for _, attr := range e.Attributes {
				attrID := attr.ID
				if !id.IsValidUUID(attrID) {
					attrID = id.NewUUIDv7()
				}
				attrModel := model.Attribute{
					ID:           attrID,
					EntityID:     entityID,
					Name:         attr.Name,
					DBType:       attr.DBType,
					CodeType:     attr.CodeType,
					IsPrimaryKey: attr.IsPrimaryKey,
					IsNullable:   attr.IsNullable,
					IsUnique:     attr.IsUnique,
					DefaultValue: attr.DefaultValue,
					Description:  attr.Description,
				}
				if err := tx.Create(&attrModel).Error; err != nil {
					return err
				}
			}
		}

		for _, rel := range relations {
			relID := rel.ID
			if !id.IsValidUUID(relID) {
				relID = id.NewUUIDv7()
			}

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

			relModel := model.Relation{
				ID:             relID,
				ProjectID:      projectID,
				SourceEntityID: sourceID,
				TargetEntityID: targetID,
				RelationTypeID: rel.RelationTypeID,
			}
			if err := tx.Create(&relModel).Error; err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("save er design for project %q: %w", projectID, err)
	}

	return r.GetByProjectID(ctx, projectID)
}

func toDomainAttribute(attribute model.Attribute) domain.Attribute {
	return domain.Attribute{
		ID:           attribute.ID,
		Name:         attribute.Name,
		DBType:       attribute.DBType,
		CodeType:     attribute.CodeType,
		IsPrimaryKey: attribute.IsPrimaryKey,
		IsNullable:   attribute.IsNullable,
		IsUnique:     attribute.IsUnique,
		DefaultValue: attribute.DefaultValue,
		Description:  attribute.Description,
	}
}

