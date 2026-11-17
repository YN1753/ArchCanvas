package eval

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/internal/generator"
)

// EvalCases 评测用例文件定义
type EvalCases struct {
	ClarificationCases []ClarificationCase `json:"clarification_cases"`
	ModelingCases      []ModelingCase      `json:"modeling_cases"`
}

type ClarificationCase struct {
	ID                    string `json:"id"`
	Input                 string `json:"input"`
	ExpectedClarification bool   `json:"expected_clarification"`
	Reason                string `json:"reason"`
}

type ModelingCase struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Input    string   `json:"input"`
	Entities []string `json:"entities"`
}

// EvalReport 评测汇总指标报表
type EvalReport struct {
	Mode                   string  `json:"mode"`
	ClarificationTotal     int     `json:"clarification_total"`
	ClarificationPositives int     `json:"clarification_positives"` // 正样本总数 (TP + FN)
	ClarificationNegatives int     `json:"clarification_negatives"` // 负样本总数 (TN + FP)
	FalseNegativeCount     int     `json:"false_negative_count"`    // 漏判数（应澄清却未澄清）
	FalsePositiveCount     int     `json:"false_positive_count"`    // 误判数（不应澄清却澄清）
	FalseNegativeRate      float64 `json:"false_negative_rate"`     // 漏判率 FN / (TP + FN)
	FalsePositiveRate      float64 `json:"false_positive_rate"`     // 误判率 FP / (FP + TN)
	ModelingTotal          int     `json:"modeling_total"`
	RulePassCount          int     `json:"rule_pass_count"`
	RulePassRate           float64 `json:"rule_pass_rate"`
	BuildSuccessCount      int     `json:"build_success_count"`
	BuildSuccessRate       float64 `json:"build_success_rate"`
	AverageDurationMs      int64   `json:"average_duration_ms"`
	Timestamp              string  `json:"timestamp"`
}

// LoadCases 从指定路径读取用例集
func LoadCases(path string) (*EvalCases, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取评测用例文件失败: %w", err)
	}
	var cases EvalCases
	if err := json.Unmarshal(data, &cases); err != nil {
		return nil, fmt.Errorf("解析评测用例 JSON 失败: %w", err)
	}
	return &cases, nil
}

// CheckERDesignRules 按照建模规则对生成的 ERDesign 进行自动断言打分
func CheckERDesignRules(design *domain.ERDesign) (bool, []string) {
	if design == nil || len(design.Entities) == 0 {
		return false, []string{"ER 设计为空或实体数量为 0"}
	}

	var issues []string
	entityMap := make(map[string]domain.Entity, len(design.Entities)*2)
	for _, ent := range design.Entities {
		entityMap[ent.ID] = ent
		entityMap[strings.ToLower(ent.Name)] = ent

		if len(ent.Attributes) == 0 {
			issues = append(issues, fmt.Sprintf("实体 %s 字段列表为空", ent.Name))
			continue
		}

		// 规则 1: 必须有非空物理主键
		hasPK := false
		for _, attr := range ent.Attributes {
			if attr.IsPrimaryKey {
				hasPK = true
				if attr.IsNullable {
					issues = append(issues, fmt.Sprintf("实体 %s 主键列 %s 不允许为 Nullable", ent.Name, attr.Name))
				}
			}
		}
		if !hasPK {
			issues = append(issues, fmt.Sprintf("实体 %s 缺失物理主键 (IsPrimaryKey==true)", ent.Name))
		}
	}

	// 规则 2: 关联关系两端实体必须合法存在，且 1:N / 1:1 目标表需包含外键列
	for _, rel := range design.Relations {
		srcEnt, srcOk := entityMap[rel.SourceEntityID]
		if !srcOk {
			srcEnt, srcOk = entityMap[strings.ToLower(rel.SourceEntityID)]
		}
		tgtEnt, tgtOk := entityMap[rel.TargetEntityID]
		if !tgtOk {
			tgtEnt, tgtOk = entityMap[strings.ToLower(rel.TargetEntityID)]
		}
		if !srcOk || !tgtOk || srcEnt.ID == "" || tgtEnt.ID == "" {
			issues = append(issues, fmt.Sprintf("关系 %s 的端点实体不存在 (%s -> %s)", rel.ID, rel.SourceEntityID, rel.TargetEntityID))
			continue
		}

		card := rel.Cardinality
		if card == "" {
			card = rel.RelationTypeID
		}
		if card == "one_to_many" || card == "one_to_one" {
			hasFK := false
			for _, attr := range tgtEnt.Attributes {
				lowerCol := strings.ToLower(attr.Name)
				if strings.HasSuffix(lowerCol, "_id") && !attr.IsPrimaryKey {
					hasFK = true
					break
				}
			}
			if !hasFK {
				issues = append(issues, fmt.Sprintf("关系 %s (%s -> %s) 在目标表 %s 中缺少外键列 (*_id)", rel.ID, srcEnt.Name, tgtEnt.Name, tgtEnt.Name))
			}
		}
	}

	return len(issues) == 0, issues
}

