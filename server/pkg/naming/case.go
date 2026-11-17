package naming

import (
	"strings"
	"unicode"
)

var goInitialisms = map[string]bool{
	"ACL":   true,
	"API":   true,
	"ASCII": true,
	"CPU":   true,
	"CSS":   true,
	"DNS":   true,
	"EOF":   true,
	"GUID":  true,
	"HTML":  true,
	"HTTP":  true,
	"HTTPS": true,
	"ID":    true,
	"IP":    true,
	"JSON":  true,
	"LHS":   true,
	"QPS":   true,
	"RAM":   true,
	"RHS":   true,
	"RPC":   true,
	"SLA":   true,
	"SMTP":  true,
	"SQL":   true,
	"SSH":   true,
	"TCP":   true,
	"TLS":   true,
	"TTL":   true,
	"UDP":   true,
	"UI":    true,
	"UID":   true,
	"UUID":  true,
	"URI":   true,
	"URL":   true,
	"UTF8":  true,
	"VM":    true,
	"XML":   true,
	"XSRF":  true,
	"XSS":   true,
}

// SplitWords splits a snake_case, kebab-case, space-delimited, camelCase, or PascalCase identifier into words.
func SplitWords(s string) []string {
	var words []string
	var current []rune

	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		if !unicode.IsLetter(c) && !unicode.IsDigit(c) {
			if len(current) > 0 {
				words = append(words, string(current))
				current = nil
			}
			continue
		}

		if unicode.IsUpper(c) {
			if len(current) > 0 {
				prevIsLower := unicode.IsLower(runes[i-1])
				nextIsLower := i+1 < len(runes) && unicode.IsLower(runes[i+1])
				if prevIsLower || nextIsLower {
					words = append(words, string(current))
					current = nil
				}
			}
		}
		current = append(current, c)
	}
	if len(current) > 0 {
		words = append(words, string(current))
	}
	return words
}

// ToSnakeCase converts an identifier to normalized lowercase snake_case while preserving non-ASCII letters.
func ToSnakeCase(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	var sb strings.Builder
	sb.Grow(len(runes) + 4)

	prevUnderscore := false
	for i, r := range runes {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			if !prevUnderscore && sb.Len() > 0 {
				sb.WriteRune('_')
				prevUnderscore = true
			}
			continue
		}
		if unicode.IsUpper(r) {
			if i > 0 && !prevUnderscore && (unicode.IsLetter(runes[i-1]) || unicode.IsDigit(runes[i-1])) {
				prevLowerOrDigit := unicode.IsLower(runes[i-1]) || unicode.IsDigit(runes[i-1])
				nextLower := i+1 < len(runes) && unicode.IsLower(runes[i+1])
				if prevLowerOrDigit || nextLower {
					sb.WriteRune('_')
				}
			}
			sb.WriteRune(unicode.ToLower(r))
		} else {
			sb.WriteRune(unicode.ToLower(r))
		}
		prevUnderscore = false
	}

	return strings.Trim(sb.String(), "_")
}

// ToPascalCase converts an identifier to Go-idiomatic PascalCase honoring Go initialisms (e.g. user_id -> UserID).
func ToPascalCase(s string) string {
	words := SplitWords(s)
	if len(words) == 0 {
		return ""
	}
	var sb strings.Builder
	for _, w := range words {
		upper := strings.ToUpper(w)
		if goInitialisms[upper] {
			sb.WriteString(upper)
		} else {
			r := []rune(w)
			sb.WriteRune(unicode.ToUpper(r[0]))
			sb.WriteString(strings.ToLower(string(r[1:])))
		}
	}
	return sb.String()
}

// ToCamelCase converts an identifier to Go-idiomatic camelCase (e.g. ID -> id, ID2 -> id2, IDList -> idList, user_id -> userID).
func ToCamelCase(s string) string {
	pascal := ToPascalCase(s)
	if len(pascal) == 0 {
		return ""
	}
	r := []rune(pascal)
	if len(r) == 1 {
		return strings.ToLower(pascal)
	}

	idx := 0
	for idx < len(r) && unicode.IsUpper(r[idx]) {
		idx++
	}

	if idx == 0 {
		return pascal
	}
	if idx == 1 {
		r[0] = unicode.ToLower(r[0])
		return string(r)
	}
	if idx == len(r) || !unicode.IsLower(r[idx]) {
		for i := 0; i < idx; i++ {
			r[i] = unicode.ToLower(r[i])
		}
		return string(r)
	}

	for i := 0; i < idx-1; i++ {
		r[i] = unicode.ToLower(r[i])
	}
	return string(r)
}
