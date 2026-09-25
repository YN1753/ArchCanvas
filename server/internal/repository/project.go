package repository

import (
	"archcanvas/internal/model"
	"context"
	"errors"
	"fmt"
	"time"

	"archcanvas/pkg/id"

	"gorm.io/gorm"
)

type ProjectRepository struct {
	db *gorm.DB
}

func NewProjectRepository(db *gorm.DB) *ProjectRepository {
	return &ProjectRepository{db: db}
}

func (r *ProjectRepository) List(ctx context.Context) ([]model.Project, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("project repository database is nil")
	}
	var projects []model.Project
	if err := r.db.WithContext(ctx).Order("created_at DESC").Find(&projects).Error; err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	return projects, nil
}

func (r *ProjectRepository) GetByID(ctx context.Context, id string) (*model.Project, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("project repository database is nil")
	}
	var project model.Project
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&project).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *ProjectRepository) Create(ctx context.Context, name, description string) (*model.Project, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("project repository database is nil")
	}
	project := &model.Project{
		ID:          id.NewUUIDv7(),
		Name:        name,
		Description: description,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if err := r.db.WithContext(ctx).Create(project).Error; err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	return project, nil
}

func (r *ProjectRepository) Delete(ctx context.Context, id string) error {
	if r == nil || r.db == nil {
		return errors.New("project repository database is nil")
	}
	if id == "" {
		return errors.New("project id is required")
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var entityIDs []string
		if err := tx.Model(&model.Entity{}).Where("project_id = ?", id).Pluck("id", &entityIDs).Error; err != nil {
			return fmt.Errorf("find entity IDs: %w", err)
		}

		if len(entityIDs) > 0 {
			if err := tx.Where("entity_id IN ?", entityIDs).Delete(&model.Attribute{}).Error; err != nil {
				return fmt.Errorf("delete attributes: %w", err)
			}
		}

		if err := tx.Where("project_id = ?", id).Delete(&model.Entity{}).Error; err != nil {
			return fmt.Errorf("delete entities: %w", err)
		}

		if err := tx.Where("project_id = ?", id).Delete(&model.Relation{}).Error; err != nil {
			return fmt.Errorf("delete relations: %w", err)
		}

		var convIDs []string
		if err := tx.Model(&model.Conversation{}).Where("project_id = ?", id).Pluck("id", &convIDs).Error; err != nil {
			return fmt.Errorf("find conversation IDs: %w", err)
		}
		if len(convIDs) > 0 {
			if err := tx.Where("conversation_id IN ?", convIDs).Delete(&model.Message{}).Error; err != nil {
				return fmt.Errorf("delete messages: %w", err)
			}
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.Conversation{}).Error; err != nil {
			return fmt.Errorf("delete conversations: %w", err)
		}

		if err := tx.Where("project_id = ?", id).Delete(&model.AIContext{}).Error; err != nil {
			return fmt.Errorf("delete ai_context: %w", err)
		}

		if err := tx.Where("id = ?", id).Delete(&model.Project{}).Error; err != nil {
			return fmt.Errorf("delete project: %w", err)
		}

		return nil
	})
}

func (r *ProjectRepository) Update(ctx context.Context, id, name, description string) (*model.Project, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("project repository database is nil")
	}
	if id == "" {
		return nil, errors.New("project id is required")
	}
	var project model.Project
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&project).Error; err != nil {
		return nil, fmt.Errorf("find project: %w", err)
	}

	updates := map[string]any{
		"name":       name,
		"updated_at": time.Now(),
	}
	if description != "" {
		updates["description"] = description
	}

	if err := r.db.WithContext(ctx).Model(&project).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("update project: %w", err)
	}
	return &project, nil
}

func (r *ProjectRepository) SaveConceptualDesign(ctx context.Context, id string, conceptualDesignJSON string) error {
	if r == nil || r.db == nil {
		return errors.New("project repository database is nil")
	}
	if id == "" {
		return errors.New("project id is required")
	}
	return r.db.WithContext(ctx).
		Model(&model.Project{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"conceptual_design": conceptualDesignJSON,
			"updated_at":        time.Now(),
		}).Error
}
