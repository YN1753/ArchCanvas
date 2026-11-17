package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	if err := tx.Where("project_id = ?", projectID).Order("id ASC").Find(&entities).Error; err != nil {
		return nil, fmt.Errorf("find entities for project %q: %w", projectID, err)
	}

	attributes := make([]model.Attribute, 0)
	if len(entities) > 0 {
		entityIDs := make([]string, 0, len(entities))
		for _, entity := range entities {
			entityIDs = append(entityIDs, entity.ID)
		}
		if err := tx.Where("entity_id IN ?", entityIDs).Order("entity_id ASC, sort_order ASC, id ASC").Find(&attributes).Error; err != nil {
			return nil, fmt.Errorf("find attributes for project %q: %w", projectID, err)
		}
	}

	relations := make([]model.Relation, 0)
	if err := tx.Where("project_id = ?", projectID).Order("id ASC").Find(&relations).Error; err != nil {
		return nil, fmt.Errorf("find relations for project %q: %w", projectID, err)
	}

	attributesByEntityID := make(map[string][]domain.Attribute, len(entities))
	for _, attribute := range attributes {
		attributesByEntityID[attribute.EntityID] = append(attributesByEntityID[attribute.EntityID], toDomainAttribute(attribute))
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
			pos = &domain.Position{X: *entity.PosX, Y: *entity.PosY}
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

	incoming := domain.ERDesign{Entities: entities, Relations: relations}
	var saved *domain.ERDesign

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var projectCount int64
		if err := tx.Model(&model.Project{}).Where("id = ?", projectID).Count(&projectCount).Error; err != nil {
			return fmt.Errorf("verify project existence: %w", err)
		}
		if projectCount == 0 {
			return gorm.ErrRecordNotFound
		}

		oldEntities, oldAttributes, oldRelations, taken, err := loadExistingERSnapshot(tx, projectID, incoming)
		if err != nil {
			return err
		}

		plan, err := planERDiff(projectID, oldEntities, oldAttributes, oldRelations, taken, incoming)
		if err != nil {
			return err
		}

		if err := applyERDiffPlan(tx, projectID, plan); err != nil {
			return err
		}

		saved, err = getERDesignWithDB(tx, projectID)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("save er design for project %q: %w", projectID, err)
	}
	return saved, nil
}

func loadExistingERSnapshot(
	tx *gorm.DB,
	projectID string,
	incoming domain.ERDesign,
) ([]model.Entity, []model.Attribute, []model.Relation, erTakenForeignUUIDs, error) {
	var oldEntities []model.Entity
	if err := tx.Where("project_id = ?", projectID).Find(&oldEntities).Error; err != nil {
		return nil, nil, nil, erTakenForeignUUIDs{}, fmt.Errorf("query existing entities: %w", err)
	}

	ownedEntIDs := make(map[string]bool, len(oldEntities))
	oldEntityIDs := make([]string, 0, len(oldEntities))
	for _, e := range oldEntities {
		ownedEntIDs[e.ID] = true
		oldEntityIDs = append(oldEntityIDs, e.ID)
	}

	var oldAttributes []model.Attribute
	if len(oldEntityIDs) > 0 {
		if err := tx.Where("entity_id IN ?", oldEntityIDs).Find(&oldAttributes).Error; err != nil {
			return nil, nil, nil, erTakenForeignUUIDs{}, fmt.Errorf("query existing attributes: %w", err)
		}
	}

	var oldRelations []model.Relation
	if err := tx.Where("project_id = ?", projectID).Find(&oldRelations).Error; err != nil {
		return nil, nil, nil, erTakenForeignUUIDs{}, fmt.Errorf("query existing relations: %w", err)
	}
	ownedRelIDs := make(map[string]bool, len(oldRelations))
	for _, rel := range oldRelations {
		ownedRelIDs[rel.ID] = true
	}

	var foreignEntCandidates, foreignAttrCandidates, foreignRelCandidates []string
	for _, e := range incoming.Entities {
		if id.IsValidUUID(e.ID) && !ownedEntIDs[e.ID] {
			foreignEntCandidates = append(foreignEntCandidates, e.ID)
		}
		for _, a := range e.Attributes {
			if id.IsValidUUID(a.ID) {
				foreignAttrCandidates = append(foreignAttrCandidates, a.ID)
			}
		}
	}
	for _, rel := range incoming.Relations {
		if id.IsValidUUID(rel.ID) && !ownedRelIDs[rel.ID] {
			foreignRelCandidates = append(foreignRelCandidates, rel.ID)
		}
	}

	taken := erTakenForeignUUIDs{
		Entities:   make(map[string]bool),
		Attributes: make(map[string]bool),
		Relations:  make(map[string]bool),
	}

	if len(foreignEntCandidates) > 0 {
		var rows []string
		if err := tx.Model(&model.Entity{}).Where("id IN ? AND project_id <> ?", foreignEntCandidates, projectID).Pluck("id", &rows).Error; err != nil {
			return nil, nil, nil, erTakenForeignUUIDs{}, fmt.Errorf("check taken entity UUIDs: %w", err)
		}
		for _, u := range rows {
			taken.Entities[u] = true
		}
	}

	if len(foreignAttrCandidates) > 0 {
		var existingForeignAttrs []model.Attribute
		if err := tx.Select("id", "entity_id").Where("id IN ?", foreignAttrCandidates).Find(&existingForeignAttrs).Error; err != nil {
			return nil, nil, nil, erTakenForeignUUIDs{}, fmt.Errorf("check taken attribute UUIDs: %w", err)
		}
		for _, a := range existingForeignAttrs {
			if !ownedEntIDs[a.EntityID] {
				taken.Attributes[a.ID] = true
			}
		}
	}

	if len(foreignRelCandidates) > 0 {
		var rows []string
		if err := tx.Model(&model.Relation{}).Where("id IN ? AND project_id <> ?", foreignRelCandidates, projectID).Pluck("id", &rows).Error; err != nil {
			return nil, nil, nil, erTakenForeignUUIDs{}, fmt.Errorf("check taken relation UUIDs: %w", err)
		}
		for _, u := range rows {
			taken.Relations[u] = true
		}
	}

	return oldEntities, oldAttributes, oldRelations, taken, nil
}

