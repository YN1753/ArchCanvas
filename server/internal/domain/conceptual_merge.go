package domain

import (
	"encoding/json"
	"fmt"
	"strings"

	"archcanvas/pkg/id"
)

// ClonePosition returns a shallow copy of pos (or nil if pos is nil).
func ClonePosition(pos *Position) *Position {
	if pos == nil {
		return nil
	}
	return &Position{X: pos.X, Y: pos.Y}
}

// CloneConceptualDesign returns a deep copy of src (or nil if src is nil).
func CloneConceptualDesign(src *ConceptualDesign) *ConceptualDesign {
	if src == nil {
		return nil
	}
	b, err := json.Marshal(src)
	if err != nil {
		cp := *src
		return &cp
	}
	var out ConceptualDesign
	if err := json.Unmarshal(b, &out); err != nil {
		cp := *src
		return &cp
	}
	return &out
}

// MergeConceptualDesign merges incoming conceptual delta operations (create/modify/retain/delete) onto existing,
// preserving existing UUIDs, canvas coordinates, and unmentioned retained concepts.
func MergeConceptualDesign(existing *ConceptualDesign, incoming ConceptualDesign) ConceptualDesign {
	normalizeNewConcept := func(c BusinessConcept) BusinessConcept {
		c.Position = nil
		if c.ID == "" {
			c.ID = id.NewUUIDv7()
		}
		for j := range c.Attributes {
			if c.Attributes[j].ID == "" {
				c.Attributes[j].ID = id.NewUUIDv7()
			}
		}
		return c
	}

	if existing == nil || len(existing.Concepts) == 0 {
		kept := make([]BusinessConcept, 0, len(incoming.Concepts))
		deletedNames := make(map[string]bool)
		for _, c := range incoming.Concepts {
			if c.Operation == OpDelete {
				deletedNames[strings.ToLower(strings.TrimSpace(c.Name))] = true
				if c.ID != "" {
					deletedNames[strings.ToLower(c.ID)] = true
				}
				continue
			}
			kept = append(kept, normalizeNewConcept(c))
		}
		rels := make([]ConceptRelation, 0, len(incoming.Relations))
		for _, r := range incoming.Relations {
			if deletedNames[strings.ToLower(strings.TrimSpace(r.SourceConcept))] ||
				deletedNames[strings.ToLower(strings.TrimSpace(r.TargetConcept))] {
				continue
			}
			r.Position = nil
			if r.ID == "" {
				r.ID = id.NewUUIDv7()
			}
			rels = append(rels, r)
		}
		return ConceptualDesign{
			Summary:   incoming.Summary,
			Concepts:  kept,
			Relations: rels,
		}
	}

	existingByID := make(map[string]BusinessConcept, len(existing.Concepts))
	existingByName := make(map[string]BusinessConcept, len(existing.Concepts))
	for _, c := range existing.Concepts {
		if c.ID != "" {
			existingByID[c.ID] = c
		}
		existingByName[strings.ToLower(strings.TrimSpace(c.Name))] = c
		if c.DisplayName != "" {
			existingByName[strings.ToLower(strings.TrimSpace(c.DisplayName))] = c
		}
	}

	deletedIDs := make(map[string]bool)
	deletedNames := make(map[string]bool)
	handledExistingIDs := make(map[string]bool)
	mergedConcepts := make([]BusinessConcept, 0, len(existing.Concepts)+len(incoming.Concepts))

	matchExisting := func(inc BusinessConcept) *BusinessConcept {
		if inc.ID != "" {
			if old, ok := existingByID[inc.ID]; ok {
				return &old
			}
		}
		if old, ok := existingByName[strings.ToLower(strings.TrimSpace(inc.Name))]; ok {
			return &old
		}
		if inc.DisplayName != "" {
			if old, ok := existingByName[strings.ToLower(strings.TrimSpace(inc.DisplayName))]; ok {
				return &old
			}
		}
		return nil
	}

	for _, inc := range incoming.Concepts {
		matched := matchExisting(inc)
		if inc.Operation == OpDelete {
			deletedNames[strings.ToLower(strings.TrimSpace(inc.Name))] = true
			if inc.DisplayName != "" {
				deletedNames[strings.ToLower(strings.TrimSpace(inc.DisplayName))] = true
			}
			if inc.ID != "" {
				deletedIDs[inc.ID] = true
			}
			if matched != nil {
				deletedIDs[matched.ID] = true
				deletedNames[strings.ToLower(strings.TrimSpace(matched.Name))] = true
				handledExistingIDs[matched.ID] = true
			}
			continue
		}

		if matched != nil {
			handledExistingIDs[matched.ID] = true
			if inc.ID == "" {
				inc.ID = matched.ID
			}
			inc.Position = ClonePosition(matched.Position)
			if len(inc.Attributes) == 0 && len(matched.Attributes) > 0 {
				inc.Attributes = append([]ConceptAttribute(nil), matched.Attributes...)
			} else {
				oldAttrMap := make(map[string]string, len(matched.Attributes)*2)
				for _, a := range matched.Attributes {
					oldAttrMap[strings.ToLower(strings.TrimSpace(a.Name))] = a.ID
					if a.DisplayName != "" {
						oldAttrMap[strings.ToLower(strings.TrimSpace(a.DisplayName))] = a.ID
					}
				}
				for j := range inc.Attributes {
					if inc.Attributes[j].ID == "" {
						if oldID, ok := oldAttrMap[strings.ToLower(strings.TrimSpace(inc.Attributes[j].Name))]; ok && oldID != "" {
							inc.Attributes[j].ID = oldID
						} else if inc.Attributes[j].DisplayName != "" {
							if oldID, ok := oldAttrMap[strings.ToLower(strings.TrimSpace(inc.Attributes[j].DisplayName))]; ok && oldID != "" {
								inc.Attributes[j].ID = oldID
							} else {
								inc.Attributes[j].ID = id.NewUUIDv7()
							}
						} else {
							inc.Attributes[j].ID = id.NewUUIDv7()
						}
					}
				}
			}
			mergedConcepts = append(mergedConcepts, inc)
		} else {
			mergedConcepts = append(mergedConcepts, normalizeNewConcept(inc))
		}
	}

	hasDeltaOp := false
	for _, inc := range incoming.Concepts {
		if inc.Operation == OpCreate || inc.Operation == OpModify || inc.Operation == OpDelete {
			hasDeltaOp = true
			break
		}
	}
	if hasDeltaOp || len(incoming.Concepts) < len(existing.Concepts) {
		for _, oldC := range existing.Concepts {
			if handledExistingIDs[oldC.ID] || deletedIDs[oldC.ID] || deletedNames[strings.ToLower(strings.TrimSpace(oldC.Name))] {
				continue
			}
			cloned := oldC
			cloned.Position = ClonePosition(oldC.Position)
			cloned.Attributes = append([]ConceptAttribute(nil), oldC.Attributes...)
			mergedConcepts = append(mergedConcepts, cloned)
		}
	}

	validConceptKeys := make(map[string]bool, len(mergedConcepts)*2)
	for _, c := range mergedConcepts {
		if c.ID != "" {
			validConceptKeys[strings.ToLower(c.ID)] = true
		}
		validConceptKeys[strings.ToLower(strings.TrimSpace(c.Name))] = true
	}

	isEndpointValid := func(ref string) bool {
		k := strings.ToLower(strings.TrimSpace(ref))
		return k != "" && !deletedNames[k] && validConceptKeys[k]
	}

	mergedRelations := make([]ConceptRelation, 0, len(existing.Relations)+len(incoming.Relations))
	seenRelKeys := make(map[string]bool)

	for _, rel := range incoming.Relations {
		if !isEndpointValid(rel.SourceConcept) || !isEndpointValid(rel.TargetConcept) {
			continue
		}
		foundExisting := false
		if rel.ID == "" {
			for _, oldR := range existing.Relations {
				if strings.EqualFold(oldR.SourceConcept, rel.SourceConcept) &&
					strings.EqualFold(oldR.TargetConcept, rel.TargetConcept) &&
					oldR.Cardinality == rel.Cardinality {
					rel.ID = oldR.ID
					rel.Position = ClonePosition(oldR.Position)
					foundExisting = true
					break
				}
			}
		} else {
			for _, oldR := range existing.Relations {
				if oldR.ID == rel.ID {
					rel.Position = ClonePosition(oldR.Position)
					foundExisting = true
					break
				}
			}
		}
		if !foundExisting {
			rel.Position = nil
		}
		if rel.ID == "" {
			rel.ID = id.NewUUIDv7()
		}
		relKey := fmt.Sprintf("%s->%s:%s", strings.ToLower(rel.SourceConcept), strings.ToLower(rel.TargetConcept), rel.Cardinality)
		seenRelKeys[relKey] = true
		mergedRelations = append(mergedRelations, rel)
	}

	if hasDeltaOp || len(incoming.Relations) == 0 {
		for _, oldR := range existing.Relations {
			if !isEndpointValid(oldR.SourceConcept) || !isEndpointValid(oldR.TargetConcept) {
				continue
			}
			relKey := fmt.Sprintf("%s->%s:%s", strings.ToLower(oldR.SourceConcept), strings.ToLower(oldR.TargetConcept), oldR.Cardinality)
			if seenRelKeys[relKey] {
				continue
			}
			seenRelKeys[relKey] = true
			clonedR := oldR
			clonedR.Position = ClonePosition(oldR.Position)
			mergedRelations = append(mergedRelations, clonedR)
		}
	}

	summary := incoming.Summary
	if strings.TrimSpace(summary) == "" && existing != nil {
		summary = existing.Summary
	}

	return ConceptualDesign{
		Summary:   summary,
		Concepts:  mergedConcepts,
		Relations: mergedRelations,
	}
}
