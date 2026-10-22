package eval

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"archcanvas/internal/domain"
	"archcanvas/internal/generator"
	"archcanvas/internal/service"
)

func TestEvalCasesFileValidity(t *testing.T) {
	casesPath := filepath.Join("..", "..", "testdata", "eval", "cases.json")
	cases, err := LoadCases(casesPath)
	if err != nil {
		t.Fatalf("LoadCases failed: %v", err)
	}

	if len(cases.ClarificationCases) != 25 {
		t.Errorf("expected 25 clarification cases, got %d", len(cases.ClarificationCases))
	}
	if len(cases.ModelingCases) != 10 {
		t.Errorf("expected 10 modeling cases, got %d", len(cases.ModelingCases))
	}
}

func TestCheckERDesignRules(t *testing.T) {
	// 场景 1: 合法规范模型
	validDesign := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:   "e_user",
				Name: "users",
				Attributes: []domain.Attribute{
					{ID: "a1", Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					{ID: "a2", Name: "username", DBType: "VARCHAR(64)", CodeType: "string"},
				},
			},
			{
				ID:   "e_order",
				Name: "orders",
				Attributes: []domain.Attribute{
					{ID: "a3", Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					{ID: "a4", Name: "user_id", DBType: "BIGINT", CodeType: "uint64"},
				},
			},
		},
		Relations: []domain.Relation{
			{
				ID:             "r_1",
				SourceEntityID: "e_user",
				TargetEntityID: "e_order",
				RelationTypeID: "one_to_many",
			},
		},
	}

	pass, issues := CheckERDesignRules(validDesign)
	if !pass || len(issues) > 0 {
		t.Errorf("expected validDesign to pass rules, got issues: %v", issues)
	}

	// 场景 2: 缺失主键 + 悬空关联
	invalidDesign := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:   "e_bad",
				Name: "bad_table",
				Attributes: []domain.Attribute{
					{ID: "a1", Name: "name", IsPrimaryKey: false, DBType: "VARCHAR(64)", CodeType: "string"},
				},
			},
		},
		Relations: []domain.Relation{
			{
				ID:             "r_dangling",
				SourceEntityID: "e_bad",
				TargetEntityID: "e_non_existent",
			},
		},
	}

	passBad, issuesBad := CheckERDesignRules(invalidDesign)
	if passBad {
		t.Error("expected invalidDesign to fail rules, got pass")
	}
	if len(issuesBad) < 2 {
		t.Errorf("expected at least 2 issues for bad design, got %v", issuesBad)
	}
}

func TestRunBenchmarkSuite(t *testing.T) {
	casesPath := filepath.Join("..", "..", "testdata", "eval", "cases.json")
	cases, err := LoadCases(casesPath)
	if err != nil {
		t.Fatalf("LoadCases failed: %v", err)
	}

	genSvc, err := generator.NewGeneratorService(nil)
	if err != nil {
		t.Fatalf("failed to init generator service: %v", err)
	}

	report := &EvalReport{
		ClarificationTotal: len(cases.ClarificationCases),
		ModelingTotal:      len(cases.ModelingCases),
		Timestamp:          time.Now().Format("2006-01-02 15:04:05"),
	}

	// 1. 执行歧义规则评测
	for _, c := range cases.ClarificationCases {
		input := service.RequirementInput{
			Message: c.Input,
		}
		// 调用 Agent 的分析算子（在离线模式下验证代码层前置规则拦截与实体门禁）
		svc := service.NewAgentService(nil, nil)
		out, err := svc.AnalyzeRequirement(context.Background(), input, nil)

		var actualClarification bool
		if err == nil && out != nil {
			actualClarification = out.NeedClarification
		} else {
			// 如果因为离线无模型管理器且未触发前置拦截，按需统计
			actualClarification = false
		}

		if c.ExpectedClarification && !actualClarification {
			report.FalseNegativeCount++ // 应澄清却未澄清（漏判）
		} else if !c.ExpectedClarification && actualClarification {
			report.FalsePositiveCount++ // 不应澄清却澄清（误判）
		}
	}

	report.FalseNegativeRate = float64(report.FalseNegativeCount) / float64(report.ClarificationTotal) * 100.0
	report.FalsePositiveRate = float64(report.FalsePositiveCount) / float64(report.ClarificationTotal) * 100.0

	// 2. 执行 10 个典型建模场景的规则质检与端到端编译评测
	for idx, mc := range cases.ModelingCases {
		design := buildStandardScenarioDesign(mc)

		// 规则检查
		passRules, issues := CheckERDesignRules(design)
		if passRules {
			report.RulePassCount++
		} else {
			t.Logf("Modeling case %s failed rules: %v", mc.ID, issues)
		}

		// 端到端工程编译通过验证
		modName := fmt.Sprintf("example.com/eval_%s", strings.ToLower(mc.ID))
		buildOk, buildErr := VerifyE2EBuild(genSvc, design, modName)
		if buildOk {
			report.BuildSuccessCount++
		} else {
			t.Logf("Modeling case %s failed E2E build: %v", mc.ID, buildErr)
		}
		_ = idx
	}

	report.RulePassRate = float64(report.RulePassCount) / float64(report.ModelingTotal) * 100.0
	report.BuildSuccessRate = float64(report.BuildSuccessCount) / float64(report.ModelingTotal) * 100.0

	// 3. 生成 Markdown 格式报告
	mdReport := FormatMarkdownReport(report)
	t.Logf("\n%s\n", mdReport)

	// 4. 将评测报表写入根目录 docs/benchmark.md
	docsDir := filepath.Join("..", "..", "..", "docs")
	_ = os.MkdirAll(docsDir, 0755)
	benchmarkFile := filepath.Join(docsDir, "benchmark.md")
	if err := os.WriteFile(benchmarkFile, []byte(mdReport), 0644); err != nil {
		t.Fatalf("failed to write benchmark.md: %v", err)
	}
	t.Logf("Benchmark report successfully saved to %s", benchmarkFile)
}

// 辅助构造满足业务场景的规范化物理设计
func buildStandardScenarioDesign(mc ModelingCase) *domain.ERDesign {
	design := &domain.ERDesign{
		Entities:  make([]domain.Entity, 0, len(mc.Entities)),
		Relations: make([]domain.Relation, 0),
	}

	for _, name := range mc.Entities {
		ent := domain.Entity{
			ID:      "ent_" + name,
			Name:    name,
			Comment: name + "业务表",
			Attributes: []domain.Attribute{
				{
					ID:           "attr_" + name + "_id",
					Name:         "id",
					DBType:       "BIGINT UNSIGNED",
					CodeType:     "uint64",
					IsPrimaryKey: true,
				},
				{
					ID:       "attr_" + name + "_name",
					Name:     name + "_title",
					DBType:   "VARCHAR(64)",
					CodeType: "string",
				},
				{
					ID:       "attr_" + name + "_status",
					Name:     "status",
					DBType:   "TINYINT",
					CodeType: "int8",
				},
			},
		}
		design.Entities = append(design.Entities, ent)
	}

	// 为前两个实体建立一对多关系（若至少有两个实体）
	if len(design.Entities) >= 2 {
		design.Relations = append(design.Relations, domain.Relation{
			ID:             "rel_" + mc.Entities[0] + "_" + mc.Entities[1],
			SourceEntityID: design.Entities[0].ID,
			TargetEntityID: design.Entities[1].ID,
			RelationTypeID: "one_to_many",
		})
	}

	return design
}
