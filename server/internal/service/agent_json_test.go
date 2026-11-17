package service

import (
	"strings"
	"testing"
)

func TestExtractBalancedJSONObjects(t *testing.T) {
	t.Run("extracts pure JSON object", func(t *testing.T) {
		input := `{"name": "test", "value": 123}`
		objs := ExtractBalancedJSONObjects(input)
		if len(objs) != 1 {
			t.Fatalf("expected 1 object, got %d", len(objs))
		}
		if objs[0] != input {
			t.Errorf("expected %s, got %s", input, objs[0])
		}
	})

	t.Run("extracts object even when preamble contains unmatched double quote", func(t *testing.T) {
		input := "用户表示需要一个\"订单模块：\n{\"summary\": \"测试系统\", \"concepts\": []}\n祝您使用愉快！"
		objs := ExtractBalancedJSONObjects(input)
		if len(objs) != 1 {
			t.Fatalf("expected 1 object despite unmatched quote in preamble, got %d", len(objs))
		}
		expected := `{"summary": "测试系统", "concepts": []}`
		if objs[0] != expected {
			t.Errorf("expected %s, got %s", expected, objs[0])
		}
	})

	t.Run("handles nested braces and strings containing braces and quotes", func(t *testing.T) {
		input := `前言 {"comment": "含 {大括号} 说明", "nested": {"key": "val \"with quotes\" and } brace"}} 结语`
		objs := ExtractBalancedJSONObjects(input)
		if len(objs) != 1 {
			t.Fatalf("expected 1 object, got %d", len(objs))
		}
		expected := `{"comment": "含 {大括号} 说明", "nested": {"key": "val \"with quotes\" and } brace"}}`
		if objs[0] != expected {
			t.Errorf("expected %s, got %s", expected, objs[0])
		}
	})

	t.Run("extracts multiple distinct objects", func(t *testing.T) {
		input := `示例1: {"id": 1} 以及示例2: {"id": 2}`
		objs := ExtractBalancedJSONObjects(input)
		if len(objs) != 2 {
			t.Fatalf("expected 2 objects, got %d", len(objs))
		}
		if objs[0] != `{"id": 1}` || objs[1] != `{"id": 2}` {
			t.Errorf("unexpected extracted objects: %v", objs)
		}
	})
}

func TestCleanJSONSyntax(t *testing.T) {
	t.Run("removes trailing commas and inline comments while preserving strings", func(t *testing.T) {
		input := "{\n  // 单行注释\n  \"note\": \"http://example.com, } world\",\n  /* 块注释 */\n  \"items\": [\"a, ] b\",],\n}"
		cleaned := CleanJSONSyntax(input)
		if strings.Contains(cleaned, "// 单行注释") || strings.Contains(cleaned, "/* 块注释 */") {
			t.Errorf("comments were not stripped: %s", cleaned)
		}
		if !strings.Contains(cleaned, `"http://example.com, } world"`) {
			t.Errorf("URL inside string literal was corrupted: %s", cleaned)
		}
	})
}

func TestTryParseRequirementJSON(t *testing.T) {
	t.Run("parses standard markdown json block", func(t *testing.T) {
		input := "```json\n{\n  \"summary\": \"商城系统\",\n  \"concepts\": [\n    {\"name\": \"用户\"}\n  ]\n}\n```"
		out, err := tryParseRequirementJSON(input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if out.Summary != "商城系统" || len(out.Concepts) != 1 || out.Concepts[0].Name != "用户" {
			t.Errorf("unexpected parsed output: %+v", out)
		}
	})

	t.Run("rejects hollow JSON containing only summary without concepts or clarification", func(t *testing.T) {
		input := `{"summary": "空壳摘要", "concepts": [], "need_clarification": false}`
		if _, err := tryParseRequirementJSON(input); err == nil {
			t.Fatal("expected error for hollow RequirementOutput JSON with 0 concepts and need_clarification=false")
		}
	})
}

func TestTryParseSchemaJSON(t *testing.T) {
	t.Run("parses ER design attributes and preserves self-referencing relations", func(t *testing.T) {
		input := `
好的，这是为您设计的物理表方案：
{
  "entities": [
    {
      "id": "e_dept",
      "name": "departments",
      "attributes": [
        {"id": "f_id", "name": "id", "db_type": "BIGINT", "code_type": "int64", "is_primary_key": true},
        {"id": "f_pid", "name": "parent_id", "db_type": "BIGINT", "code_type": "int64"}
      ]
    }
  ],
  "relations": [
    {
      "id": "rel_self",
      "source_entity_id": "e_dept",
      "target_entity_id": "e_dept",
      "cardinality": "1:N"
    }
  ],
}
祝工作顺利！`
		out, err := tryParseSchemaJSON(input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(out.Entities) != 1 || out.Entities[0].Name != "departments" {
			t.Fatalf("unexpected entities: %+v", out.Entities)
		}
		if len(out.Entities[0].Attributes) != 2 || !out.Entities[0].Attributes[0].IsPrimaryKey {
			t.Fatalf("expected 2 parsed attributes with PK, got: %+v", out.Entities[0].Attributes)
		}
		if len(out.Relations) != 1 {
			t.Fatalf("expected 1 relation, got %d", len(out.Relations))
		}
		rel := out.Relations[0]
		if rel.SourceEntityID != "e_dept" || rel.TargetEntityID != "e_dept" || rel.Cardinality != "1:N" {
			t.Errorf("unexpected self relation: %+v", rel)
		}
	})

	t.Run("rejects 0-attribute hollow entities", func(t *testing.T) {
		input := `{"entities": [{"id": "e1", "name": "users", "attributes": []}], "relations": []}`
		if _, err := tryParseSchemaJSON(input); err == nil {
			t.Fatal("expected error for 0-attribute entity")
		}
	})
}
