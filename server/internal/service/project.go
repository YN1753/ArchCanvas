package service

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/config"
	"archcanvas/internal/domain"
	"archcanvas/internal/model"
	"archcanvas/internal/repository"
	"archcanvas/internal/validator"
	"archcanvas/pkg/reqctx"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type ProjectDetail struct {
	ID               string                   `json:"id"`
	Name             string                   `json:"name"`
	Description      string                   `json:"description"`
	IsTemplate       bool                     `json:"is_template,omitempty"`
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
	ShowcaseCfg  config.ShowcaseConfig
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
	var (
		projects []model.Project
		err      error
	)
	if s.isShowcaseActive(ctx) {
		projects, err = s.ProjectRepo.ListForShowcaseVisitor(ctx, reqctx.VisitorIDFromContext(ctx))
	} else {
		projects, err = s.ProjectRepo.List(ctx)
	}
	if err != nil {
		return nil, err
	}
	res := make([]ProjectDetail, 0, len(projects))
	for _, p := range projects {
		res = append(res, ProjectDetail{
			ID:          p.ID,
			Name:        p.Name,
			Description: p.Description,
			IsTemplate:  p.IsTemplate,
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

	var visitorID string
	if s.isShowcaseActive(ctx) {
		visitorID = reqctx.VisitorIDFromContext(ctx)
		maxLimit := s.ShowcaseCfg.MaxProjectsPerVisitor
		if maxLimit <= 0 {
			maxLimit = 10
		}
		cnt, err := s.ProjectRepo.CountByVisitorID(ctx, visitorID)
		if err != nil {
			return nil, err
		}
		if int(cnt) >= maxLimit {
			return nil, validator.NewForbiddenError("当前访客沙盒草稿数已达上限（最多 %d 个），请先清理不再使用的草稿", maxLimit)
		}
	}

	p, err := s.ProjectRepo.CreateWithVisitor(ctx, cleanName, cleanDesc, visitorID)
	if err != nil {
		return nil, err
	}
	return &ProjectDetail{
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		IsTemplate:  false,
		ERDesign:    &domain.ERDesign{Entities: []domain.Entity{}, Relations: []domain.Relation{}},
		CreatedAt:   p.CreatedAt.Format(time.RFC3339),
		UpdatedAt:   p.UpdatedAt.Format(time.RFC3339),
	}, nil
}

func (s *ProjectService) DeleteProject(ctx context.Context, id string) error {
	p, err := s.EnsureWritableProject(ctx, id)
	if err != nil {
		return err
	}
	return s.ProjectRepo.Delete(ctx, p.ID)
}

func (s *ProjectService) UpdateProject(ctx context.Context, id, name string, description *string) (*ProjectDetail, error) {
	p, err := s.EnsureWritableProject(ctx, id)
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

	if _, err := s.ProjectRepo.UpdateOptionalDesc(ctx, p.ID, cleanName, descPtr); err != nil {
		return nil, err
	}
	return s.GetProject(ctx, p.ID)
}

func (s *ProjectService) GetProject(ctx context.Context, id string) (*ProjectDetail, error) {
	p, err := s.EnsureReadableProject(ctx, id)
	if err != nil {
		return nil, err
	}

	// [P0-DATA-04] 严格传递数据库读取错误，严禁将瞬时 DB 故障吞掉并返回空画布导致前端自动保存清空用户数据
	var design *domain.ERDesign
	if s.ERDesignRepo != nil {
		d, err := s.ERDesignRepo.GetByProjectID(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		design = d
	}

	var conceptualDesign *domain.ConceptualDesign
	if strings.TrimSpace(p.ConceptualDesign) != "" {
		var cd domain.ConceptualDesign
		if err := json.Unmarshal([]byte(p.ConceptualDesign), &cd); err != nil {
			return nil, fmt.Errorf("unmarshal conceptual design for project %q: %w", p.ID, err)
		}
		conceptualDesign = &cd
	}

	return &ProjectDetail{
		ID:               p.ID,
		Name:             p.Name,
		Description:      p.Description,
		IsTemplate:       p.IsTemplate,
		ConceptualDesign: conceptualDesign,
		ERDesign:         design,
		CreatedAt:        p.CreatedAt.Format(time.RFC3339),
		UpdatedAt:        p.UpdatedAt.Format(time.RFC3339),
	}, nil
}

func (s *ProjectService) GetConceptualDesign(ctx context.Context, projectID string) (*domain.ConceptualDesign, error) {
	p, err := s.EnsureReadableProject(ctx, projectID)
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
	p, err := s.EnsureWritableProject(ctx, projectID)
	if err != nil {
		return err
	}
	bytes, err := json.Marshal(design)
	if err != nil {
		return fmt.Errorf("marshal conceptual design: %w", err)
	}
	return s.ProjectRepo.SaveConceptualDesign(ctx, p.ID, string(bytes))
}

func (s *ProjectService) GetERDesign(ctx context.Context, projectID string) (*domain.ERDesign, error) {
	p, err := s.EnsureReadableProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return s.ERDesignRepo.GetByProjectID(ctx, p.ID)
}

func (s *ProjectService) SaveERDesign(ctx context.Context, projectID string, design domain.ERDesign) (*SaveERDesignResult, error) {
	p, err := s.EnsureWritableProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	saved, err := s.ERDesignRepo.SaveByProjectID(ctx, p.ID, design.Entities, design.Relations)
	if err != nil {
		return nil, err
	}
	return &SaveERDesignResult{
		Design:   saved,
		Warnings: []string{},
	}, nil
}

// EnsureProjectConversation 获取或初始化项目专属会话 ID，封装底层 MessageRepo 访问。
func (s *ProjectService) EnsureProjectConversation(ctx context.Context, projectID string) (string, error) {
	if s == nil || s.MessageRepo == nil || strings.TrimSpace(projectID) == "" {
		return "", nil
	}
	conv, err := s.MessageRepo.GetOrCreateConversation(ctx, projectID)
	if err != nil || conv == nil {
		return "", err
	}
	return conv.ID, nil
}

// AppendConversationMessage 追加一条对话消息记录，封装底层 MessageRepo 访问。
func (s *ProjectService) AppendConversationMessage(ctx context.Context, convID, role, content string) error {
	if s == nil || s.MessageRepo == nil || strings.TrimSpace(convID) == "" {
		return nil
	}
	_, err := s.MessageRepo.CreateMessage(ctx, convID, role, content)
	return err
}

func (s *ProjectService) ListProjectMessages(ctx context.Context, projectID string) ([]model.Message, error) {
	if s.isShowcaseActive(ctx) {
		p, err := s.EnsureReadableProject(ctx, projectID)
		if err != nil {
			return nil, err
		}
		projectID = p.ID
	}
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
	p, err := s.EnsureWritableProject(ctx, projectID)
	if err != nil {
		return err
	}
	if s.ProjectRepo != nil {
		if err := s.ProjectRepo.DeleteAIContext(ctx, p.ID); err != nil {
			return fmt.Errorf("delete ai context: %w", err)
		}
	}
	if s.MessageRepo == nil {
		return nil
	}
	return s.MessageRepo.ClearMessagesByProject(ctx, p.ID)
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
