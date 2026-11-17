package generator

import (
	"archive/zip"
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
)

// TestGenerator_ZipSlipAndCodeInjectionDefense 验证 [P0-SEC-03] & [P1-GEN-01..04]：
// 恶意路径穿越表名、引号/反引号/换行注入、中文表名/字段名、非法 CodeType、可空主键、保留方法名冲突均能安全清洗并 100% 编译通过。
func TestGenerator_ZipSlipAndCodeInjectionDefense(t *testing.T) {
	svc, err := NewGeneratorService(nil)
	if err != nil {
		t.Fatalf("init generator: %v", err)
	}

	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_evil",
				Name:    "../../../../tmp/pwn_users\" + panic(\"hacked\") //",
				Comment: "恶意注释第一行\nimport \"os\" // 注入换行",
				Attributes: []domain.Attribute{
					{
						ID:           "a1",
						Name:         "key",
						DBType:       "VARCHAR(64)` + hack",
						CodeType:     "uuid.UUID", // 非标准未导入类型
						IsPrimaryKey: true,
						IsNullable:   true, // 可空主键应强制纠正为非指针
						Comment:      "主键\n换行注入`反引号\"",
					},
					{
						ID:       "a2",
						Name:     "table_name", // 与 TableName() 方法重名
						DBType:   "DECIMAL(10,2)",
						CodeType: "decimal", // 常见 LLM 非法别名
					},
					{
						ID:       "a3",
						Name:     "base_model", // 与内嵌 BaseModel 重名
						DBType:   "TINYINT(1)",
						CodeType: "boolean",
					},
				},
			},
			{
				ID:      "ent_base_conflict",
				Name:    "base", // 与 internal/model/base.go 冲突
				Comment: "基础配置",
				Attributes: []domain.Attribute{
					// 仅包含审计列，验证会自动补齐默认 ID 字段避免编译报错
					{ID: "b1", Name: "created_at", DBType: "DATETIME", CodeType: "datetime"},
				},
			},
			{
				ID:      "ent_cn",
				Name:    "用户档案", // 纯中文表名
				Comment: "中文实体",
				Attributes: []domain.Attribute{
					{ID: "c1", Name: "编号", DBType: "BIGINT", IsPrimaryKey: true},
					{ID: "c2", Name: "真实姓名", DBType: "VARCHAR(64)"},
				},
			},
		},
	}

	req := dto.GenerateRequest{
		ProjectID:    "proj_sec",
		ModuleName:   "github.com/acme/sec-demo",
		Port:         ":8080",
		DBDriver:     "postgres",
		EnableDocker: true,
		EnableRedis:  true,
	}

	files, err := svc.GenerateFileTreeFromDesign(design, req)
	if err != nil {
		t.Fatalf("GenerateFileTreeFromDesign failed: %v", err)
	}

	var hasBaseGo bool
	for _, f := range files {
		if strings.Contains(f.Path, "..") || strings.HasPrefix(f.Path, "/") {
			t.Fatalf("CRITICAL Zip Slip path detected: %q", f.Path)
		}
		if f.Path == "internal/model/base.go" {
			hasBaseGo = true
			if !strings.Contains(f.Content, "type BaseModel struct") {
				t.Fatalf("internal/model/base.go was overwritten by table named 'base'!\n%s", f.Content)
			}
		}
		if f.Path == "Dockerfile" {
			if strings.Contains(f.Content, "EXPOSE :") {
				t.Errorf("Dockerfile still contains invalid EXPOSE with colon:\n%s", f.Content)
			}
		}
		if f.Path == "configs/config.example.yaml" {
			if strings.Contains(f.Content, "dbname=github.com/") {
				t.Errorf("config.example.yaml injected raw ModuleName with slashes into DSN:\n%s", f.Content)
			}
		}
	}
	if !hasBaseGo {
		t.Fatal("missing internal/model/base.go")
	}

	// 验证 ZIP 归档同样无任何路径穿越条目
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	for _, f := range files {
		cleanP, err := cleanSafeZipPath(f.Path)
		if err != nil {
			t.Fatalf("cleanSafeZipPath rejected %q: %v", f.Path, err)
		}
		w, _ := zw.Create(cleanP)
		_, _ = w.Write([]byte(f.Content))
	}
	_ = zw.Close()

	// 端到端真实编译校验
	tmpDir := t.TempDir()
	for _, f := range files {
		target := filepath.Join(tmpDir, f.Path)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(target, []byte(f.Content), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	tidy := exec.Command("go", "mod", "tidy")
	tidy.Dir = tmpDir
	if out, err := tidy.CombinedOutput(); err != nil {
		t.Fatalf("go mod tidy failed: %v\n%s", err, string(out))
	}

	build := exec.Command("go", "build", "-o", "sec_bin", "./cmd/server")
	build.Dir = tmpDir
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build failed on adversarial schema: %v\n%s", err, string(out))
	}
}

// TestDetectJunctionTables_DoesNotMisclassifyNormalBusinessTable 验证 [P1-GEN-01]：
// 字段数 <= 7 的常规业务表（如 orders、comments）绝不会被误判为 many2many 中间表。
func TestDetectJunctionTables_DoesNotMisclassifyNormalBusinessTable(t *testing.T) {
	svc, err := NewGeneratorService(nil)
	if err != nil {
		t.Fatalf("init generator: %v", err)
	}

	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID: "e_user", Name: "users",
				Attributes: []domain.Attribute{
					{Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
					{Name: "name", DBType: "VARCHAR(64)"},
				},
			},
			{
				ID: "e_article", Name: "articles",
				Attributes: []domain.Attribute{
					{Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
					{Name: "title", DBType: "VARCHAR(128)"},
				},
			},
			{
				ID: "e_comment", Name: "comments", // 连接 users 与 articles 且共 5 个字段（<=7），但属于独立业务表！
				Attributes: []domain.Attribute{
					{Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
					{Name: "user_id", DBType: "BIGINT"},
					{Name: "article_id", DBType: "BIGINT"},
					{Name: "content", DBType: "TEXT"},
					{Name: "created_at", DBType: "DATETIME"},
				},
			},
		},
		Relations: []domain.Relation{
			{ID: "r1", SourceEntityID: "e_user", TargetEntityID: "e_comment", Cardinality: "1:N"},
			{ID: "r2", SourceEntityID: "e_article", TargetEntityID: "e_comment", Cardinality: "1:N"},
		},
	}

	files, err := svc.GenerateFileTreeFromDesign(design, dto.GenerateRequest{
		ModuleName: "example.com/blog",
		DBDriver:   "mysql",
	})
	if err != nil {
		t.Fatalf("generate failed: %v", err)
	}
	for _, f := range files {
		if f.Path == "internal/model/users.go" && strings.Contains(f.Content, "many2many:comments") {
			t.Fatalf("CRITICAL regression: normal business table 'comments' was misclassified as a many2many join table!\n%s", f.Content)
		}
	}
}
