package generator

import (
	"archive/zip"
	"bytes"
	"context"
	"embed"
	"fmt"
	"go/format"
	"strings"
	"text/template"

	"archcanvas/internal/domain"
	"archcanvas/internal/service"
	"archcanvas/request"
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

// GenerateFileTree 生成工程文件列表 (供前端弹窗代码树与预览展示)
func (s *GeneratorService) GenerateFileTree(ctx context.Context, req request.GenerateRequest) ([]GeneratedFile, error) {
	design, err := s.projectService.GetERDesign(ctx, req.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("获取项目 ER 设计失败: %w", err)
	}
	if design == nil {
		return nil, fmt.Errorf("该项目暂无 ER 数据模型，请先在画布中添加实体表")
	}

	return s.GenerateFileTreeFromDesign(design, req)
}

// GenerateFileTreeFromDesign 根据 ER 模型与生成请求生成完整工程文件树
func (s *GeneratorService) GenerateFileTreeFromDesign(design *domain.ERDesign, req request.GenerateRequest) ([]GeneratedFile, error) {
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
		hasTime := false
		for _, attr := range ent.Attributes {
			if strings.Contains(attr.GoType, "time.Time") {
				hasTime = true
				break
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

		// Model
		mCode, err := s.renderGo("model.go.tmpl", entCtx)
		if err != nil {
			return nil, fmt.Errorf("render model %s failed: %w", ent.StructName, err)
		}
		files = append(files, makeFile(fmt.Sprintf("internal/model/%s.go", ent.TableName), mCode))

		// Repo
		rCode, err := s.renderGo("repo.go.tmpl", entCtx)
		if err != nil {
			return nil, fmt.Errorf("render repo %s failed: %w", ent.StructName, err)
		}
		files = append(files, makeFile(fmt.Sprintf("internal/repository/%s_repo.go", ent.TableName), rCode))

		// Service
		sCode, err := s.renderGo("service.go.tmpl", entCtx)
		if err != nil {
			return nil, fmt.Errorf("render service %s failed: %w", ent.StructName, err)
		}
		files = append(files, makeFile(fmt.Sprintf("internal/service/%s_service.go", ent.TableName), sCode))

		// Handler
		hCode, err := s.renderGo("handler.go.tmpl", entCtx)
		if err != nil {
			return nil, fmt.Errorf("render handler %s failed: %w", ent.StructName, err)
		}
		files = append(files, makeFile(fmt.Sprintf("internal/handler/%s_handler.go", ent.TableName), hCode))
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

	return files, nil
}

// GenerateZip 在内存中流式打包为 zip 二进制流
func (s *GeneratorService) GenerateZip(ctx context.Context, req request.GenerateRequest) (*bytes.Buffer, error) {
	files, err := s.GenerateFileTree(ctx, req)
	if err != nil {
		return nil, err
	}

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	for _, file := range files {
		w, err := zw.Create(file.Path)
		if err != nil {
			return nil, fmt.Errorf("zip create file %s failed: %w", file.Path, err)
		}
		if _, err := w.Write([]byte(file.Content)); err != nil {
			return nil, fmt.Errorf("zip write file %s failed: %w", file.Path, err)
		}
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("zip close failed: %w", err)
	}

	return buf, nil
}

func (s *GeneratorService) render(name string, data interface{}) (string, error) {
	var buf bytes.Buffer
	if err := s.templates.ExecuteTemplate(&buf, name, data); err != nil {
		return "", fmt.Errorf("template %s execute failed: %w", name, err)
	}
	return buf.String(), nil
}

func (s *GeneratorService) renderGo(name string, data interface{}) (string, error) {
	raw, err := s.render(name, data)
	if err != nil {
		return "", err
	}

	// 统一走 go/format 强力保底进行 AST 格式化与排版校验
	formatted, err := format.Source([]byte(raw))
	if err != nil {
		// 如果格式化失败，附带源码信息便于排查
		return "", fmt.Errorf("go/format error on %s: %w\nSource:\n%s", name, err, raw)
	}
	return string(formatted), nil
}

func makeFile(path, content string) GeneratedFile {
	return GeneratedFile{
		Path:    path,
		Content: content,
		Size:    len(content),
	}
}
