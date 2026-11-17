package dialect

import "testing"

func TestRegistryLookupAliasesAndFallback(t *testing.T) {
	supported := Supported()
	if len(supported) != 3 {
		t.Fatalf("expected 3 registered dialects (mysql, postgres, sqlite), got %d", len(supported))
	}
	if supported[0].ID != "mysql" || supported[1].ID != "postgres" || supported[2].ID != "sqlite" {
		t.Fatalf("unexpected supported dialect order: %+v", supported)
	}

	aliasTests := []struct {
		input string
		want  string
	}{
		{"", "mysql"},
		{"unknown_db", "mysql"},
		{"MySQL", "mysql"},
		{"mariadb", "mysql"},
		{"postgres", "postgres"},
		{"PostgreSQL", "postgres"},
		{"PG", "postgres"},
		{"sqlite", "sqlite"},
		{"sqlite3", "sqlite"},
	}
	for _, tc := range aliasTests {
		if got := NormalizeID(tc.input); got != tc.want {
			t.Errorf("NormalizeID(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestForbiddenTypePatternsAndNormalization(t *testing.T) {
	pg := Get("postgres")
	if _, matched := pg.MatchForbiddenType("TINYINT(1)"); !matched {
		t.Error("expected TINYINT(1) to be flagged as forbidden in postgres")
	}
	if _, matched := pg.MatchForbiddenType("BIGINT AUTO_INCREMENT"); !matched {
		t.Error("expected AUTO_INCREMENT to be flagged as forbidden in postgres")
	}
	if got := pg.NormalizeGormType("bigint unsigned"); got != "bigint" {
		t.Errorf("pg.NormalizeGormType(bigint unsigned) = %q, want bigint", got)
	}

	my := Get("mysql")
	if _, matched := my.MatchForbiddenType("BIGSERIAL"); !matched {
		t.Error("expected BIGSERIAL to be flagged as forbidden in mysql")
	}
	if _, matched := my.MatchForbiddenType("JSONB"); !matched {
		t.Error("expected JSONB to be flagged as forbidden in mysql")
	}
	if _, matched := my.MatchForbiddenType("BIGINT UNSIGNED"); matched {
		t.Error("BIGINT UNSIGNED must be valid in mysql")
	}
}
