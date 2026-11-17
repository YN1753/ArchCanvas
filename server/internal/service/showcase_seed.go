package service

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"sort"

	"archcanvas/internal/domain"
	"archcanvas/internal/model"
	"archcanvas/pkg/reqctx"
)

const (
	OfficialTemplateEcommerceID = "01960000-0000-7000-8000-000000000001"
	OfficialTemplateRBACID      = "01960000-0000-7000-8000-000000000002"
)

//go:embed seeds/*.json
var showcaseSeedsFS embed.FS

type officialTemplateSpec struct {
	ID               string                  `json:"id"`
	Order            int                     `json:"order"`
	Name             string                  `json:"name"`
	Description      string                  `json:"description"`
	Conceptual       domain.ConceptualDesign `json:"conceptual"`
	Physical         domain.ERDesign         `json:"physical"`
	UserPrompt       string                  `json:"user_prompt"`
	AssistantMessage map[string]any          `json:"assistant_message"`
}

// EnsureShowcaseSeeds 幂等初始化内置官方样板工程（按 seeds/*.json 排序加载，新增 03_*.json 零代码改动）。
func (s *ProjectService) EnsureShowcaseSeeds(ctx context.Context) error {
	if s == nil || s.ProjectRepo == nil || s.ERDesignRepo == nil {
		return nil
	}
	entries, err := fs.ReadDir(showcaseSeedsFS, "seeds")
	if err != nil {
		return fmt.Errorf("read embedded showcase seeds: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

	for idx, entry := range entries {
		if entry.IsDir() {
			continue
		}
		raw, err := showcaseSeedsFS.ReadFile("seeds/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read seed %s: %w", entry.Name(), err)
		}
		var spec officialTemplateSpec
		if err := json.Unmarshal(raw, &spec); err != nil {
			return fmt.Errorf("unmarshal seed %s: %w", entry.Name(), err)
		}
		if spec.Order <= 0 {
			spec.Order = idx + 1
		}
		cdBytes, err := json.Marshal(spec.Conceptual)
		if err != nil {
			return fmt.Errorf("marshal conceptual template %s: %w", spec.Name, err)
		}
		if err := s.ProjectRepo.UpsertTemplateProject(ctx, model.Project{
			ID: spec.ID, Name: spec.Name, Description: spec.Description,
			VisitorID: reqctx.OfficialVisitorID, IsTemplate: true,
			TemplateOrder: spec.Order, ConceptualDesign: string(cdBytes),
		}); err != nil {
			return fmt.Errorf("upsert template project %s: %w", spec.Name, err)
		}
		if _, err := s.ERDesignRepo.SaveByProjectID(ctx, spec.ID, spec.Physical.Entities, spec.Physical.Relations); err != nil {
			return fmt.Errorf("seed physical design for %s: %w", spec.Name, err)
		}
		if s.MessageRepo != nil {
			if existing, _ := s.MessageRepo.ListMessagesByProject(ctx, spec.ID); len(existing) == 0 {
				if conv, err := s.MessageRepo.GetOrCreateConversation(ctx, spec.ID); err == nil && conv != nil {
					_, _ = s.MessageRepo.CreateMessage(ctx, conv.ID, "user", spec.UserPrompt)
					assistantJSON, _ := json.Marshal(spec.AssistantMessage)
					_, _ = s.MessageRepo.CreateMessage(ctx, conv.ID, "assistant", string(assistantJSON))
				}
			}
		}
	}
	return nil
}

// SeedOfficialShowcaseProjects 兼容主程序与集成测试入口，委托给 EnsureShowcaseSeeds。
func (s *ProjectService) SeedOfficialShowcaseProjects(ctx context.Context) error {
	return s.EnsureShowcaseSeeds(ctx)
}
