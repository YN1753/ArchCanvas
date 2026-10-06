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

	t.Run("extracts object surrounded by preamble and postscript", func(t *testing.T) {
		input := "您好，为您设计的概念如下：\n{\"summary\": \"测试系统\", \"concepts\": []}\n祝您使用愉快！"
		objs := ExtractBalancedJSONObjects(input)
		if len(objs) != 1 {
			t.Fatalf("expected 1 object, got %d", len(objs))
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
	t.Run("removes trailing commas before closing braces and brackets", func(t *testing.T) {
		input := `{"name": "user", "tags": ["admin", "staff",],}`
		expected := `{"name": "user", "tags": ["admin", "staff"]}`
		got := CleanJSONSyntax(input)
		if got != expected {
			t.Errorf("expected %s, got %s", expected, got)
		}
	})

	t.Run("preserves commas inside string literals", func(t *testing.T) {
		input := `{"note": "hello, } world", "items": ["a, ] b",],}`
		expected := `{"note": "hello, } world", "items": ["a, ] b"]}`
		got := CleanJSONSyntax(input)
		if got != expected {
			t.Errorf("expected %s, got %s", expected, got)
		}
	})

	t.Run("handles multiline trailing commas", func(t *testing.T) {
		input := "{\n  \"key1\": \"val1\",\n  \"key2\": \"val2\",\n}"
		cleaned := CleanJSONSyntax(input)
		if strings.Contains(cleaned, `"val2",`) {
			t.Errorf("trailing comma was not removed: %s", cleaned)
		}
		if !strings.Contains(cleaned, `"val2"`) {
			t.Errorf("content corrupted: %s", cleaned)
		}
	})
}

func TestTryParseRequirementJSON(t *testing.T) {
	t.Run("parses standard markdown json block", func(t *testing.T) {
		input := "```json\n{\n  \"summary\": \"商城系统\",\n  \"concepts\": [\n    {\"name\": \"用户\", \"type\": \"entity\"}\n  ]\n}\n```"
		out, err := tryParseRequirementJSON(input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if out.Summary != "商城系统" {
			t.Errorf("expected summary 商城系统, got %s", out.Summary)
		}
		if len(out.Concepts) != 1 || out.Concepts[0].Name != "用户" {
			t.Errorf("unexpected concepts: %+v", out.Concepts)
		}
	})

	t.Run("parses conversational response without markdown tags", func(t *testing.T) {
		input := "好的，为您分析的需求如下：\n{\n  \"summary\": \"博客系统\",\n  \"concepts\": [{\"name\": \"文章\"}]\n}\n请查看以上内容！"
		out, err := tryParseRequirementJSON(input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if out.Summary != "博客系统" {
			t.Errorf("expected summary 博客系统, got %s", out.Summary)
		}
		if len(out.Concepts) != 1 {
			t.Fatalf("expected 1 concept, got %d", len(out.Concepts))
		}
	})

	t.Run("recovers from trailing commas in JSON response", func(t *testing.T) {
		input := "```\n{\n  \"summary\": \"CRM系统\",\n  \"concepts\": [\n    {\"name\": \"线索\",},\n  ],\n}\n```"
		out, err := tryParseRequirementJSON(input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if out.Summary != "CRM系统" {
			t.Errorf("expected summary CRM系统, got %s", out.Summary)
		}
		if len(out.Concepts) != 1 || out.Concepts[0].Name != "线索" {
			t.Errorf("unexpected concepts: %+v", out.Concepts)
		}
	})
}

func TestTryParseSchemaJSON(t *testing.T) {
	t.Run("parses ER design and preserves self-referencing relations", func(t *testing.T) {
		input := `
好的，这是为您设计的物理表方案：
{
  "entities": [
    {
      "id": "e_dept",
      "name": "departments",
      "fields": [
        {"id": "f_id", "name": "id", "type": "bigint", "is_pk": true},
        {"id": "f_pid", "name": "parent_id", "type": "bigint"}
      ]
    }
  ],
  "relations": [
    {
      "id": "rel_self",
      "name": "parent_department",
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
		// 校验自引用关系被完整保留，未被误过滤
		if len(out.Relations) != 1 {
			t.Fatalf("expected 1 relation, got %d", len(out.Relations))
		}
		rel := out.Relations[0]
		if rel.SourceEntityID != "e_dept" || rel.TargetEntityID != "e_dept" {
			t.Errorf("expected self relation between e_dept, got %s -> %s", rel.SourceEntityID, rel.TargetEntityID)
		}
		if rel.Cardinality != "1:N" {
			t.Errorf("expected cardinality 1:N, got %s", rel.Cardinality)
		}
	})
}
