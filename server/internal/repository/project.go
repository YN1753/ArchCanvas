package repository

import (
	"archcanvas/internal/domain"
	"archcanvas/internal/model"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"archcanvas/pkg/id"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	// 显式裁剪大字段 conceptual_design，避免列表接口传输和反序列化冗余 JSON
	if err := r.db.WithContext(ctx).
		Select("id", "name", "description", "created_at", "updated_at").
		Order("created_at DESC").
		Find(&projects).Error; err != nil {
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
	now := time.Now()
	project := &model.Project{
		ID:          id.NewUUIDv7(),
		Name:        name,
		Description: description,
		CreatedAt:   now,
		UpdatedAt:   now,
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

		res := tx.Where("id = ?", id).Delete(&model.Project{})
		if res.Error != nil {
			return fmt.Errorf("delete project: %w", res.Error)
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}

		return nil
	})
}

func (r *ProjectRepository) Update(ctx context.Context, id, name, description string) (*model.Project, error) {
	return r.UpdateOptionalDesc(ctx, id, name, &description)
}

func (r *ProjectRepository) UpdateOptionalDesc(ctx context.Context, id, name string, description *string) (*model.Project, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("project repository database is nil")
	}
	if id == "" {
		return nil, errors.New("project id is required")
	}
	var project model.Project
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&project).Error; err != nil {
		return nil, err
	}

	now := time.Now()
	updates := map[string]any{
		"name":       name,
		"updated_at": now,
	}
	project.Name = name
	project.UpdatedAt = now
	if description != nil {
		updates["description"] = *description
		project.Description = *description
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
	res := r.db.WithContext(ctx).
		Model(&model.Project{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"conceptual_design": conceptualDesignJSON,
			"updated_at":        time.Now(),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *ProjectRepository) GetAIContext(ctx context.Context, projectID string) (*domain.AIContextContent, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("project repository database is nil")
	}
	if projectID == "" {
		return nil, errors.New("project id is required")
	}
	var rec model.AIContext
	if err := r.db.WithContext(ctx).Where("project_id = ?", projectID).First(&rec).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if len(rec.Content) == 0 {
		return nil, nil
	}
	var content domain.AIContextContent
	if err := json.Unmarshal(rec.Content, &content); err != nil {
		return nil, err
	}
	return &content, nil
}

func (r *ProjectRepository) UpsertAIContext(ctx context.Context, projectID string, content domain.AIContextContent) error {
	if r == nil || r.db == nil {
		return errors.New("project repository database is nil")
	}
	if projectID == "" {
		return errors.New("project id is required")
	}
	raw, err := json.Marshal(content)
	if err != nil {
		return err
	}
	now := time.Now()
	rec := &model.AIContext{
		ID:        id.NewUUIDv7(),
		ProjectID: projectID,
		Content:   raw,
		Version:   "v1",
		CreatedAt: now,
		UpdatedAt: now,
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "project_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"content":    raw,
				"updated_at": now,
			}),
		}).
		Create(rec).Error
}

// MergeAIContext 在数据库事务内原子读取、合并并写回 AIContext，避免并发覆盖丢失约束。
func (r *ProjectRepository) MergeAIContext(
	ctx context.Context,
	projectID string,
	mergeFn func(existing *domain.AIContextContent) domain.AIContextContent,
) error {
	if r == nil || r.db == nil || projectID == "" {
		return nil
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rec model.AIContext
		var existing *domain.AIContextContent
		err := tx.Where("project_id = ?", projectID).First(&rec).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil && len(rec.Content) > 0 {
			var parsed domain.AIContextContent
			if uErr := json.Unmarshal(rec.Content, &parsed); uErr == nil {
				existing = &parsed
			}
		}

		merged := mergeFn(existing)
		raw, err := json.Marshal(merged)
		if err != nil {
			return err
		}
		now := time.Now()
		upsertRec := &model.AIContext{
			ID:        id.NewUUIDv7(),
			ProjectID: projectID,
			Content:   raw,
			Version:   "v1",
			CreatedAt: now,
			UpdatedAt: now,
		}
		return tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "project_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"content":    raw,
				"updated_at": now,
			}),
		}).Create(upsertRec).Error
	})
}

func (r *ProjectRepository) DeleteAIContext(ctx context.Context, projectID string) error {
	if r == nil || r.db == nil || projectID == "" {
		return nil
	}
	return r.db.WithContext(ctx).Where("project_id = ?", projectID).Delete(&model.AIContext{}).Error
}
