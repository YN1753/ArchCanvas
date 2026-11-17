package domain

import (
	"strings"

	"archcanvas/pkg/naming"
)

var junctionAuditColumns = map[string]bool{
	"id":           true,
	"created_at":   true,
	"updated_at":   true,
	"deleted_at":   true,
	"create_time":  true,
	"update_time":  true,
	"delete_time":  true,
	"created_by":   true,
	"updated_by":   true,
	"deleted_by":   true,
	"creator_id":   true,
	"updater_id":   true,
	"tenant_id":    true,
	"org_id":       true,
	"version":      true,
	"is_deleted":   true,
	"remark":       true,
	"note":         true,
	"sort":         true,
	"sort_order":   true,
	"seq":          true,
	"weight":       true,
	"created_time": true,
	"updated_time": true,
	"deleted_time": true,
	"create_at":    true,
	"update_at":    true,
	"delete_at":    true,
	"gmt_create":   true,
	"gmt_modified": true,
	"created_date": true,
	"updated_date": true,
	"creator":      true,
	"updater":      true,
	"deleted":      true,
	"del_flag":     true,
	"lock_version": true,
	"revision":     true,
}

var technicalAuditColumns = map[string]bool{
	"created_at":   true,
	"create_time":  true,
	"created_time": true,
	"create_at":    true,
	"gmt_create":   true,
	"created_date": true,
	"created_by":   true,
	"creator":      true,
	"creator_id":   true,
	"updated_at":   true,
	"update_time":  true,
	"updated_time": true,
	"update_at":    true,
	"gmt_modified": true,
	"updated_date": true,
	"updated_by":   true,
	"updater":      true,
	"updater_id":   true,
	"deleted_at":   true,
	"delete_time":  true,
	"deleted_time": true,
	"delete_at":    true,
	"deleted_by":   true,
	"is_deleted":   true,
	"deleted":      true,
	"del_flag":     true,
	"version":      true,
	"lock_version": true,
	"revision":     true,
}

// IsJunctionAuditColumn reports whether colName is an audit/metadata column excluded from business payload counting on junction tables.
func IsJunctionAuditColumn(colName string) bool {
	return junctionAuditColumns[strings.ToLower(strings.TrimSpace(colName))]
}

// IsTechnicalAuditColumn reports whether colName is a pure technical audit column stripped from Chen conceptual attributes.
func IsTechnicalAuditColumn(colName string) bool {
	return technicalAuditColumns[strings.ToLower(strings.TrimSpace(colName))]
}

// EffectiveCardinality returns the normalized non-empty cardinality string for r, defaulting to "one_to_many".
func (r Relation) EffectiveCardinality() string {
	card := strings.TrimSpace(r.Cardinality)
	if card == "" {
		card = strings.TrimSpace(r.RelationTypeID)
	}
	if card == "" {
		return "one_to_many"
	}
	return card
}

// IsManyToMany reports whether r declares a many-to-many cardinality.
func (r Relation) IsManyToMany() bool {
	return isManyToManyToken(r.Cardinality) || isManyToManyToken(r.RelationTypeID)
}

func isManyToManyToken(card string) bool {
	switch strings.ToLower(strings.TrimSpace(card)) {
	case "many_to_many", "many-to-many", "m:n", "n:m", "n:n", "m:m":
		return true
	default:
		return false
	}
}

// EntityLookup indexes all entities in d by ID, lowercase ID, trimmed Name, and lowercase trimmed Name.
func (d *ERDesign) EntityLookup() map[string]*Entity {
	if d == nil || len(d.Entities) == 0 {
		return map[string]*Entity{}
	}
	lookup := make(map[string]*Entity, len(d.Entities)*4)
	for i := range d.Entities {
		ent := &d.Entities[i]
		if ent.ID != "" {
			lookup[ent.ID] = ent
			lookup[strings.ToLower(strings.TrimSpace(ent.ID))] = ent
		}
		name := strings.TrimSpace(ent.Name)
		if name != "" {
			lookup[name] = ent
			lookup[strings.ToLower(name)] = ent
		}
	}
	return lookup
}

// FindEntity resolves an entity by ID or case-insensitive table name using lookup (or building one if nil).
func (d *ERDesign) FindEntity(idOrName string, lookup map[string]*Entity) (*Entity, bool) {
	key := strings.TrimSpace(idOrName)
	if key == "" || d == nil {
		return nil, false
	}
	if lookup == nil {
		lookup = d.EntityLookup()
	}
	if ent, ok := lookup[key]; ok {
		return ent, true
	}
	if ent, ok := lookup[strings.ToLower(key)]; ok {
		return ent, true
	}
	return nil, false
}

func entityCanonicalKey(e Entity) string {
	if strings.TrimSpace(e.ID) != "" {
		return "id:" + strings.TrimSpace(e.ID)
	}
	return "name:" + strings.ToLower(strings.TrimSpace(e.Name))
}

