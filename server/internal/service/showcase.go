package service

import (
	"archcanvas/internal/config"
	"archcanvas/internal/model"
	"archcanvas/internal/validator"
	"archcanvas/pkg/reqctx"
	"context"
	"log/slog"
	"reflect"
	"strings"
	"time"

	"gorm.io/gorm"
)

// QuotaCleaner 抽象演示沙盒配额过期清理接口，彻底解除 service 对 middleware 的反向依赖。
type QuotaCleaner interface {
	CleanupExpiredQuotas(ctx context.Context) error
}

func (s *ProjectService) SetShowcaseConfig(cfg config.ShowcaseConfig) {
	cfg.NormalizeDefaults()
	s.ShowcaseCfg = cfg
}

// IsShowcaseEnabled 返回实例级演示沙盒模式是否已开启。
func (s *ProjectService) IsShowcaseEnabled() bool {
	return s != nil && s.ShowcaseCfg.Enabled
}

// ShowcaseConfig 返回经过默认值归一化的演示沙盒配置快照。
func (s *ProjectService) ShowcaseConfig() config.ShowcaseConfig {
	var cfg config.ShowcaseConfig
	if s != nil {
		cfg = s.ShowcaseCfg
	}
	cfg.NormalizeDefaults()
	return cfg
}

func (s *ProjectService) isShowcaseActive(ctx context.Context) bool {
	return s.IsShowcaseEnabled() || reqctx.IsShowcaseMode(ctx)
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
		vid := reqctx.VisitorIDFromContext(ctx)
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
		vid := reqctx.VisitorIDFromContext(ctx)
		if vid == "" || p.VisitorID != vid {
			return nil, gorm.ErrRecordNotFound
		}
	}
	return p, nil
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
func (s *ProjectService) StartShowcaseSweeper(ctx context.Context, quotaCleaner QuotaCleaner) {
	if !s.IsShowcaseEnabled() {
		return
	}
	hasQuotaCleaner := quotaCleaner != nil && !(reflect.ValueOf(quotaCleaner).Kind() == reflect.Ptr && reflect.ValueOf(quotaCleaner).IsNil())
	runSweep := func() {
		sweepCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		if deleted, err := s.SweepExpiredShowcaseProjects(sweepCtx); err != nil {
			slog.Warn("showcase_sweeper_error", "error", err)
		} else if deleted > 0 {
			slog.Info("showcase_sweeper_cleaned_expired_projects", "deleted_count", deleted)
		}
		if hasQuotaCleaner {
			_ = quotaCleaner.CleanupExpiredQuotas(sweepCtx)
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
