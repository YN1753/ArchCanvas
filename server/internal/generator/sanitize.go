package generator

import (
	"fmt"
	"path"
	"strconv"
	"strings"
	"unicode"

	"archcanvas/pkg/naming"
)

// goKeywords contains Go reserved keywords and predeclared identifiers that cannot be used bare as local variable names.
var goKeywords = map[string]bool{
	"break": true, "default": true, "func": true, "interface": true, "select": true,
	"case": true, "defer": true, "go": true, "map": true, "struct": true,
	"chan": true, "else": true, "goto": true, "package": true, "switch": true,
	"const": true, "fallthrough": true, "if": true, "range": true, "type": true,
	"continue": true, "for": true, "import": true, "return": true, "var": true,
	"any": true, "bool": true, "byte": true, "comparable": true, "error": true,
	"float32": true, "float64": true, "int": true, "int8": true, "int16": true,
	"int32": true, "int64": true, "len": true, "make": true, "new": true,
	"nil": true, "panic": true, "rune": true, "string": true, "true": true, "false": true,
	"uint": true, "uint8": true, "uint16": true, "uint32": true, "uint64": true,
}

func isASCIIUpper(r rune) bool {
	return r >= 'A' && r <= 'Z'
}

func isASCIILower(r rune) bool {
	return r >= 'a' && r <= 'z'
}

func sanitizeSingleLineComment(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}

func sanitizeStructTagValue(s string) string {
	s = strings.ReplaceAll(s, "`", "")
	s = strings.ReplaceAll(s, `"`, "")
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}

func sanitizeColumnIdentifier(raw string) string {
	s := sanitizeStructTagValue(raw)
	s = strings.ReplaceAll(s, ";", "")
	if s == "" {
		return "col"
	}
	return s
}

// cleanSafeZipPath validates generated archive paths to block Zip Slip directory traversal attacks.
func cleanSafeZipPath(rawPath string) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(rawPath), "\\", "/")
	if normalized == "" || strings.HasPrefix(normalized, "/") || strings.Contains(normalized, ":") {
		return "", fmt.Errorf("unsafe archive file path: %q", rawPath)
	}
	for _, seg := range strings.Split(normalized, "/") {
		if seg == ".." || seg == "." || seg == "" {
			return "", fmt.Errorf("path traversal segment detected in %q", rawPath)
		}
	}
	cleaned := path.Clean(normalized)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
		return "", fmt.Errorf("unsafe cleaned archive path: %q", cleaned)
	}
	return cleaned, nil
}

// SafeFileStem produces a safe lowercase [a-z0-9_] file stem avoiding traversal, base.go collisions, and *_test.go suffixes.
func SafeFileStem(raw string, fallbackIdx int) string {
	var b strings.Builder
	prevUnderscore := false
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevUnderscore = false
		} else if !prevUnderscore && b.Len() > 0 {
			b.WriteRune('_')
			prevUnderscore = true
		}
	}
	stem := strings.Trim(b.String(), "_")
	if stem == "" {
		stem = fmt.Sprintf("entity_%d", fallbackIdx)
	}
	if stem == "base" {
		stem = "base_entity"
	}
	if strings.HasSuffix(stem, "_test") {
		stem = stem + "_model"
	}
	return stem
}

// SafeRouteSegment produces a safe Gin route path segment stripped of wildcard/separator characters.
func SafeRouteSegment(raw string, fallback string) string {
	var b strings.Builder
	prevSep := false
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
			prevSep = false
		} else if !prevSep && b.Len() > 0 {
			b.WriteRune('_')
			prevSep = true
		}
	}
	seg := strings.Trim(b.String(), "_-")
	if seg == "" {
		return fallback
	}
	return seg
}

// SafeDBName extracts a valid SQL database identifier from moduleName (e.g. github.com/org/my-app -> my_app).
func SafeDBName(moduleName string) string {
	clean := SafeModuleName(moduleName)
	if idx := strings.LastIndex(clean, "/"); idx >= 0 {
		clean = clean[idx+1:]
	}
	var b strings.Builder
	for _, r := range strings.ToLower(clean) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	res := strings.Trim(b.String(), "_")
	for strings.Contains(res, "__") {
		res = strings.ReplaceAll(res, "__", "_")
	}
	if res == "" || (res[0] >= '0' && res[0] <= '9') {
		return "app_" + res
	}
	return res
}

// SafePort parses raw into a listen address (":8080") and bare numeric port ("8080").
func SafePort(raw string) (listenAddr string, portNum string) {
	trimmed := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), ":"))
	if p, err := strconv.Atoi(trimmed); err == nil && p >= 1 && p <= 65535 {
		num := strconv.Itoa(p)
		return ":" + num, num
	}
	return ":8080", "8080"
}

// SafeFieldName converts an attribute name to an exported Go struct field name (guaranteeing ASCII A-Z prefix).
func SafeFieldName(raw string) string {
	pascal := naming.ToPascalCase(raw)
	if pascal == "" {
		return "Field"
	}
	r := []rune(pascal)
	if !isASCIIUpper(r[0]) {
		return "Field" + pascal
	}
	return pascal
}

// SafeStructName converts an entity name to an exported Go struct name (avoiding BaseModel collision).
func SafeStructName(raw string) string {
	pascal := naming.ToPascalCase(raw)
	if pascal == "" {
		return "Model"
	}
	r := []rune(pascal)
	if !isASCIIUpper(r[0]) {
		return "Entity" + pascal
	}
	if pascal == "BaseModel" {
		return "BaseModelEntity"
	}
	return pascal
}

// SafeVarName converts an entity name to a safe Go variable identifier (escaping keywords and leading digits).
func SafeVarName(raw string) string {
	camel := naming.ToCamelCase(raw)
	if camel == "" {
		return "item"
	}
	if goKeywords[camel] {
		return camel + "Item"
	}
	r := []rune(camel)
	if unicode.IsDigit(r[0]) {
		return "v" + camel
	}
	if !isASCIILower(r[0]) && !isASCIIUpper(r[0]) {
		return "item" + camel
	}
	return camel
}

// SafeModuleName sanitizes a Go module path for go.mod.
func SafeModuleName(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "app"
	}
	trimmed = strings.ReplaceAll(trimmed, " ", "-")
	var b strings.Builder
	for _, r := range trimmed {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == '/' {
			b.WriteRune(r)
		} else {
			b.WriteRune('-')
		}
	}
	res := strings.Trim(b.String(), "-./")
	for strings.Contains(res, "--") {
		res = strings.ReplaceAll(res, "--", "-")
	}
	for strings.Contains(res, "//") {
		res = strings.ReplaceAll(res, "//", "/")
	}
	if res == "" || strings.Contains(res, "..") {
		return "app"
	}
	return res
}
