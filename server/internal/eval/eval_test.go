package eval

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"archcanvas/internal/agent"
	"archcanvas/internal/config"
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
	// 场景 1: 合法规范模型（含外键列）
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
				Cardinality:    "one_to_many",
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
				Cardinality:    "one_to_many",
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

	mode := "offline-deterministic"
	var modelMgr *agent.ModelManager
	if os.Getenv("ARCHCANVAS_LIVE_EVAL") == "1" {
		cfgDir := filepath.Join("..", "..", "configs")
		if cfg, err := config.LoadWithError(cfgDir); err == nil {
			modelMgr = agent.NewModelManager(context.Background(), cfg.Agent.Models, cfg.Agent.DefaultModelProvider, cfgDir)
			mode = "live-llm"
		}
	}
	agentSvc := service.NewAgentService(modelMgr, nil)

	report := &EvalReport{
		Mode:               mode,
		ClarificationTotal: len(cases.ClarificationCases),
		ModelingTotal:      len(cases.ModelingCases),
		Timestamp:          time.Now().Format("2006-01-02 15:04:05"),
	}

	// 1. 执行歧义规则评测（精确区分正样本 P = TP+FN 与负样本 N = TN+FP）
	for _, c := range cases.ClarificationCases {
		if c.ExpectedClarification {
			report.ClarificationPositives++
		} else {
			report.ClarificationNegatives++
		}

		input := service.RequirementInput{
			Message: c.Input,
		}
		out, err := agentSvc.AnalyzeRequirement(context.Background(), input, nil)

		var actualClarification bool
		if err == nil && out != nil {
			actualClarification = out.NeedClarification
		} else {
			// 离线确定性模式下：通过前置门禁放行后因无外部 LLM 返回错误，说明门禁未将其拦截为歧义输入
			actualClarification = false
		}

		if c.ExpectedClarification && !actualClarification {
			report.FalseNegativeCount++ // 应澄清却未澄清（漏判 FN）
		} else if !c.ExpectedClarification && actualClarification {
			report.FalsePositiveCount++ // 不应澄清却澄清（误判 FP）
		}
	}

	if report.ClarificationPositives > 0 {
		report.FalseNegativeRate = float64(report.FalseNegativeCount) / float64(report.ClarificationPositives) * 100.0
	}
	if report.ClarificationNegatives > 0 {
		report.FalsePositiveRate = float64(report.FalsePositiveCount) / float64(report.ClarificationNegatives) * 100.0
	}

	// 2. 执行 10 个典型建模场景：真实调用 DerivePhysicalSchema（含 1:N 外键注入与 M:N 中间表扩容生成）+ 编译 + 内存 SQLite AutoMigrate 验证
	var totalDurationMs int64
	for _, mc := range cases.ModelingCases {
		caseStart := time.Now()
		conceptual := buildConceptualScenario(mc)

		design, err := agentSvc.DerivePhysicalSchema(context.Background(), service.DerivePhysicalInput{
			ConceptualDesign: conceptual,
			Dialect:          "sqlite",
		}, nil)
		if err != nil {
			t.Fatalf("DerivePhysicalSchema failed for %s: %v", mc.ID, err)
		}

		// 规则检查（主键、关系端点、外键列落地）
		passRules, issues := CheckERDesignRules(design)
		if passRules {
			report.RulePassCount++
		} else {
			t.Logf("Modeling case %s failed rules: %v", mc.ID, issues)
		}

		// 端到端工程编译 + go vet + 内存 SQLite InitDB AutoMigrate 验证
		modName := fmt.Sprintf("example.com/eval_%s", strings.ToLower(mc.ID))
		buildOk, buildErr := VerifyE2EBuild(genSvc, design, modName)
		if buildOk {
			report.BuildSuccessCount++
		} else {
			t.Logf("Modeling case %s failed E2E build/migrate: %v", mc.ID, buildErr)
		}

		totalDurationMs += time.Since(caseStart).Milliseconds()
	}

	if report.ModelingTotal > 0 {
		report.RulePassRate = float64(report.RulePassCount) / float64(report.ModelingTotal) * 100.0
		report.BuildSuccessRate = float64(report.BuildSuccessCount) / float64(report.ModelingTotal) * 100.0
		report.AverageDurationMs = totalDurationMs / int64(report.ModelingTotal)
	}

	// 3. 生成 Markdown 格式报告
	mdReport := FormatMarkdownReport(report)
	t.Logf("\n%s\n", mdReport)

	// 4. 仅在显式开启 UPDATE_BENCHMARK=1 时更新仓库 docs/benchmark.md，防止常规 go test 污染 Git 工作区
	if os.Getenv("UPDATE_BENCHMARK") == "1" {
		docsDir := filepath.Join("..", "..", "..", "docs")
		_ = os.MkdirAll(docsDir, 0o755)
		benchmarkFile := filepath.Join(docsDir, "benchmark.md")
		if err := os.WriteFile(benchmarkFile, []byte(mdReport), 0o644); err != nil {
			t.Fatalf("failed to write benchmark.md: %v", err)
		}
		t.Logf("Benchmark report successfully saved to %s", benchmarkFile)
	}

	// 5. 质量回归阻断门禁校验 (AI Benchmark Regression Gate)
	if report.FalseNegativeRate > 0.0 {
		t.Errorf("[Regression Gate Failed] 需求澄清漏判率超过 0%% 基线: 实际为 %.2f%% (%d/%d 处漏判)",
			report.FalseNegativeRate, report.FalseNegativeCount, report.ClarificationPositives)
	}
	if report.FalsePositiveRate > 5.0 {
		t.Errorf("[Regression Gate Failed] 需求澄清误判率超过 5%% 容忍阈值: 实际为 %.2f%% (%d/%d 处误判)",
			report.FalsePositiveRate, report.FalsePositiveCount, report.ClarificationNegatives)
	}
	if report.RulePassRate < 100.0 {
		t.Errorf("[Regression Gate Failed] 物理建模规则通过率低于 100%% 基线: 实际为 %.2f%%",
			report.RulePassRate)
	}
	if report.BuildSuccessRate < 100.0 {
		t.Errorf("[Regression Gate Failed] 端到端生成项目编译与迁移通过率低于 100%% 基线: 实际为 %.2f%%",
			report.BuildSuccessRate)
	}
}

