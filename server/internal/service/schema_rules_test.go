package service

import (
	"strings"
	"testing"

	"archcanvas/internal/domain"
)

func TestSchemaRules_MonetaryBalancePrecisionUnified(t *testing.T) {
	if !IsMonetaryColumnName("account_balance") {
		t.Fatalf("expected account_balance to be recognized as monetary column")
	}
	if IsMonetaryColumnName("login_count") {
		t.Fatalf("did not expect login_count to be recognized as monetary column")
	}

	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_wallet",
				Name:    "user_wallets",
				Comment: "用户钱包表",
				Attributes: []domain.Attribute{
					{ID: "a1", Name: "id", DBType: "BIGINT UNSIGNED", IsPrimaryKey: true},
					{ID: "a2", Name: "wallet_balance", DBType: "FLOAT"},
				},
			},
		},
	}

	report := EvaluateSchemaReview(design, "mysql")
	if report.Score != 92 {
		t.Fatalf("expected score 92 (-8 warning for FLOAT wallet_balance), got %d (issues: %+v)", report.Score, report.Issues)
	}
	if len(report.Issues) != 1 || report.Issues[0].ColumnName != "wallet_balance" {
		t.Fatalf("expected wallet_balance monetary precision issue, got %+v", report.Issues)
	}
}

func TestSchemaRules_DialectForbiddenTypes(t *testing.T) {
	t.Run("postgres flags TINYINT(1) and AUTO_INCREMENT", func(t *testing.T) {
		design := &domain.ERDesign{
			Entities: []domain.Entity{
				{
					ID:      "ent_accounts",
					Name:    "accounts",
					Comment: "账号表",
					Attributes: []domain.Attribute{
						{ID: "a1", Name: "id", DBType: "BIGINT AUTO_INCREMENT", IsPrimaryKey: true},
						{ID: "a2", Name: "is_active", DBType: "TINYINT(1)"},
					},
				},
			},
		}

		report := EvaluateSchemaReview(design, "postgresql")
		if len(report.Issues) != 2 {
			t.Fatalf("expected 2 dialect compatibility issues in postgres, got %d: %+v", len(report.Issues), report.Issues)
		}
		if report.Score != 84 {
			t.Fatalf("expected score 84, got %d", report.Score)
		}
	})

	t.Run("mysql flags SERIAL and JSONB", func(t *testing.T) {
		design := &domain.ERDesign{
			Entities: []domain.Entity{
				{
					ID:      "ent_events",
					Name:    "audit_events",
					Comment: "审计事件表",
					Attributes: []domain.Attribute{
						{ID: "a1", Name: "id", DBType: "BIGSERIAL", IsPrimaryKey: true},
						{ID: "a2", Name: "payload", DBType: "JSONB"},
					},
				},
			},
		}

		report := EvaluateSchemaReview(design, "mysql")
		if len(report.Issues) != 2 {
			t.Fatalf("expected 2 dialect compatibility issues in mysql, got %d: %+v", len(report.Issues), report.Issues)
		}
	})
}

func TestCheckSchemaGateRules(t *testing.T) {
	if pass, issues := CheckSchemaGateRules(nil); pass || len(issues) == 0 {
		t.Fatalf("expected nil design to fail gate rules")
	}

	nullablePKDesign := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:   "e1",
				Name: "users",
				Attributes: []domain.Attribute{
					{ID: "a1", Name: "id", DBType: "BIGINT", IsPrimaryKey: true, IsNullable: true},
				},
			},
			{
				ID:   "e2",
				Name: "orders",
				Attributes: []domain.Attribute{
					{ID: "a2", Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
				},
			},
		},
		Relations: []domain.Relation{
			{
				ID:             "r1",
				SourceEntityID: "e1",
				TargetEntityID: "e2",
				Cardinality:    "one_to_many",
			},
		},
	}

	pass, issues := CheckSchemaGateRules(nullablePKDesign)
	if pass {
		t.Fatalf("expected nullable PK + missing FK design to fail gate rules")
	}
	joined := strings.Join(issues, " | ")
	if !strings.Contains(joined, "Nullable") || !strings.Contains(joined, "缺少外键列") {
		t.Fatalf("expected both Nullable PK and missing FK gate messages, got: %v", issues)
	}
}
