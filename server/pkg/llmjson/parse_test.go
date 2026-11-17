package llmjson

import (
	"errors"
	"strings"
	"testing"
)

type sampleDoc struct {
	Summary string   `json:"summary"`
	Items   []string `json:"items"`
}

func TestParse_ObjectCodeFenceCommentsAndTrailingCommas(t *testing.T) {
	raw := "思考前言（含孤立引号 \"test）：\n```json\n{\n  // 行注释\n  \"summary\": \"http://example.com, } ok\",\n  /* 块注释 */\n  \"items\": [\"users\", \"orders\",],\n}\n```\n尾部说明"

	got, err := Parse[sampleDoc](raw, func(d *sampleDoc) error {
		if len(d.Items) == 0 {
			return errors.New("items required")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	if got.Summary != "http://example.com, } ok" || len(got.Items) != 2 {
		t.Fatalf("unexpected parsed result: %+v", got)
	}
}

func TestParse_BalancedArrayExtraction(t *testing.T) {
	raw := "模型列表如下：\n[\"gpt-4o\", \"deepseek-r1\",]\n以上。"
	got, err := Parse[[]string](raw, func(arr *[]string) error {
		if len(*arr) == 0 {
			return errors.New("empty array")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Parse array failed: %v", err)
	}
	if len(*got) != 2 || (*got)[0] != "gpt-4o" || (*got)[1] != "deepseek-r1" {
		t.Fatalf("unexpected array: %+v", *got)
	}
}

func TestParse_SkipsInvalidFirstCandidateAndReturnsValidSecond(t *testing.T) {
	raw := `示例空对象: {"summary": "hollow", "items": []} 真实结果: {"summary": "valid", "items": ["users"]}`
	got, err := Parse[sampleDoc](raw, func(d *sampleDoc) error {
		if len(d.Items) == 0 {
			return errors.New("items cannot be empty")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected second candidate to succeed, got err: %v", err)
	}
	if got.Summary != "valid" || len(got.Items) != 1 {
		t.Fatalf("unexpected parsed doc: %+v", got)
	}
}

func TestParse_PropagatesValidationErrorOverSyntaxNoise(t *testing.T) {
	raw := `{"summary": "only summary", "items": []}`
	_, err := Parse[sampleDoc](raw, func(d *sampleDoc) error {
		if len(d.Items) == 0 {
			return errors.New("validation: items must not be empty")
		}
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "items must not be empty") {
		t.Fatalf("expected validation error message, got: %v", err)
	}
}