// VerifyE2EBuild 将生成的工程写入临时目录并执行真实编译、静态检查与内存 SQLite AutoMigrate 冒烟测试
func VerifyE2EBuild(genSvc *generator.GeneratorService, design *domain.ERDesign, modName string) (bool, error) {
	req := dto.GenerateRequest{
		ProjectID:  "eval_project",
		ModuleName: modName,
		Port:       "8080",
		DBDriver:   "sqlite",
	}

	files, err := genSvc.GenerateFileTreeFromDesign(design, req)
	if err != nil {
		return false, fmt.Errorf("生成工程代码树失败: %w", err)
	}

	tmpDir, err := os.MkdirTemp("", "eval_build_*")
	if err != nil {
		return false, err
	}
	defer os.RemoveAll(tmpDir)

	for _, f := range files {
		targetPath := filepath.Join(tmpDir, f.Path)
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return false, err
		}
		if err := os.WriteFile(targetPath, []byte(f.Content), 0o644); err != nil {
			return false, err
		}
	}

	// 写入运行时内存 SQLite AutoMigrate 冒烟测试，真实检验 GORM Tag、外键与多对多映射在启动期是否崩溃
	smokeTestSrc := fmt.Sprintf(`package database

import (
	"testing"

	%q
)

func TestInitDBAutoMigrateSmoke(t *testing.T) {
	db, err := InitDB(config.DatabaseConfig{
		Driver: "sqlite",
		DSN:    "file::memory:?cache=shared&_foreign_keys=on",
	})
	if err != nil {
		t.Fatalf("InitDB & AutoMigrate failed: %%v", err)
	}
	var tables []string
	if err := db.Raw("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%%'").Scan(&tables).Error; err != nil {
		t.Fatalf("query sqlite_master failed: %%v", err)
	}
	if len(tables) == 0 {
		t.Fatalf("expected migrated tables in sqlite_master, got 0")
	}
	if sqlDB, err := db.DB(); err == nil {
		_ = sqlDB.Close()
	}
}
`, modName+"/internal/config")

	smokeTestPath := filepath.Join(tmpDir, "internal", "database", "smoke_test.go")
	if err := os.WriteFile(smokeTestPath, []byte(smokeTestSrc), 0o644); err != nil {
		return false, fmt.Errorf("write smoke_test.go failed: %w", err)
	}

	// 预置主仓库 go.sum 作为本地校验种子，确保离线/沙箱环境下 go mod tidy 不因访问外网 sumdb 阻塞或失败
	if hostGoSum, err := os.ReadFile(filepath.Join("..", "..", "go.sum")); err == nil && len(hostGoSum) > 0 {
		_ = os.WriteFile(filepath.Join(tmpDir, "go.sum"), hostGoSum, 0o644)
	}

	// 1. go mod tidy
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = tmpDir
	if out, err := tidyCmd.CombinedOutput(); err != nil {
		// 若离线环境无外网，回退使用 GOPROXY=off + GOSUMDB=off 重试本地模块缓存解析
		offlineTidy := exec.Command("go", "mod", "tidy")
		offlineTidy.Dir = tmpDir
		offlineTidy.Env = append(os.Environ(), "GOPROXY=off", "GOSUMDB=off")
		if out2, err2 := offlineTidy.CombinedOutput(); err2 != nil {
			return false, fmt.Errorf("go mod tidy failed: %v, out: %s (offline retry: %v, %s)", err, string(out), err2, string(out2))
		}
	}

	// 2. go build
	buildCmd := exec.Command("go", "build", "-o", "server_bin", "./cmd/server")
	buildCmd.Dir = tmpDir
	if out, err := buildCmd.CombinedOutput(); err != nil {
		return false, fmt.Errorf("go build failed: %v, out: %s", err, string(out))
	}

	// 3. go vet
	vetCmd := exec.Command("go", "vet", "./...")
	vetCmd.Dir = tmpDir
	if out, err := vetCmd.CombinedOutput(); err != nil {
		return false, fmt.Errorf("go vet failed: %v, out: %s", err, string(out))
	}

	// 4. 运行内存 SQLite InitDB + AutoMigrate 冒烟测试
	testCmd := exec.Command("go", "test", "./internal/database")
	testCmd.Dir = tmpDir
	if out, err := testCmd.CombinedOutput(); err != nil {
		return false, fmt.Errorf("runtime InitDB smoke test failed: %v, out: %s", err, string(out))
	}

	return true, nil
}

