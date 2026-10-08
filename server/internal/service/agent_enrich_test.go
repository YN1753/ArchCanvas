package service

import (
	"context"
	"testing"

	"archcanvas/internal/domain"
	"archcanvas/request"
)

func TestEnrichSemanticsRuleBased(t *testing.T) {
	agentSvc := &AgentService{}

	design := domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:   "ent_tenant",
				Name: "tenant",
				Attributes: []domain.Attribute{
					{ID: "attr_id", Name: "id", DBType: "BIGINT"},
					{ID: "attr_code", Name: "code", DBType: "VARCHAR(64)"},
				},
			},
			{
				ID:   "ent_position",
				Name: "position",
				Attributes: []domain.Attribute{
					{ID: "attr_pid", Name: "id", DBType: "BIGINT"},
					{ID: "attr_pname", Name: "name", DBType: "VARCHAR(64)"},
				},
			},
		},
		Relations: []domain.Relation{
			{
				ID:             "rel_1",
				SourceEntityID: "ent_tenant",
				TargetEntityID: "ent_position",
				Cardinality:    "one_to_many",
			},
		},
	}

	result, err := agentSvc.EnrichSemantics(context.Background(), request.EnrichSemanticsReq{
		Design: &design,
	})
	if err != nil {
		t.Fatalf("EnrichSemantics failed: %v", err)
	}

	if len(result.Design.Entities) != 2 {
		t.Fatalf("expected 2 entities, got %d", len(result.Design.Entities))
	}

	tenantEnt := result.Design.Entities[0]
	if tenantEnt.Comment != "租户" {
		t.Errorf("expected tenant comment '租户', got %q", tenantEnt.Comment)
	}

	posEnt := result.Design.Entities[1]
	if posEnt.Comment != "岗位" {
		t.Errorf("expected position comment '岗位', got %q", posEnt.Comment)
	}

	if len(result.ConceptualDesign.Concepts) != 2 {
		t.Fatalf("expected 2 concepts, got %d", len(result.ConceptualDesign.Concepts))
	}

	if result.ConceptualDesign.Concepts[0].DisplayName != "租户" {
		t.Errorf("expected concept DisplayName '租户', got %q", result.ConceptualDesign.Concepts[0].DisplayName)
	}
	if result.ConceptualDesign.Concepts[1].DisplayName != "岗位" {
		t.Errorf("expected concept DisplayName '岗位', got %q", result.ConceptualDesign.Concepts[1].DisplayName)
	}
}

func TestSanitizeConceptName(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"租户概念", "租户"},
		{"岗位信息表", "岗位"},
		{"用户数据表", "用户"},
		{"订单主表", "订单"},
		{"部门表", "部门"},
		{"租户", "租户"},
	}

	for _, tc := range cases {
		actual := sanitizeConceptName(tc.input)
		if actual != tc.expected {
			t.Errorf("sanitizeConceptName(%q) = %q, expected %q", tc.input, actual, tc.expected)
		}
	}
}
