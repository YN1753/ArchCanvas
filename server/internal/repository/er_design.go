package repository

import (
	"context"
	"errors"
	"fmt"

	"archcanvas/internal/domain"
	"archcanvas/internal/model"

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

		design.Entities = append(design.Entities, domain.Entity{
			ID:         entity.ID,
			Name:       entity.Name,
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
