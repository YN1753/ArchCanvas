package naming

import (
	"strings"
	"unicode"
)

// invariantUncountables are mass/acronym nouns that never change between singular and plural.
var invariantUncountables = map[string]bool{
	"series":      true,
	"species":     true,
	"news":        true,
	"data":        true,
	"media":       true,
	"sms":         true,
	"rbac":        true,
	"meta":        true,
	"metadata":    true,
	"equipment":   true,
	"information": true,
	"feedback":    true,
}

// singularEndingInS are singular nouns that naturally end in 's' and must not lose their trailing 's' in Singularize,
// while their '-es' plurals (e.g. statuses, campuses, bonuses, aliases, canvases, addresses, processes, businesses) strip 'es'.
var singularEndingInS = map[string]bool{
	"status":    true,
	"campus":    true,
	"focus":     true,
	"virus":     true,
	"bonus":     true,
	"corpus":    true,
	"census":    true,
	"consensus": true,
	"syllabus":  true,
	"plus":      true,
	"bus":       true,
	"gas":       true,
	"alias":     true,
	"canvas":    true,
	"atlas":     true,
	"iris":      true,
	"lens":      true,
	"analysis":  true,
	"basis":     true,
	"diagnosis": true,
	"thesis":    true,
	"crisis":    true,
	"synopsis":  true,
	"address":   true,
	"access":    true,
	"process":   true,
	"business":  true,
	"progress":  true,
	"success":   true,
	"class":     true,
	"pass":      true,
	"glass":     true,
	"loss":      true,
	"boss":      true,
	"cross":     true,
	"dress":     true,
	"stress":    true,
	"express":   true,
}

var pluralToSingularIrregular = map[string]string{
	"people":    "person",
	"children":  "child",
	"men":       "man",
	"women":     "woman",
	"indices":   "index",
	"indexes":   "index",
	"matrices":  "matrix",
	"vertices":  "vertex",
	"leaves":    "leaf",
	"lives":     "life",
	"knives":    "knife",
	"shelves":   "shelf",
	"halves":    "half",
	"wolves":    "wolf",
	"wives":     "wife",
	"calves":    "calf",
	"loaves":    "loaf",
	"thieves":   "thief",
	"selves":    "self",
	"mice":      "mouse",
	"geese":     "goose",
	"teeth":     "tooth",
	"feet":      "foot",
	"criteria":  "criterion",
	"phenomena": "phenomenon",
	"analyses":  "analysis",
	"crises":    "crisis",
	"theses":    "thesis",
	"diagnoses": "diagnosis",
	"synopses":  "synopsis",
	"quizzes":   "quiz",
	"caches":    "cache",
	"niches":    "niche",
	"movies":    "movie",
	"cookies":   "cookie",
	"rookies":   "rookie",
	"zombies":   "zombie",
	"brownies":  "brownie",
	"hoodies":   "hoodie",
	"smoothies": "smoothie",
	"selfies":   "selfie",
	"newbies":   "newbie",
	"freebies":  "freebie",
	"calories":  "calorie",
	"pies":      "pie",
	"ties":      "tie",
	"lies":      "lie",
	"dies":      "die",
}

var singularToPluralIrregular = map[string]string{
	"person":     "people",
	"child":      "children",
	"man":        "men",
	"woman":      "women",
	"index":      "indexes",
	"matrix":     "matrices",
	"vertex":     "vertices",
	"leaf":       "leaves",
	"life":       "lives",
	"knife":      "knives",
	"shelf":      "shelves",
	"half":       "halves",
	"wolf":       "wolves",
	"wife":       "wives",
	"calf":       "calves",
	"loaf":       "loaves",
	"thief":      "thieves",
	"self":       "selves",
	"mouse":      "mice",
	"goose":      "geese",
	"tooth":      "teeth",
	"foot":       "feet",
	"criterion":  "criteria",
	"phenomenon": "phenomena",
	"analysis":   "analyses",
	"crisis":     "crises",
	"thesis":     "theses",
	"diagnosis":  "diagnoses",
	"synopsis":   "synopses",
	"quiz":       "quizzes",
	"cache":      "caches",
	"niche":      "niches",
}

