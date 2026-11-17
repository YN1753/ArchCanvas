package generator

import (
	"archive/zip"
	"bytes"
	"context"
	"embed"
	"fmt"
	"go/format"
	"path"
	"strings"
	"text/template"

	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/internal/service"
	"archcanvas/internal/validator"
)

//go:embed templates/*
var templateFS embed.FS

type GeneratorService struct {
	projectService *service.ProjectService
	templates      *template.Template
}

func NewGeneratorService(projectService *service.ProjectService) (*GeneratorService, error) {
	tmpl, err := template.ParseFS(templateFS, "templates/*.tmpl")
	if err != nil {
		return nil, fmt.Errorf("failed to parse generator templates: %w", err)
	}

	return &GeneratorService{
		projectService: projectService,
		templates:      tmpl,
	}, nil
}

// cleanSafeZipPath 严格校验生成文件路径，彻底阻断 Zip Slip 目录穿越漏洞。
func cleanSafeZipPath(rawPath string) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(rawPath), "\\", "/")
	if normalized == "" || strings.HasPrefix(normalized, "/") || strings.Contains(normalized, ":") {
		return "", fmt.Errorf("unsafe archive file path: %q", rawPath)
	}
	for _, seg := range strings.Split(normalized, "/") {
		if seg == ".." || seg == "." || seg == "" {
			return "", fmt.Errorf("path traversal segment detected in %q", rawPath)
		}
	}
	cleaned := path.Clean(normalized)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
		return "", fmt.Errorf("unsafe cleaned archive path: %q", cleaned)
	}
	return cleaned, nil
}

// GenerateFileTree 生成工程文件列表 (供前端弹窗代码树与预览展示)
func (s *GeneratorService) GenerateFileTree(ctx context.Context, req dto.GenerateRequest) ([]GeneratedFile, error) {
	design, err := s.projectService.GetERDesign(ctx, req.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("获取项目 ER 设计失败: %w", err)
	}
	if design == nil || len(design.Entities) == 0 {
		return nil, validator.NewValidationError("该项目暂无物理数据表，请先在画布中添加至少一张实体表后再生成代码")
	}

	return s.GenerateFileTreeFromDesign(design, req)
}

// GenerateFileTreeFromDesign 根据 ER 模型与生成请求生成完整工程文件树
func (s *GeneratorService) GenerateFileTreeFromDesign(design *domain.ERDesign, req dto.GenerateRequest) ([]GeneratedFile, error) {
	if design == nil || len(design.Entities) == 0 {
		return nil, validator.NewValidationError("当前 ER 设计中没有任何物理数据表，无法生成空工程")
	}

	projectCtx := BuildProjectContext(req, design)
	var files []GeneratedFile

	// 1. go.mod
	content, err := s.render("go.mod.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile("go.mod", content))

	// 2. configs
	cfgExample, err := s.render("config.example.yaml.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile("configs/config.example.yaml", cfgExample))
	files = append(files, makeFile("configs/config.yaml", cfgExample))

	// 3. internal/config/config.go
	cfgGo, err := s.renderGo("config.go.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile("internal/config/config.go", cfgGo))

	// 4. internal/database/database.go
	dbGo, err := s.renderGo("database.go.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile("internal/database/database.go", dbGo))

	// 5. internal/cache/redis.go (可选)
	if projectCtx.EnableRedis {
		redisGo, err := s.renderGo("redis.go.tmpl", projectCtx)
		if err != nil {
			return nil, err
		}
		files = append(files, makeFile("internal/cache/redis.go", redisGo))
	}

	// 6. internal/model/base.go
	baseModelGo, err := s.renderGo("base_model.go.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile("internal/model/base.go", baseModelGo))

	// 7. 各实体表对应模型、仓储、业务、控制器
	for _, ent := range projectCtx.Entities {
		hasTime := strings.Contains(ent.PrimaryKey.GoType, "time.Time")
		if !hasTime {
			for _, attr := range ent.Attributes {
				if strings.Contains(attr.GoType, "time.Time") {
					hasTime = true
					break
				}
			}
		}

		entCtx := struct {
			ModuleName string
			Entity     EntityData
			HasTime    bool
		}{
			ModuleName: projectCtx.ModuleName,
			Entity:     ent,
			HasTime:    hasTime,
		}

		mCode, err := s.renderGo("model.go.tmpl", entCtx)
		if err != nil {
			return nil, fmt.Errorf("render model %s failed: %w", ent.StructName, err)
		}
		files = append(files, makeFile(fmt.Sprintf("internal/model/%s.go", ent.FileStem), mCode))

		rCode, err := s.renderGo("repo.go.tmpl", entCtx)
		if err != nil {
			return nil, fmt.Errorf("render repo %s failed: %w", ent.StructName, err)
		}
		files = append(files, makeFile(fmt.Sprintf("internal/repository/%s_repo.go", ent.FileStem), rCode))

		sCode, err := s.renderGo("service.go.tmpl", entCtx)
		if err != nil {
			return nil, fmt.Errorf("render service %s failed: %w", ent.StructName, err)
		}
		files = append(files, makeFile(fmt.Sprintf("internal/service/%s_service.go", ent.FileStem), sCode))

		hCode, err := s.renderGo("handler.go.tmpl", entCtx)
		if err != nil {
			return nil, fmt.Errorf("render handler %s failed: %w", ent.StructName, err)
		}
		files = append(files, makeFile(fmt.Sprintf("internal/handler/%s_handler.go", ent.FileStem), hCode))
	}

	// 8. internal/router/router.go
	routerGo, err := s.renderGo("router.go.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile("internal/router/router.go", routerGo))

	// 9. pkg/response/response.go
	respGo, err := s.renderGo("response.go.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile("pkg/response/response.go", respGo))

	// 10. cmd/server/main.go
	mainGo, err := s.renderGo("main.go.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile("cmd/server/main.go", mainGo))

	// 11. 辅助文件
	gitIgnore, err := s.render("gitignore.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile(".gitignore", gitIgnore))

	readme, err := s.render("readme.md.tmpl", projectCtx)
	if err != nil {
		return nil, err
	}
	files = append(files, makeFile("README.md", readme))

	if projectCtx.EnableDocker {
		dockerfile, err := s.render("dockerfile.tmpl", projectCtx)
		if err != nil {
			return nil, err
		}
		files = append(files, makeFile("Dockerfile", dockerfile))

		makefile, err := s.render("makefile.tmpl", projectCtx)
		if err != nil {
			return nil, err
		}
		files = append(files, makeFile("Makefile", makefile))
	}

	for i := range files {
		safePath, err := cleanSafeZipPath(files[i].Path)
		if err != nil {
			return nil, err
		}
		files[i].Path = safePath
	}

	return files, nil
}

// GenerateZip 在内存中流式打包为 zip 二进制流（全路径防穿越保护）
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
