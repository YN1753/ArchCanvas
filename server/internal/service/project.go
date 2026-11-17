package service

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/internal/model"
	"archcanvas/internal/repository"
	"archcanvas/internal/validator"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type ProjectDetail struct {
	ID               string                   `json:"id"`
	Name             string                   `json:"name"`
	Description      string                   `json:"description"`
	ConceptualDesign *domain.ConceptualDesign `json:"conceptual_design,omitempty"`
	ERDesign         *domain.ERDesign         `json:"er_design,omitempty"`
	CreatedAt        string                   `json:"created_at"`
	UpdatedAt        string                   `json:"updated_at"`
}

type MessageItem struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	Role           string    `json:"role"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type SaveERDesignResult struct {
	Design   *domain.ERDesign `json:"design"`
	Warnings []string         `json:"warnings"`
}

type ProjectService struct {
	ProjectRepo  *repository.ProjectRepository
	ERDesignRepo *repository.ERDesignRepository
	MessageRepo  *repository.MessageRepository
	ModelManager *agent.ModelManager
}

func NewProjectService(
	projectRepo *repository.ProjectRepository,
	erDesignRepo *repository.ERDesignRepository,
	messageRepo *repository.MessageRepository,
	modelManager *agent.ModelManager,
) *ProjectService {
	return &ProjectService{
		ProjectRepo:  projectRepo,
		ERDesignRepo: erDesignRepo,
		MessageRepo:  messageRepo,
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
			CreatedAt:   p.CreatedAt.Format(time.RFC3339),
			UpdatedAt:   p.UpdatedAt.Format(time.RFC3339),
		})
	}
	return res, nil
}

func (s *ProjectService) CreateProject(ctx context.Context, name, description string) (*ProjectDetail, error) {
	cleanName, err := validator.ValidateRequiredText("项目名称", name, 128)
	if err != nil {
		return nil, err
	}
	cleanDesc := strings.TrimSpace(description)
	if err := validator.ValidateSingleLine("项目描述", strings.ReplaceAll(cleanDesc, "\n", " "), 2000); err != nil {
		return nil, err
	}

	p, err := s.ProjectRepo.Create(ctx, cleanName, cleanDesc)
	if err != nil {
		return nil, err
	}
	return &ProjectDetail{
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		ERDesign:    &domain.ERDesign{Entities: []domain.Entity{}, Relations: []domain.Relation{}},
		CreatedAt:   p.CreatedAt.Format(time.RFC3339),
		UpdatedAt:   p.UpdatedAt.Format(time.RFC3339),
	}, nil
}

func (s *ProjectService) DeleteProject(ctx context.Context, id string) error {
	cleanID, err := validator.ValidateRequiredText("project_id", id, 64)
	if err != nil {
		return err
	}
	return s.ProjectRepo.Delete(ctx, cleanID)
}

func (s *ProjectService) UpdateProject(ctx context.Context, id, name string, description *string) (*ProjectDetail, error) {
	cleanID, err := validator.ValidateRequiredText("project_id", id, 64)
	if err != nil {
		return nil, err
	}
	cleanName, err := validator.ValidateRequiredText("项目名称", name, 128)
	if err != nil {
		return nil, err
	}
	var descPtr *string
	if description != nil {
		trimmedDesc := strings.TrimSpace(*description)
		if err := validator.ValidateSingleLine("项目描述", strings.ReplaceAll(trimmedDesc, "\n", " "), 2000); err != nil {
			return nil, err
		}
		descPtr = &trimmedDesc
	}

	if _, err := s.ProjectRepo.UpdateOptionalDesc(ctx, cleanID, cleanName, descPtr); err != nil {
		return nil, err
	}
	return s.GetProject(ctx, cleanID)
}

func (s *ProjectService) GetProject(ctx context.Context, id string) (*ProjectDetail, error) {
	cleanID, err := validator.ValidateRequiredText("id", id, 64)
	if err != nil {
		return nil, err
	}
	p, err := s.ProjectRepo.GetByID(ctx, cleanID)
	if err != nil {
		return nil, err
	}

	// [P0-DATA-04] 严格传递数据库读取错误，严禁将瞬时 DB 故障吞掉并返回空画布导致前端自动保存清空用户数据
	var design *domain.ERDesign
	if s.ERDesignRepo != nil {
		d, err := s.ERDesignRepo.GetByProjectID(ctx, cleanID)
		if err != nil {
			return nil, err
		}
		design = d
	}

	var conceptualDesign *domain.ConceptualDesign
	if strings.TrimSpace(p.ConceptualDesign) != "" {
		var cd domain.ConceptualDesign
		if err := json.Unmarshal([]byte(p.ConceptualDesign), &cd); err != nil {
			return nil, fmt.Errorf("unmarshal conceptual design for project %q: %w", cleanID, err)
		}
		conceptualDesign = &cd
	}

	return &ProjectDetail{
		ID:               p.ID,
		Name:             p.Name,
		Description:      p.Description,
		ConceptualDesign: conceptualDesign,
		ERDesign:         design,
		CreatedAt:        p.CreatedAt.Format(time.RFC3339),
		UpdatedAt:        p.UpdatedAt.Format(time.RFC3339),
	}, nil
}

func (s *ProjectService) GetConceptualDesign(ctx context.Context, projectID string) (*domain.ConceptualDesign, error) {
	cleanID, err := validator.ValidateRequiredText("id", projectID, 64)
	if err != nil {
		return nil, err
	}
	p, err := s.ProjectRepo.GetByID(ctx, cleanID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(p.ConceptualDesign) == "" {
		return nil, nil
	}
	var cd domain.ConceptualDesign
	if err := json.Unmarshal([]byte(p.ConceptualDesign), &cd); err != nil {
		return nil, fmt.Errorf("unmarshal conceptual design: %w", err)
	}
	return &cd, nil
}

func (s *ProjectService) SaveConceptualDesign(ctx context.Context, projectID string, design domain.ConceptualDesign) error {
	cleanID, err := validator.ValidateRequiredText("project_id", projectID, 64)
	if err != nil {
		return err
	}
	bytes, err := json.Marshal(design)
	if err != nil {
		return fmt.Errorf("marshal conceptual design: %w", err)
	}
	return s.ProjectRepo.SaveConceptualDesign(ctx, cleanID, string(bytes))
}

func (s *ProjectService) GetERDesign(ctx context.Context, projectID string) (*domain.ERDesign, error) {
	cleanID, err := validator.ValidateRequiredText("id", projectID, 64)
	if err != nil {
		return nil, err
	}
	return s.ERDesignRepo.GetByProjectID(ctx, cleanID)
}

func (s *ProjectService) SaveERDesign(ctx context.Context, projectID string, design domain.ERDesign) (*SaveERDesignResult, error) {
	cleanID, err := validator.ValidateRequiredText("project_id", projectID, 64)
	if err != nil {
		return nil, err
	}
	saved, err := s.ERDesignRepo.SaveByProjectID(ctx, cleanID, design.Entities, design.Relations)
	if err != nil {
		return nil, err
	}
	return &SaveERDesignResult{
		Design:   saved,
		Warnings: []string{},
	}, nil
}

func (s *ProjectService) GetAvailableModels(ctx context.Context, req dto.GetModelsReq) (agent.AvailableModels, error) {
	if s.ModelManager == nil {
		return agent.AvailableModels{}, errors.New("model manager is not initialized")
	}
	return s.ModelManager.GetAvailableModels(ctx, req)
}

func (s *ProjectService) SaveModelConfig(ctx context.Context, req dto.SaveModelReq) (agent.AvailableModels, error) {
	if s.ModelManager == nil {
		return agent.AvailableModels{}, errors.New("model manager is not initialized")
	}
	return s.ModelManager.SaveAndSwitchModel(ctx, req)
}

func (s *ProjectService) ListProjectMessages(ctx context.Context, projectID string) ([]model.Message, error) {
	if s.MessageRepo == nil {
		return []model.Message{}, nil
	}
	return s.MessageRepo.ListMessagesByProject(ctx, projectID)
}

func (s *ProjectService) ListProjectMessageDTOs(ctx context.Context, projectID string) ([]MessageItem, error) {
	msgs, err := s.ListProjectMessages(ctx, projectID)
	if err != nil {
		return nil, err
	}
	out := make([]MessageItem, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, MessageItem{
			ID:             m.ID,
			ConversationID: m.ConversationID,
			Role:           m.Role,
			Content:        m.Content,
			CreatedAt:      m.CreatedAt,
			UpdatedAt:      m.UpdatedAt,
		})
	}
	return out, nil
}

func (s *ProjectService) ListRecentProjectMessages(ctx context.Context, projectID string, limit int) ([]model.Message, error) {
	if s.MessageRepo == nil {
		return []model.Message{}, nil
	}
	return s.MessageRepo.ListRecentMessagesByProject(ctx, projectID, limit)
}

func (s *ProjectService) ClearProjectMessages(ctx context.Context, projectID string) error {
	cleanID, err := validator.ValidateRequiredText("project_id", projectID, 64)
	if err != nil {
		return err
	}
	if s.ProjectRepo != nil {
		if err := s.ProjectRepo.DeleteAIContext(ctx, cleanID); err != nil {
			return fmt.Errorf("delete ai context: %w", err)
		}
	}
	if s.MessageRepo == nil {
		return nil
	}
	return s.MessageRepo.ClearMessagesByProject(ctx, cleanID)
}

func (s *ProjectService) GetAIContext(ctx context.Context, projectID string) (*domain.AIContextContent, error) {
	if s.ProjectRepo == nil || projectID == "" {
		return nil, nil
	}
	return s.ProjectRepo.GetAIContext(ctx, projectID)
}

func (s *ProjectService) MergeAndSaveAIContext(
	ctx context.Context,
	projectID string,
	goal string,
	decisions []string,
	constraints []string,
) error {
	if s.ProjectRepo == nil || projectID == "" {
		return nil
	}
	return s.ProjectRepo.MergeAIContext(ctx, projectID, func(existing *domain.AIContextContent) domain.AIContextContent {
		var merged domain.AIContextContent
		if existing != nil {
			merged = *existing
		}
		if goal != "" {
			merged.Goal = goal
		}
		merged.Decisions = mergeUniqueStrings(merged.Decisions, decisions, 20)
		merged.Constraints = mergeUniqueStrings(merged.Constraints, constraints, 20)
		return merged
	})
}

func mergeUniqueStrings(base, incoming []string, maxItems int) []string {
	seen := make(map[string]struct{}, len(base)+len(incoming))
	out := make([]string, 0, len(base)+len(incoming))
	for _, item := range append(base, incoming...) {
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	if maxItems > 0 && len(out) > maxItems {
		out = out[len(out)-maxItems:]
	}
	return out
}