func applyERDiffPlan(tx *gorm.DB, projectID string, plan *erDiffPlan) error {
	if len(plan.RelDeleteIDs) > 0 {
		if err := tx.Where("id IN ?", plan.RelDeleteIDs).Delete(&model.Relation{}).Error; err != nil {
			return fmt.Errorf("delete obsolete relations: %w", err)
		}
	}

	if len(plan.AttrDeleteIDs) > 0 {
		if err := tx.Where("id IN ?", plan.AttrDeleteIDs).Delete(&model.Attribute{}).Error; err != nil {
			return fmt.Errorf("delete obsolete attributes: %w", err)
		}
	}

	if len(plan.EntityDeleteIDs) > 0 {
		if err := tx.Where("entity_id IN ?", plan.EntityDeleteIDs).Delete(&model.Attribute{}).Error; err != nil {
			return fmt.Errorf("delete cascade attributes of removed entities: %w", err)
		}
		if err := tx.Where("source_entity_id IN ? OR target_entity_id IN ?", plan.EntityDeleteIDs, plan.EntityDeleteIDs).Delete(&model.Relation{}).Error; err != nil {
			return fmt.Errorf("delete cascade relations of removed entities: %w", err)
		}
		if err := tx.Where("id IN ?", plan.EntityDeleteIDs).Delete(&model.Entity{}).Error; err != nil {
			return fmt.Errorf("delete removed entities: %w", err)
		}
	}

	for _, r := range plan.EntityTempRenames {
		if err := tx.Model(&model.Entity{}).Where("id = ?", r.ID).Update("name", r.TempName).Error; err != nil {
			return fmt.Errorf("entity rename collision resolution: %w", err)
		}
	}

	for _, ent := range plan.EntitiesToUpdate {
		if err := tx.Model(&model.Entity{}).Where("id = ?", ent.ID).Updates(map[string]any{
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

	if len(plan.EntitiesToInsert) > 0 {
		if err := tx.Create(&plan.EntitiesToInsert).Error; err != nil {
			return fmt.Errorf("insert new entities: %w", err)
		}
	}

	for _, r := range plan.AttrTempRenames {
		if err := tx.Model(&model.Attribute{}).Where("id = ?", r.ID).Update("name", r.TempName).Error; err != nil {
			return fmt.Errorf("attribute rename collision resolution: %w", err)
		}
	}

	for _, attr := range plan.AttrsToUpdate {
		if err := tx.Model(&model.Attribute{}).Where("id = ?", attr.ID).Updates(map[string]any{
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

	if len(plan.AttrsToInsert) > 0 {
		if err := tx.Create(&plan.AttrsToInsert).Error; err != nil {
			return fmt.Errorf("insert new attributes: %w", err)
		}
	}

	for _, rel := range plan.RelsToUpdate {
		if err := tx.Model(&model.Relation{}).Where("id = ?", rel.ID).Updates(map[string]any{
			"source_entity_id": rel.SourceEntityID,
			"target_entity_id": rel.TargetEntityID,
			"relation_type_id": rel.RelationTypeID,
		}).Error; err != nil {
			return fmt.Errorf("update relation %s: %w", rel.ID, err)
		}
	}

	if len(plan.RelsToInsert) > 0 {
		if err := tx.Create(&plan.RelsToInsert).Error; err != nil {
			return fmt.Errorf("insert new relations: %w", err)
		}
	}

	if err := tx.Model(&model.Project{}).Where("id = ?", projectID).Update("updated_at", time.Now()).Error; err != nil {
		return fmt.Errorf("touch project updated_at: %w", err)
	}
	return nil
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
