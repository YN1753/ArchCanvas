package repository

import (
	"context"
	"errors"
	"fmt"

	"archcanvas/internal/domain"
	"archcanvas/internal/model"

	"strings"

	"github.com/google/uuid"
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
		for _, e := range oldEntities {
			if e.PosX != nil && e.PosY != nil {
				oldPosByID[e.ID] = [2]*float64{e.PosX, e.PosY}
				oldPosByName[strings.ToLower(e.Name)] = [2]*float64{e.PosX, e.PosY}
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

		for _, e := range entities {
			entityID := e.ID
			if entityID == "" {
				entityID = uuid.New().String()
			}
			var posX, posY *float64
			if e.Position != nil {
				x := e.Position.X
				y := e.Position.Y
				posX = &x
				posY = &y
			} else if oldPos, ok := oldPosByID[entityID]; ok {
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
				if attrID == "" {
					attrID = uuid.New().String()
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
			if relID == "" {
				relID = uuid.New().String()
			}
			relModel := model.Relation{
				ID:             relID,
				ProjectID:      projectID,
				SourceEntityID: rel.SourceEntityID,
				TargetEntityID: rel.TargetEntityID,
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

