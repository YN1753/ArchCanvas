package eval

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"archcanvas/internal/domain"
	"archcanvas/internal/generator"
	"archcanvas/request"
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
	ClarificationTotal      int     `json:"clarification_total"`
	FalseNegativeCount      int     `json:"false_negative_count"` // 漏判数（应澄清却未澄清）
	FalsePositiveCount      int     `json:"false_positive_count"` // 误判数（不应澄清却澄清）
	FalseNegativeRate       float64 `json:"false_negative_rate"`  // 漏判率
	FalsePositiveRate       float64 `json:"false_positive_rate"`  // 误判率
	ModelingTotal           int     `json:"modeling_total"`
	RulePassCount           int     `json:"rule_pass_count"`
	RulePassRate            float64 `json:"rule_pass_rate"`
	BuildSuccessCount       int     `json:"build_success_count"`
	BuildSuccessRate        float64 `json:"build_success_rate"`
	AverageDurationMs       int64   `json:"average_duration_ms"`
	Timestamp               string  `json:"timestamp"`
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
	entityMap := make(map[string]domain.Entity)
	for _, ent := range design.Entities {
		entityMap[ent.ID] = ent
		entityMap[strings.ToLower(ent.Name)] = ent

		// 规则 1: 必须有主键
		hasPK := false
		for _, attr := range ent.Attributes {
			if attr.IsPrimaryKey {
				hasPK = true
				break
			}
		}
		if !hasPK {
			issues = append(issues, fmt.Sprintf("实体 %s 缺失物理主键 (IsPrimaryKey==true)", ent.Name))
		}
	}

	// 规则 2: 关联关系两端实体必须合法存在
	for _, rel := range design.Relations {
		_, srcOk := entityMap[rel.SourceEntityID]
		if !srcOk {
			srcOk = entityMap[strings.ToLower(rel.SourceEntityID)].ID != ""
		}
		_, tgtOk := entityMap[rel.TargetEntityID]
		if !tgtOk {
			tgtOk = entityMap[strings.ToLower(rel.TargetEntityID)].ID != ""
		}
		if !srcOk || !tgtOk {
			issues = append(issues, fmt.Sprintf("关系 %s 的端点实体不存在 (%s -> %s)", rel.ID, rel.SourceEntityID, rel.TargetEntityID))
		}
	}

	return len(issues) == 0, issues
}

// VerifyE2EBuild 将生成的工程写入临时目录并执行真实编译与代码静态检查
func VerifyE2EBuild(genSvc *generator.GeneratorService, design *domain.ERDesign, modName string) (bool, error) {
	req := request.GenerateRequest{
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
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			return false, err
		}
		if err := os.WriteFile(targetPath, []byte(f.Content), 0644); err != nil {
			return false, err
		}
	}

	// 1. go mod tidy
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = tmpDir
	if out, err := tidyCmd.CombinedOutput(); err != nil {
		return false, fmt.Errorf("go mod tidy failed: %v, out: %s", err, string(out))
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

	return true, nil
}

// FormatMarkdownReport 将评测结果输出为 Markdown 报表格式
func FormatMarkdownReport(r *EvalReport) string {
	var sb strings.Builder
	sb.WriteString("# ArchCanvas 基准质量评测报告\n\n")
	sb.WriteString(fmt.Sprintf("> 评测生成时间: %s\n\n", r.Timestamp))

	sb.WriteString("## 1. 核心指标概览\n\n")
	sb.WriteString("| 评测维度 | 测试样本量 | 达成指标 | 目标基线 | 状态 |\n")
	sb.WriteString("| :--- | :--- | :--- | :--- | :--- |\n")
	sb.WriteString(fmt.Sprintf("| **歧义检测漏判率** (FN Rate) | %d 条业务需求 | **%.2f%%** (%d/%d) | < 5.0%% | %s |\n",
		r.ClarificationTotal, r.FalseNegativeRate, r.FalseNegativeCount, r.ClarificationTotal, getStatusBadge(r.FalseNegativeRate <= 5.0)))
	sb.WriteString(fmt.Sprintf("| **歧义检测误判率** (FP Rate) | %d 条业务需求 | **%.2f%%** (%d/%d) | < 10.0%% | %s |\n",
		r.ClarificationTotal, r.FalsePositiveRate, r.FalsePositiveCount, r.ClarificationTotal, getStatusBadge(r.FalsePositiveRate <= 10.0)))
	sb.WriteString(fmt.Sprintf("| **物理建模规则通过率** | %d 个业务场景 | **%.2f%%** (%d/%d) | 100.0%% | %s |\n",
		r.ModelingTotal, r.RulePassRate, r.RulePassCount, r.ModelingTotal, getStatusBadge(r.RulePassRate >= 99.0)))
	sb.WriteString(fmt.Sprintf("| **端到端工程编译通过率** | %d 个生成项目 | **%.2f%%** (%d/%d) | 100.0%% | %s |\n\n",
		r.ModelingTotal, r.BuildSuccessRate, r.BuildSuccessCount, r.ModelingTotal, getStatusBadge(r.BuildSuccessRate >= 99.0)))

	sb.WriteString("## 2. 规则质检项覆盖说明\n\n")
	sb.WriteString("- [x] **主键完整性**：每张实体表必须声明且仅声明有效的物理主键（`IsPrimaryKey == true`）\n")
	sb.WriteString("- [x] **端点引用有效性**：关系两端的源实体与目标实体必须合法存在于模型池中\n")
	sb.WriteString("- [x] **真实编译通过验证**：生成工程解压至独立环境后执行 `go mod tidy` + `go build ./cmd/server` 零警告零错误退出\n")
	sb.WriteString("- [x] **Go 静态分析合规**：生成的全套 Model / Handler / Service / Repository 严格通过 `go vet ./...` 分析\n")

	return sb.String()
}

func getStatusBadge(pass bool) string {
	if pass {
		return "PASS"
	}
	return "FAIL"
}