func sameEntity(a, b Entity) bool {
	if a.ID != "" && b.ID != "" {
		return a.ID == b.ID
	}
	return strings.EqualFold(strings.TrimSpace(a.Name), strings.TrimSpace(b.Name))
}

// ResolveFKTarget resolves a physical foreign-key column (following <table_name>_id or <singular_target>_id)
// to its referenced target entity in entities, excluding self.
func ResolveFKTarget(colName string, self Entity, entities []Entity) (*Entity, bool) {
	lower := strings.ToLower(strings.TrimSpace(colName))
	if lower == "id" || !strings.HasSuffix(lower, "_id") {
		return nil, false
	}
	stem := strings.TrimSuffix(lower, "_id")
	if stem == "" {
		return nil, false
	}
	for i := range entities {
		cand := &entities[i]
		if sameEntity(*cand, self) {
			continue
		}
		cName := strings.ToLower(strings.TrimSpace(cand.Name))
		if cName == "" {
			continue
		}
		cSing := naming.Singularize(cName)
		if stem == cName || stem == cSing {
			return cand, true
		}
	}
	return nil, false
}

// ResolveRelationFKColumn locates the foreign-key attribute on target referencing source.
// When allowSingleGenericFallback is true and target has no exact <source>_id column but has exactly one non-PK *_id column,
// that column is returned (supporting semantic alias FKs like users -> articles.author_id).
func ResolveRelationFKColumn(source Entity, target Entity, allowSingleGenericFallback bool) (*Attribute, bool) {
	srcLower := strings.ToLower(strings.TrimSpace(source.Name))
	srcSing := naming.Singularize(srcLower)

	var genericCandidates []*Attribute
	for i := range target.Attributes {
		attr := &target.Attributes[i]
		if attr.IsPrimaryKey {
			continue
		}
		aLower := strings.ToLower(strings.TrimSpace(attr.Name))
		if (srcLower != "" && aLower == srcLower+"_id") || (srcSing != "" && aLower == srcSing+"_id") {
			return attr, true
		}
		if strings.HasSuffix(aLower, "_id") {
			genericCandidates = append(genericCandidates, attr)
		}
	}
	if allowSingleGenericFallback && len(genericCandidates) == 1 {
		return genericCandidates[0], true
	}
	return nil, false
}

func matchesCompositeTableHint(junctionName string, target Entity) bool {
	jLower := strings.ToLower(strings.TrimSpace(junctionName))
	jSnake := naming.ToSnakeCase(junctionName)
	tLower := strings.ToLower(strings.TrimSpace(target.Name))
	tSing := naming.Singularize(tLower)
	if tLower == "" {
		return false
	}
	if strings.Contains(jLower, tLower) || (jSnake != "" && strings.Contains(jSnake, tLower)) {
		return true
	}
	if tSing != "" && (strings.Contains(jLower, tSing) || (jSnake != "" && strings.Contains(jSnake, tSing))) {
		return true
	}
	return false
}

// JunctionTableMatch represents a detected many-to-many physical join table and its bridged entities.
type JunctionTableMatch struct {
	Entity         Entity
	LeftTarget     Entity
	RightTarget    Entity
	TargetEntities []Entity
	FKColumns      map[string]bool
}

