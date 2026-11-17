package service

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/config"
	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/internal/middleware"
	"archcanvas/internal/model"
	"archcanvas/internal/repository"
	"archcanvas/internal/validator"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"gorm.io/gorm"
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

func (s *ProjectService) SetShowcaseConfig(cfg config.ShowcaseConfig) {
	cfg.NormalizeDefaults()
	s.ShowcaseCfg = cfg
}

func (s *ProjectService) isShowcaseActive(ctx context.Context) bool {
	return s.ShowcaseCfg.Enabled || middleware.IsShowcaseMode(ctx)
}

// EnsureReadableProject 校验当前上下文是否允许读取指定项目（演示沙盒模式下仅放行官方样板与当前访客自有项目）。
func (s *ProjectService) EnsureReadableProject(ctx context.Context, projectID string) (*model.Project, error) {
	cleanID, err := validator.ValidateRequiredText("id", projectID, 64)
	if err != nil {
		return nil, err
	}
	p, err := s.ProjectRepo.GetByID(ctx, cleanID)
	if err != nil {
		return nil, err
	}
	if s.isShowcaseActive(ctx) {
		vid := middleware.GetVisitorID(ctx)
		if !p.IsTemplate && (vid == "" || p.VisitorID != vid) {
			return nil, gorm.ErrRecordNotFound
		}
	}
	return p, nil
}

// EnsureWritableProject 校验当前上下文是否允许修改/删除指定项目（演示沙盒模式下严禁修改官方样板或他人项目）。
func (s *ProjectService) EnsureWritableProject(ctx context.Context, projectID string) (*model.Project, error) {
	cleanID, err := validator.ValidateRequiredText("project_id", projectID, 64)
	if err != nil {
		return nil, err
	}
	p, err := s.ProjectRepo.GetByID(ctx, cleanID)
	if err != nil {
		return nil, err
	}
	if p.IsTemplate {
		return nil, validator.NewForbiddenError("官方演示样板工程受只读保护，请点击「克隆到我的沙盒」在专属副本中自由编辑")
	}
	if s.isShowcaseActive(ctx) {
		vid := middleware.GetVisitorID(ctx)
		if vid == "" || p.VisitorID != vid {
			return nil, gorm.ErrRecordNotFound
		}
	}
	return p, nil
}

func (s *ProjectService) ListProjects(ctx context.Context) ([]ProjectDetail, error) {
	var (
		projects []model.Project
		err      error
	)
	if s.isShowcaseActive(ctx) {
		projects, err = s.ProjectRepo.ListForShowcaseVisitor(ctx, middleware.GetVisitorID(ctx))
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
		visitorID = middleware.GetVisitorID(ctx)
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

// ForkProject 将可读项目（特别是官方演示样板）一键深拷贝克隆为当前访客可自由编辑的专属沙盒副本。
func (s *ProjectService) ForkProject(ctx context.Context, sourceProjectID, customName string) (*ProjectDetail, error) {
	srcProj, err := s.EnsureReadableProject(ctx, sourceProjectID)
	if err != nil {
		return nil, err
	}

	forkName := strings.TrimSpace(customName)
	if forkName == "" {
		forkName = srcProj.Name + " (沙盒副本)"
	}

	created, err := s.CreateProject(ctx, forkName, srcProj.Description)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(srcProj.ConceptualDesign) != "" {
		if err := s.ProjectRepo.SaveConceptualDesign(ctx, created.ID, srcProj.ConceptualDesign); err != nil {
			return nil, err
		}
	}

	if s.ERDesignRepo != nil {
		srcDesign, err := s.ERDesignRepo.GetByProjectID(ctx, srcProj.ID)
		if err != nil {
			return nil, err
		}
		if srcDesign != nil && len(srcDesign.Entities) > 0 {
			if _, err := s.ERDesignRepo.SaveByProjectID(ctx, created.ID, srcDesign.Entities, srcDesign.Relations); err != nil {
				return nil, err
			}
		}
	}

	return s.GetProject(ctx, created.ID)
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

func (s *ProjectService) GetAvailableModels(ctx context.Context, req dto.GetModelsReq) (agent.AvailableModels, error) {
	if s.ModelManager == nil {
		return agent.AvailableModels{}, errors.New("model manager is not initialized")
	}
	if s.isShowcaseActive(ctx) {
		if strings.TrimSpace(req.BaseURL) != "" || strings.TrimSpace(req.APIKey) != "" {
			return agent.AvailableModels{}, validator.NewForbiddenError("公开演示沙盒模式下禁止传入自定义 base_url 或 api_key 进行探测")
		}
		res, err := s.ModelManager.GetAvailableModels(ctx, dto.GetModelsReq{Provider: req.Provider})
		if err != nil {
			return agent.AvailableModels{}, err
		}
		// 脱敏剥离服务端内部 BaseURL，仅暴露预置模型标识
		for i := range res.Models {
			res.Models[i].BaseURL = ""
		}
		for i := range res.Providers {
			res.Providers[i].BaseURL = ""
		}
		return res, nil
	}
	return s.ModelManager.GetAvailableModels(ctx, req)
}

func (s *ProjectService) SaveModelConfig(ctx context.Context, req dto.SaveModelReq) (agent.AvailableModels, error) {
	if s.isShowcaseActive(ctx) {
		return agent.AvailableModels{}, validator.NewForbiddenError("公开演示沙盒模式下已锁定服务端模型配置，禁止修改默认模型与密钥")
	}
	if s.ModelManager == nil {
		return agent.AvailableModels{}, errors.New("model manager is not initialized")
	}
	return s.ModelManager.SaveAndSwitchModel(ctx, req)
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

// SweepExpiredShowcaseProjects 清扫超过存活时长（默认 24 小时）未更新的访客临时项目及其全量级联记录。
func (s *ProjectService) SweepExpiredShowcaseProjects(ctx context.Context) (int, error) {
	if s == nil || s.ProjectRepo == nil {
		return 0, nil
	}
	ttlHours := s.ShowcaseCfg.VisitorTTLHours
	if ttlHours <= 0 {
		ttlHours = 24
	}
	cutoff := time.Now().Add(-time.Duration(ttlHours) * time.Hour)
	ids, err := s.ProjectRepo.ListExpiredVisitorProjectIDs(ctx, cutoff)
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, id := range ids {
		if err := s.ProjectRepo.Delete(ctx, id); err == nil {
			deleted++
		}
	}
	return deleted, nil
}

// StartShowcaseSweeper 启动后台定时清扫协程（首次启动即执行一次清理，随后每小时巡检一次，随 appCtx 优雅退出）。
func (s *ProjectService) StartShowcaseSweeper(ctx context.Context, quotaMgr *middleware.ShowcaseQuotaManager) {
	if s == nil || !s.ShowcaseCfg.Enabled {
		return
	}
	runSweep := func() {
		sweepCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		if deleted, err := s.SweepExpiredShowcaseProjects(sweepCtx); err != nil {
			slog.Warn("showcase_sweeper_error", "error", err)
		} else if deleted > 0 {
			slog.Info("showcase_sweeper_cleaned_expired_projects", "deleted_count", deleted)
		}
		if quotaMgr != nil {
			_ = quotaMgr.CleanupExpiredQuotas(sweepCtx)
		}
	}

	go func() {
		runSweep()
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runSweep()
			}
		}
	}()
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
