package repository

import (
	"archcanvas/internal/model"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
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
		ID:          uuid.New().String(),
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
