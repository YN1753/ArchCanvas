package service

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/domain"
	"archcanvas/internal/repository"
	"archcanvas/request"
	"context"
	"errors"
)

type ProjectDetail struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	ERDesign    *domain.ERDesign `json:"er_design,omitempty"`
	CreatedAt   string           `json:"created_at"`
	UpdatedAt   string           `json:"updated_at"`
}

type SaveERDesignResult struct {
	Design   *domain.ERDesign `json:"design"`
	Warnings []string         `json:"warnings"`
}

type ProjectService struct {
	ProjectRepo  *repository.ProjectRepository
	ERDesignRepo *repository.ERDesignRepository
	ModelManager *agent.ModelManager
}

func NewProjectService(
	projectRepo *repository.ProjectRepository,
	erDesignRepo *repository.ERDesignRepository,
	modelManager *agent.ModelManager,
) *ProjectService {
	return &ProjectService{
		ProjectRepo:  projectRepo,
		ERDesignRepo: erDesignRepo,
		ModelManager: modelManager,
	}
}

func (s *ProjectService) ListProjects(ctx context.Context) ([]ProjectDetail, error) {
	projects, err := s.ProjectRepo.List(ctx)
	if err != nil {
		return nil, err
	}
	res := make([]ProjectDetail, 0, len(projects))
	for _, p := range projects {
		res = append(res, ProjectDetail{
			ID:          p.ID,
			Name:        p.Name,
			Description: p.Description,
			CreatedAt:   p.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt:   p.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	return res, nil
}

func (s *ProjectService) CreateProject(ctx context.Context, name, description string) (*ProjectDetail, error) {
	p, err := s.ProjectRepo.Create(ctx, name, description)
	if err != nil {
		return nil, err
	}
	return &ProjectDetail{
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		ERDesign:    &domain.ERDesign{Entities: []domain.Entity{}, Relations: []domain.Relation{}},
		CreatedAt:   p.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   p.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}, nil
}

func (s *ProjectService) GetProject(ctx context.Context, id string) (*ProjectDetail, error) {
	p, err := s.ProjectRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	design, _ := s.ERDesignRepo.GetByProjectID(ctx, id)
	return &ProjectDetail{
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		ERDesign:    design,
		CreatedAt:   p.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   p.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}, nil
}

func (s *ProjectService) GetERDesign(ctx context.Context, projectID string) (*domain.ERDesign, error) {
	return s.ERDesignRepo.GetByProjectID(ctx, projectID)
}

func (s *ProjectService) SaveERDesign(ctx context.Context, projectID string, design domain.ERDesign) (*SaveERDesignResult, error) {
	saved, err := s.ERDesignRepo.SaveByProjectID(ctx, projectID, design.Entities, design.Relations)
	if err != nil {
		return nil, err
	}
	return &SaveERDesignResult{
		Design:   saved,
		Warnings: []string{},
	}, nil
}

func (s *ProjectService) GetAvailableModels(ctx context.Context, req request.GetModelsReq) (agent.AvailableModels, error) {
	if s.ModelManager == nil {
		return agent.AvailableModels{}, errors.New("model manager is not initialized")
	}
	return s.ModelManager.GetAvailableModels(ctx, req)
}

func (s *ProjectService) SaveModelConfig(ctx context.Context, req request.SaveModelReq) (agent.AvailableModels, error) {
	if s.ModelManager == nil {
		return agent.AvailableModels{}, errors.New("model manager is not initialized")
	}
	return s.ModelManager.SaveAndSwitchModel(ctx, req)
}


