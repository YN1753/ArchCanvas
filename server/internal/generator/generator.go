package generator

import (
	"archive/zip"
	"bytes"
	"context"
	"embed"
	"errors"
	"fmt"
	"go/format"
	"reflect"
	"strings"
	"text/template"

	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/internal/validator"
)

//go:embed templates/*
var templateFS embed.FS

type TemplateScope int

const (
	ScopeProject TemplateScope = iota
	ScopeEntity
)

// TemplateRule declaratively defines a single scaffold file generation rule.
type TemplateRule struct {
	TemplateName string
	Scope        TemplateScope
	FormatGo     bool
	OutputPath   func(proj ProjectTemplateData, ent EntityTemplateData) string
	BuildContext func(proj ProjectTemplateData, ent EntityTemplateData) any
	When         func(proj ProjectTemplateData) bool
}

func buildEntityRenderContext(proj ProjectTemplateData, ent EntityTemplateData) any {
	hasTime := strings.Contains(ent.PrimaryKey.GoType, "time.Time")
	if !hasTime {
		for _, attr := range ent.Attributes {
			if strings.Contains(attr.GoType, "time.Time") {
				hasTime = true
				break
			}
		}
	}
	return EntityRenderContext{
		ModuleName: proj.ModuleName,
		Entity:     ent,
		HasTime:    hasTime,
	}
}

func projectOnlyPath(relPath string) func(ProjectTemplateData, EntityTemplateData) string {
	return func(ProjectTemplateData, EntityTemplateData) string { return relPath }
}

func projectOnlyCtx(proj ProjectTemplateData, _ EntityTemplateData) any {
	return proj
}

// scaffoldManifest declares the complete ordered manifest of generated project and entity files.
var scaffoldManifest = []TemplateRule{
	{TemplateName: "go.mod.tmpl", Scope: ScopeProject, OutputPath: projectOnlyPath("go.mod"), BuildContext: projectOnlyCtx},
	{TemplateName: "config.example.yaml.tmpl", Scope: ScopeProject, OutputPath: projectOnlyPath("configs/config.example.yaml"), BuildContext: projectOnlyCtx},
	{TemplateName: "config.example.yaml.tmpl", Scope: ScopeProject, OutputPath: projectOnlyPath("configs/config.yaml"), BuildContext: projectOnlyCtx},
	{TemplateName: "config.go.tmpl", Scope: ScopeProject, FormatGo: true, OutputPath: projectOnlyPath("internal/config/config.go"), BuildContext: projectOnlyCtx},
	{TemplateName: "database.go.tmpl", Scope: ScopeProject, FormatGo: true, OutputPath: projectOnlyPath("internal/database/database.go"), BuildContext: projectOnlyCtx},
	{
		TemplateName: "redis.go.tmpl",
		Scope:        ScopeProject,
		FormatGo:     true,
		OutputPath:   projectOnlyPath("internal/cache/redis.go"),
		BuildContext: projectOnlyCtx,
		When:         func(proj ProjectTemplateData) bool { return proj.EnableRedis },
	},
	{TemplateName: "base_model.go.tmpl", Scope: ScopeProject, FormatGo: true, OutputPath: projectOnlyPath("internal/model/base.go"), BuildContext: projectOnlyCtx},
	{
		TemplateName: "model.go.tmpl",
		Scope:        ScopeEntity,
		FormatGo:     true,
		OutputPath: func(_ ProjectTemplateData, ent EntityTemplateData) string {
			return fmt.Sprintf("internal/model/%s.go", ent.FileStem)
		},
		BuildContext: buildEntityRenderContext,
	},
	{
		TemplateName: "repo.go.tmpl",
		Scope:        ScopeEntity,
		FormatGo:     true,
		OutputPath: func(_ ProjectTemplateData, ent EntityTemplateData) string {
			return fmt.Sprintf("internal/repository/%s_repo.go", ent.FileStem)
		},
		BuildContext: buildEntityRenderContext,
	},
	{
		TemplateName: "service.go.tmpl",
		Scope:        ScopeEntity,
		FormatGo:     true,
		OutputPath: func(_ ProjectTemplateData, ent EntityTemplateData) string {
			return fmt.Sprintf("internal/service/%s_service.go", ent.FileStem)
		},
		BuildContext: buildEntityRenderContext,
	},
	{
		TemplateName: "handler.go.tmpl",
		Scope:        ScopeEntity,
		FormatGo:     true,
		OutputPath: func(_ ProjectTemplateData, ent EntityTemplateData) string {
			return fmt.Sprintf("internal/handler/%s_handler.go", ent.FileStem)
		},
		BuildContext: buildEntityRenderContext,
	},
	{TemplateName: "router.go.tmpl", Scope: ScopeProject, FormatGo: true, OutputPath: projectOnlyPath("internal/router/router.go"), BuildContext: projectOnlyCtx},
	{TemplateName: "response.go.tmpl", Scope: ScopeProject, FormatGo: true, OutputPath: projectOnlyPath("pkg/response/response.go"), BuildContext: projectOnlyCtx},
	{TemplateName: "main.go.tmpl", Scope: ScopeProject, FormatGo: true, OutputPath: projectOnlyPath("cmd/server/main.go"), BuildContext: projectOnlyCtx},
	{TemplateName: "gitignore.tmpl", Scope: ScopeProject, OutputPath: projectOnlyPath(".gitignore"), BuildContext: projectOnlyCtx},
	{TemplateName: "readme.md.tmpl", Scope: ScopeProject, OutputPath: projectOnlyPath("README.md"), BuildContext: projectOnlyCtx},
	{
		TemplateName: "dockerfile.tmpl",
		Scope:        ScopeProject,
		OutputPath:   projectOnlyPath("Dockerfile"),
		BuildContext: projectOnlyCtx,
		When:         func(proj ProjectTemplateData) bool { return proj.EnableDocker },
	},
	{
		TemplateName: "makefile.tmpl",
		Scope:        ScopeProject,
		OutputPath:   projectOnlyPath("Makefile"),
		BuildContext: projectOnlyCtx,
		When:         func(proj ProjectTemplateData) bool { return proj.EnableDocker },
	},
}

