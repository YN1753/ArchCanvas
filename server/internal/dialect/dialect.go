package dialect

import (
	"sort"
	"strings"
	"sync"
)

// ForbiddenTypeRule declares a foreign-dialect SQL type/clause marker that is incompatible with the target dialect.
type ForbiddenTypeRule struct {
	Pattern    string
	Suggestion string
}

// Spec encapsulates all SQL dialect metadata, GORM codegen expressions, default physical types,
// LLM prompt constraints, and cross-dialect validation markers.
type Spec struct {
	ID                    string
	Aliases               []string
	DisplayName           string
	GormDriverImport      string
	GormDriverModule      string
	OpenExpr              func(dsnExpr string) string
	DefaultDSN            func(dbName string) string
	PrimaryKeySQL         string
	PrimaryKeyGo          string
	ForeignKeySQL         string
	ForeignKeyGo          string
	BigIntSQL             string
	DateTimeSQL           string
	BooleanSQL            string
	DecimalSQL            string
	JSONSQL               string
	StringSQL             string
	PromptPrimaryKeyHint  string
	ForbiddenTypePatterns []ForbiddenTypeRule
	NormalizeGormType     func(lowerDBType string) string
}

// MatchForbiddenType checks whether dbType contains any foreign-dialect SQL marker incompatible with s.
func (s Spec) MatchForbiddenType(dbType string) (ForbiddenTypeRule, bool) {
	upper := strings.ToUpper(strings.TrimSpace(dbType))
	if upper == "" {
		return ForbiddenTypeRule{}, false
	}
	for _, rule := range s.ForbiddenTypePatterns {
		if rule.Pattern != "" && strings.Contains(upper, strings.ToUpper(rule.Pattern)) {
			return rule, true
		}
	}
	return ForbiddenTypeRule{}, false
}

var (
	mu       sync.RWMutex
	byKey    = make(map[string]Spec)
	ordered  []string
	fallback = "mysql"
)

// Register registers a dialect Spec by its canonical ID and aliases.
func Register(spec Spec) {
	mu.Lock()
	defer mu.Unlock()

	id := strings.ToLower(strings.TrimSpace(spec.ID))
	if id == "" {
		return
	}
	spec.ID = id
	if _, exists := byKey[id]; !exists {
		ordered = append(ordered, id)
		sort.Strings(ordered)
	}
	byKey[id] = spec
	for _, alias := range spec.Aliases {
		a := strings.ToLower(strings.TrimSpace(alias))
		if a != "" {
			byKey[a] = spec
		}
	}
}

// Get resolves name (or alias) to its registered Spec, defaulting gracefully to mysql when empty or unknown.
func Get(name string) Spec {
	mu.RLock()
	defer mu.RUnlock()

	key := strings.ToLower(strings.TrimSpace(name))
	if key != "" {
		if s, ok := byKey[key]; ok {
			return s
		}
	}
	return byKey[fallback]
}

// NormalizeID returns the canonical dialect ID for name (defaulting to "mysql").
func NormalizeID(name string) string {
	return Get(name).ID
}

// Supported returns all registered canonical dialect specs in deterministic alphabetical order.
func Supported() []Spec {
	mu.RLock()
	defer mu.RUnlock()

	out := make([]Spec, 0, len(ordered))
	for _, id := range ordered {
		out = append(out, byKey[id])
	}
	return out
}