// FormatMarkdownReport 将评测结果输出为 Markdown 报表格式
func FormatMarkdownReport(r *EvalReport) string {
	var sb strings.Builder
	mode := r.Mode
	if mode == "" {
		mode = "offline-deterministic"
	}
	posDenom := r.ClarificationPositives
	if posDenom == 0 {
		posDenom = r.ClarificationTotal
	}
	negDenom := r.ClarificationNegatives
	if negDenom == 0 {
		negDenom = r.ClarificationTotal
	}

	sb.WriteString("# ArchCanvas 基准质量评测报告\n\n")
	sb.WriteString(fmt.Sprintf("> 评测生成时间: %s | 运行模式: `%s` | 平均单场景耗时: `%d ms`\n\n", r.Timestamp, mode, r.AverageDurationMs))

	sb.WriteString("## 1. 核心指标概览\n\n")
	sb.WriteString("| 评测维度 | 测试样本量 | 达成指标 | 目标基线 | 状态 |\n")
	sb.WriteString("| :--- | :--- | :--- | :--- | :--- |\n")
	sb.WriteString(fmt.Sprintf("| **歧义检测漏判率** (FN Rate = FN / P) | %d 条正样本 (共 %d 条) | **%.2f%%** (%d/%d) | <= 5.0%% | %s |\n",
		posDenom, r.ClarificationTotal, r.FalseNegativeRate, r.FalseNegativeCount, posDenom, getStatusBadge(r.FalseNegativeRate <= 5.0)))
	sb.WriteString(fmt.Sprintf("| **歧义检测误判率** (FP Rate = FP / N) | %d 条负样本 (共 %d 条) | **%.2f%%** (%d/%d) | <= 10.0%% | %s |\n",
		negDenom, r.ClarificationTotal, r.FalsePositiveRate, r.FalsePositiveCount, negDenom, getStatusBadge(r.FalsePositiveRate <= 10.0)))
	sb.WriteString(fmt.Sprintf("| **物理建模规则通过率** | %d 个业务场景 | **%.2f%%** (%d/%d) | 100.0%% | %s |\n",
		r.ModelingTotal, r.RulePassRate, r.RulePassCount, r.ModelingTotal, getStatusBadge(r.RulePassRate >= 99.0)))
	sb.WriteString(fmt.Sprintf("| **端到端编译 + AutoMigrate 通过率** | %d 个生成项目 | **%.2f%%** (%d/%d) | 100.0%% | %s |\n\n",
		r.ModelingTotal, r.BuildSuccessRate, r.BuildSuccessCount, r.ModelingTotal, getStatusBadge(r.BuildSuccessRate >= 99.0)))

	sb.WriteString("## 2. 规则质检项覆盖说明\n\n")
	sb.WriteString("- [x] **主键与非空完整性**：每张实体表必须声明有效的非空物理主键（`IsPrimaryKey == true && !IsNullable`）\n")
	sb.WriteString("- [x] **端点引用与外键落地**：关系两端的源实体与目标实体必须合法存在，且 `1:N` / `1:1` 目标表自动落盘 `*_id` 外键列\n")
	sb.WriteString("- [x] **真实编译与静态分析验证**：生成工程在独立模块目录执行 `go mod tidy` + `go build ./cmd/server` + `go vet ./...` 零错误退出\n")
	sb.WriteString("- [x] **运行时数据库迁移冒烟**：生成的 `database.InitDB` 在内存 SQLite 上真实执行 `AutoMigrate` 并验证表创建成功\n")

	return sb.String()
}

func getStatusBadge(pass bool) string {
	if pass {
		return "PASS"
	}
	return "FAIL"
}