type GeneratorService struct {
	designReader ERDesignReader
	templates    *template.Template
}

func isNilDesignReader(r ERDesignReader) bool {
	if r == nil {
		return true
	}
	v := reflect.ValueOf(r)
	return v.Kind() == reflect.Ptr && v.IsNil()
}

func NewGeneratorService(designReader ERDesignReader) (*GeneratorService, error) {
	tmpl, err := template.ParseFS(templateFS, "templates/*.tmpl")
	if err != nil {
		return nil, fmt.Errorf("failed to parse generator templates: %w", err)
	}
	if isNilDesignReader(designReader) {
		designReader = nil
	}
	return &GeneratorService{
		designReader: designReader,
		templates:    tmpl,
	}, nil
}

// GenerateFileTree loads the project's ERDesign and renders the full Go scaffold file tree.
func (s *GeneratorService) GenerateFileTree(ctx context.Context, req dto.GenerateRequest) ([]GeneratedFile, error) {
	if s.designReader == nil {
		return nil, errors.New("er design reader is not initialized")
	}
	design, err := s.designReader.GetERDesign(ctx, req.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("获取项目 ER 设计失败: %w", err)
	}
	if design == nil || len(design.Entities) == 0 {
		return nil, validator.NewValidationError("该项目暂无物理数据表，请先在画布中添加至少一张实体表后再生成代码")
	}

	return s.GenerateFileTreeFromDesign(design, req)
}

// GenerateFileTreeFromDesign renders all scaffold files by iterating over the declarative scaffoldManifest.
func (s *GeneratorService) GenerateFileTreeFromDesign(design *domain.ERDesign, req dto.GenerateRequest) ([]GeneratedFile, error) {
	if design == nil || len(design.Entities) == 0 {
		return nil, validator.NewValidationError("当前 ER 设计中没有任何物理数据表，无法生成空工程")
	}

	projectCtx := BuildTemplateData(req, design)
	files := make([]GeneratedFile, 0, len(scaffoldManifest)+len(projectCtx.Entities)*4)

	renderRule := func(rule TemplateRule, ent EntityTemplateData) error {
		data := rule.BuildContext(projectCtx, ent)
		var (
			content string
			err     error
		)
		if rule.FormatGo {
			content, err = s.renderGo(rule.TemplateName, data)
		} else {
			content, err = s.render(rule.TemplateName, data)
		}
		if err != nil {
			if rule.Scope == ScopeEntity {
				return fmt.Errorf("render %s for %s failed: %w", rule.TemplateName, ent.StructName, err)
			}
			return err
		}
		safePath, err := cleanSafeZipPath(rule.OutputPath(projectCtx, ent))
		if err != nil {
			return err
		}
		files = append(files, makeFile(safePath, content))
		return nil
	}

	for _, rule := range scaffoldManifest {
		if rule.When != nil && !rule.When(projectCtx) {
			continue
		}
		if rule.Scope == ScopeEntity {
			for _, ent := range projectCtx.Entities {
				if err := renderRule(rule, ent); err != nil {
					return nil, err
				}
			}
			continue
		}
		if err := renderRule(rule, EntityTemplateData{}); err != nil {
			return nil, err
		}
	}

	return files, nil
}

// GenerateZip packages all generated scaffold files into an in-memory ZIP archive with Zip Slip defense.
func (s *GeneratorService) GenerateZip(ctx context.Context, req dto.GenerateRequest) (*bytes.Buffer, error) {
	files, err := s.GenerateFileTree(ctx, req)
	if err != nil {
		return nil, err
	}

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	for _, file := range files {
		safePath, err := cleanSafeZipPath(file.Path)
		if err != nil {
			return nil, err
		}
		w, err := zw.Create(safePath)
		if err != nil {
			return nil, fmt.Errorf("zip create file %s failed: %w", safePath, err)
		}
		if _, err := w.Write([]byte(file.Content)); err != nil {
			return nil, fmt.Errorf("zip write file %s failed: %w", safePath, err)
		}
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("zip close failed: %w", err)
	}

	return buf, nil
}

func (s *GeneratorService) render(name string, data any) (string, error) {
	var buf bytes.Buffer
	if err := s.templates.ExecuteTemplate(&buf, name, data); err != nil {
		return "", fmt.Errorf("template %s execute failed: %w", name, err)
	}
	return buf.String(), nil
}

func (s *GeneratorService) renderGo(name string, data any) (string, error) {
	raw, err := s.render(name, data)
	if err != nil {
		return "", err
	}

	formatted, err := format.Source([]byte(raw))
	if err != nil {
		return "", fmt.Errorf("go/format error on %s: %w", name, err)
	}
	return string(formatted), nil
}

func makeFile(filePath, content string) GeneratedFile {
	return GeneratedFile{
		Path:    filePath,
		Content: content,
		Size:    len(content),
	}
}