// DetectJunctionTables identifies physical join tables across design using unified topological and structural rules:
// 1. Respects explicit IsJunctionTable == false (never junction) and IsJunctionTable == true (explicit junction if >= 2 targets).
// 2. Heuristic requires len(Attributes) <= 7.
// 3. Resolves to >= 2 distinct target entities via explicit Relations or <singular_target>_id FK convention + composite table name hint.
// 4. Non-PK, non-FK columns have at most 1 business payload column after excluding unified audit columns.
// 5. Not referenced as a parent primary entity by another non-junction entity's FK.
func DetectJunctionTables(design *ERDesign) []JunctionTableMatch {
	if design == nil || len(design.Entities) == 0 {
		return nil
	}

	lookup := design.EntityLookup()
	neighborsByKey := make(map[string][]Entity)
	for _, rel := range design.Relations {
		srcPtr := lookup[strings.TrimSpace(rel.SourceEntityID)]
		if srcPtr == nil {
			srcPtr = lookup[strings.ToLower(strings.TrimSpace(rel.SourceEntityID))]
		}
		tgtPtr := lookup[strings.TrimSpace(rel.TargetEntityID)]
		if tgtPtr == nil {
			tgtPtr = lookup[strings.ToLower(strings.TrimSpace(rel.TargetEntityID))]
		}
		if srcPtr == nil || tgtPtr == nil || sameEntity(*srcPtr, *tgtPtr) {
			continue
		}
		srcK := entityCanonicalKey(*srcPtr)
		tgtK := entityCanonicalKey(*tgtPtr)
		neighborsByKey[srcK] = append(neighborsByKey[srcK], *tgtPtr)
		neighborsByKey[tgtK] = append(neighborsByKey[tgtK], *srcPtr)
	}

	var candidates []JunctionTableMatch
	candidateKeys := make(map[string]bool)

	for _, ent := range design.Entities {
		if ent.IsJunctionTable != nil && !*ent.IsJunctionTable {
			continue
		}
		isExplicit := ent.IsJunctionTable != nil && *ent.IsJunctionTable
		if !isExplicit && len(ent.Attributes) > 7 {
			continue
		}

		fkCols := make(map[string]bool)
		var resolved []Entity
		seenTarget := make(map[string]bool)
		addTarget := func(t Entity) {
			if sameEntity(t, ent) {
				return
			}
			k := entityCanonicalKey(t)
			if !seenTarget[k] {
				seenTarget[k] = true
				resolved = append(resolved, t)
			}
		}

		for _, attr := range ent.Attributes {
			if attr.IsPrimaryKey {
				continue
			}
			if ref, ok := ResolveFKTarget(attr.Name, ent, design.Entities); ok {
				fkCols[strings.ToLower(strings.TrimSpace(attr.Name))] = true
				addTarget(*ref)
			}
		}

		for _, nb := range neighborsByKey[entityCanonicalKey(ent)] {
			addTarget(nb)
			if fkAttr, ok := ResolveRelationFKColumn(nb, ent, false); ok {
				fkCols[strings.ToLower(strings.TrimSpace(fkAttr.Name))] = true
			}
		}

		if len(resolved) < 2 {
			continue
		}

		var hintMatched []Entity
		for _, t := range resolved {
			if matchesCompositeTableHint(ent.Name, t) {
				hintMatched = append(hintMatched, t)
			}
		}

		if !isExplicit {
			if len(hintMatched) < 2 {
				continue
			}
			bizCols := 0
			for _, attr := range ent.Attributes {
				lowerAttr := strings.ToLower(strings.TrimSpace(attr.Name))
				if attr.IsPrimaryKey || fkCols[lowerAttr] || IsJunctionAuditColumn(lowerAttr) {
					continue
				}
				bizCols++
			}
			if bizCols > 1 {
				continue
			}
		}

		var leftTarget, rightTarget Entity
		if len(hintMatched) >= 2 {
			leftTarget = hintMatched[0]
			rightTarget = hintMatched[1]
		} else {
			var nonScope []Entity
			for _, t := range resolved {
				tl := strings.ToLower(strings.TrimSpace(t.Name))
				if tl != "tenants" && tl != "tenant" && tl != "orgs" && tl != "org" {
					nonScope = append(nonScope, t)
				}
			}
			if len(nonScope) >= 2 {
				leftTarget = nonScope[0]
				rightTarget = nonScope[1]
			} else {
				leftTarget = resolved[0]
				rightTarget = resolved[1]
			}
		}

		k := entityCanonicalKey(ent)
		candidateKeys[k] = true
		candidates = append(candidates, JunctionTableMatch{
			Entity:         ent,
			LeftTarget:     leftTarget,
			RightTarget:    rightTarget,
			TargetEntities: resolved,
			FKColumns:      fkCols,
		})
	}

	if len(candidates) == 0 {
		return nil
	}

	// Pass 2: Exclude heuristic candidates referenced as a parent primary entity by another non-junction entity's FK.
	referencedByNonJunction := make(map[string]bool)
	for _, other := range design.Entities {
		otherKey := entityCanonicalKey(other)
		if candidateKeys[otherKey] {
			continue
		}
		for _, attr := range other.Attributes {
			if attr.IsPrimaryKey {
				continue
			}
			if ref, ok := ResolveFKTarget(attr.Name, other, design.Entities); ok {
				referencedByNonJunction[entityCanonicalKey(*ref)] = true
			}
		}
		for _, rel := range design.Relations {
			srcPtr := lookup[strings.TrimSpace(rel.SourceEntityID)]
			if srcPtr == nil {
				srcPtr = lookup[strings.ToLower(strings.TrimSpace(rel.SourceEntityID))]
			}
			tgtPtr := lookup[strings.TrimSpace(rel.TargetEntityID)]
			if tgtPtr == nil {
				tgtPtr = lookup[strings.ToLower(strings.TrimSpace(rel.TargetEntityID))]
			}
			if srcPtr != nil && tgtPtr != nil && sameEntity(*tgtPtr, other) && !sameEntity(*srcPtr, other) {
				if _, hasFK := ResolveRelationFKColumn(*srcPtr, other, false); hasFK {
					referencedByNonJunction[entityCanonicalKey(*srcPtr)] = true
				}
			}
		}
	}

	out := make([]JunctionTableMatch, 0, len(candidates))
	for _, c := range candidates {
		isExplicit := c.Entity.IsJunctionTable != nil && *c.Entity.IsJunctionTable
		if !isExplicit && referencedByNonJunction[entityCanonicalKey(c.Entity)] {
			continue
		}
		out = append(out, c)
	}
	return out
}