func isASCIIVowel(b byte) bool {
	return b == 'a' || b == 'e' || b == 'i' || b == 'o' || b == 'u'
}

func singularizeWord(word string) string {
	if word == "" {
		return ""
	}
	runes := []rune(word)
	if runes[len(runes)-1] > unicode.MaxASCII {
		return word
	}

	if invariantUncountables[word] || singularEndingInS[word] {
		return word
	}
	if sing, ok := pluralToSingularIrregular[word]; ok {
		return sing
	}

	if strings.HasSuffix(word, "ies") && len(word) > 3 {
		prev := word[len(word)-4]
		if isASCIIVowel(prev) {
			return word[:len(word)-1]
		}
		return word[:len(word)-3] + "y"
	}

	if strings.HasSuffix(word, "sses") ||
		strings.HasSuffix(word, "xes") ||
		strings.HasSuffix(word, "zzes") ||
		strings.HasSuffix(word, "ches") ||
		strings.HasSuffix(word, "shes") {
		if len(word) > 3 {
			return word[:len(word)-2]
		}
	}

	if strings.HasSuffix(word, "ses") && len(word) > 3 {
		stem := word[:len(word)-2]
		if singularEndingInS[stem] || strings.HasSuffix(stem, "ss") {
			return stem
		}
		// Words whose root ends in "-se" (warehouses, courses, releases, licenses, cases, phases, purchases, expenses, responses, enterprises) strip only "s".
		return word[:len(word)-1]
	}

	if strings.HasSuffix(word, "s") &&
		!strings.HasSuffix(word, "ss") &&
		!strings.HasSuffix(word, "us") &&
		!strings.HasSuffix(word, "is") &&
		len(word) > 1 {
		return word[:len(word)-1]
	}

	return word
}

// Singularize converts an English (or compound snake_case / PascalCase) identifier to singular snake_case,
// singularizing only the final word segment while preserving any prefix (e.g. user_roles -> user_role).
func Singularize(name string) string {
	snake := ToSnakeCase(name)
	if snake == "" {
		return ""
	}
	prefix := ""
	word := snake
	if idx := strings.LastIndexByte(snake, '_'); idx >= 0 {
		prefix = snake[:idx+1]
		word = snake[idx+1:]
	}
	return prefix + singularizeWord(word)
}

// Pluralize converts an English (or compound snake_case / PascalCase) identifier to plural snake_case,
// pluralizing only the final word segment while preserving any prefix.
func Pluralize(name string) string {
	snake := ToSnakeCase(name)
	if snake == "" {
		return ""
	}
	runes := []rune(snake)
	if runes[len(runes)-1] > unicode.MaxASCII {
		return snake
	}

	prefix := ""
	word := snake
	if idx := strings.LastIndexByte(snake, '_'); idx >= 0 {
		prefix = snake[:idx+1]
		word = snake[idx+1:]
	}

	if word == "" || invariantUncountables[word] {
		return prefix + word
	}
	// Already plural if singularizeWord transforms it.
	if singularizeWord(word) != word {
		return prefix + word
	}
	if plur, ok := singularToPluralIrregular[word]; ok {
		return prefix + plur
	}
	if strings.HasSuffix(word, "y") && len(word) > 1 && !isASCIIVowel(word[len(word)-2]) {
		return prefix + word[:len(word)-1] + "ies"
	}
	if strings.HasSuffix(word, "s") || strings.HasSuffix(word, "x") || strings.HasSuffix(word, "z") ||
		strings.HasSuffix(word, "ch") || strings.HasSuffix(word, "sh") {
		return prefix + word + "es"
	}
	return prefix + word + "s"
}

// PluralizeTable returns a pluralized snake_case SQL table name, defaulting to "entities" when empty.
func PluralizeTable(conceptName string) string {
	p := Pluralize(conceptName)
	if p == "" {
		return "entities"
	}
	return p
}