// buildConceptualScenario 将典型业务场景转化为 Layer 1 概念模型（覆盖 1:N 与 M:N 关联），交由真实物理推导引擎生成表、外键、索引与中间表。
func buildConceptualScenario(mc ModelingCase) *domain.ConceptualDesign {
	concepts := make([]domain.BusinessConcept, 0, len(mc.Entities))
	for _, name := range mc.Entities {
		concepts = append(concepts, domain.BusinessConcept{
			ID:          "concept_" + name,
			Name:        name,
			DisplayName: name + "实体",
			Description: mc.Name + "中的" + name,
			Operation:   domain.OpCreate,
			Attributes: []domain.ConceptAttribute{
				{
					Name:          name + "_code",
					DisplayName:   "业务编码",
					Category:      domain.AttrString,
					IsBusinessKey: true,
					Required:      true,
					IsUnique:      true,
				},
				{
					Name:        "title",
					DisplayName: "名称标题",
					Category:    domain.AttrString,
					Required:    true,
				},
				{
					Name:             "status",
					DisplayName:      "业务状态",
					Category:         domain.AttrEnum,
					Required:         true,
					EnumValueOptions: []string{"active", "archived"},
				},
			},
		})
	}

	relations := make([]domain.ConceptRelation, 0, 2)
	if len(concepts) >= 2 {
		relations = append(relations, domain.ConceptRelation{
			ID:            "crel_1n_" + mc.ID,
			Name:          "拥有",
			SourceConcept: concepts[0].Name,
			TargetConcept: concepts[1].Name,
			Cardinality:   domain.CardOneToMany,
		})
	}
	if len(concepts) >= 3 {
		// 同时注入一条多对多关系，真实压测物理推导引擎的中间表生成与底层切片扩容安全性
		relations = append(relations, domain.ConceptRelation{
			ID:            "crel_mn_" + mc.ID,
			Name:          "关联",
			SourceConcept: concepts[0].Name,
			TargetConcept: concepts[2].Name,
			Cardinality:   domain.CardManyToMany,
		})
	}

	return &domain.ConceptualDesign{
		Summary:   mc.Input,
		Concepts:  concepts,
		Relations: relations,
	}
}
