package llmjson

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
)

var codeBlockRegex = regexp.MustCompile("(?s)```(?:json|JSON)?\\s*(.*?)\\s*```")

// ExtractBalancedJSONObjects scans text with arbitrary natural-language preamble/epilogue and extracts
// balanced top-level {...} JSON objects. Quotes are only tracked after entering depth > 0 so stray quotes
// in natural language preamble never corrupt extraction.
func ExtractBalancedJSONObjects(content string) []string {
	return extractBalancedByDelimiters(content, '{', '}')
}

// ExtractBalancedJSONArrays scans text and extracts balanced top-level [...] JSON arrays.
func ExtractBalancedJSONArrays(content string) []string {
	return extractBalancedByDelimiters(content, '[', ']')
}

func extractBalancedByDelimiters(content string, openCh, closeCh rune) []string {
	var items []string
	runes := []rune(content)
	n := len(runes)

	inString := false
	escaped := false
	depth := 0
	startIdx := -1

	for i := 0; i < n; i++ {
		ch := runes[i]

		if depth == 0 {
			if ch == openCh {
				startIdx = i
				depth = 1
			}
			continue
		}

		if inString {
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
			continue
		}

		if ch == '"' {
			inString = true
			continue
		}

		if ch == openCh {
			depth++
		} else if ch == closeCh {
			depth--
			if depth == 0 && startIdx != -1 {
				item := strings.TrimSpace(string(runes[startIdx : i+1]))
				items = append(items, item)
				startIdx = -1
			}
		}
	}

	return items
}

// CleanSyntax strips JS-style // line comments, /* */ block comments, and trailing commas before } or ]
// without mutating string literals.
func CleanSyntax(raw string) string {
	var noComments strings.Builder
	noComments.Grow(len(raw))
	r0 := []rune(raw)
	inStr := false
	esc := false
	for i := 0; i < len(r0); i++ {
		ch := r0[i]
		if inStr {
			noComments.WriteRune(ch)
			if esc {
				esc = false
			} else if ch == '\\' {
				esc = true
			} else if ch == '"' {
				inStr = false
			}
			continue
		}
		if ch == '"' {
			inStr = true
			noComments.WriteRune(ch)
			continue
		}
		if ch == '/' && i+1 < len(r0) && r0[i+1] == '/' {
			i += 2
			for i < len(r0) && r0[i] != '\n' {
				i++
			}
			if i < len(r0) {
				noComments.WriteRune('\n')
			}
			continue
		}
		if ch == '/' && i+1 < len(r0) && r0[i+1] == '*' {
			i += 2
			for i+1 < len(r0) && !(r0[i] == '*' && r0[i+1] == '/') {
				i++
			}
			i++
			continue
		}
		noComments.WriteRune(ch)
	}

	var sb strings.Builder
	runes := []rune(noComments.String())
	sb.Grow(len(runes))
	inString := false
	escaped := false
	n := len(runes)

	for i := 0; i < n; i++ {
		ch := runes[i]

		if inString {
			sb.WriteRune(ch)
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
			continue
		}

		if ch == '"' {
			inString = true
			sb.WriteRune(ch)
			continue
		}

		if ch == ',' {
			j := i + 1
			for j < n && (runes[j] == ' ' || runes[j] == '\t' || runes[j] == '\r' || runes[j] == '\n') {
				j++
			}
			if j < n && (runes[j] == '}' || runes[j] == ']') {
				continue
			}
		}

		sb.WriteRune(ch)
	}

	return strings.TrimSpace(sb.String())
}

// ExtractCandidates collects candidate JSON payloads from fenced code blocks, balanced objects, balanced arrays, and raw text.
func ExtractCandidates(content string) []string {
	var candidates []string
	seen := make(map[string]bool)

	addCandidate := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		candidates = append(candidates, s)
	}

	matches := codeBlockRegex.FindAllStringSubmatch(content, -1)
	for _, m := range matches {
		if len(m) > 1 {
			block := strings.TrimSpace(m[1])
			if block != "" {
				addCandidate(block)
				for _, obj := range ExtractBalancedJSONObjects(block) {
					addCandidate(obj)
				}
				for _, arr := range ExtractBalancedJSONArrays(block) {
					addCandidate(arr)
				}
			}
		}
	}

	for _, obj := range ExtractBalancedJSONObjects(content) {
		addCandidate(obj)
	}
	for _, arr := range ExtractBalancedJSONArrays(content) {
		addCandidate(arr)
	}

	trimmed := strings.TrimSpace(content)
	if trimmed != "" {
		addCandidate(trimmed)
	}

	return candidates
}

// Parse extracts, repairs if necessary, unmarshals, and validates structured JSON of type T from raw LLM output.
func Parse[T any](raw string, validate func(*T) error) (*T, error) {
	candidates := ExtractCandidates(raw)
	if len(candidates) == 0 {
		return nil, errors.New("empty LLM JSON output")
	}

	var lastValidationErr error
	var lastSyntaxErr error

	tryOne := func(payload string) (*T, bool) {
		var out T
		if err := json.Unmarshal([]byte(payload), &out); err != nil {
			lastSyntaxErr = err
			return nil, false
		}
		if validate != nil {
			if vErr := validate(&out); vErr != nil {
				lastValidationErr = vErr
				return nil, false
			}
		}
		return &out, true
	}

	for _, cand := range candidates {
		if res, ok := tryOne(cand); ok {
			return res, nil
		}
		cleaned := CleanSyntax(cand)
		if cleaned != cand {
			if res, ok := tryOne(cleaned); ok {
				return res, nil
			}
		}
	}

	if lastValidationErr != nil {
		return nil, lastValidationErr
	}
	if lastSyntaxErr != nil {
		return nil, lastSyntaxErr
	}
	return nil, errors.New("cannot parse structured JSON")
}
