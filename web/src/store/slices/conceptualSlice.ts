import type { StateCreator } from 'zustand'

import {
  legacyConceptSyntheticId,
  normalizeConceptualDesign,
} from '../../domain/conceptNormalize'
import {
  emptyConceptualDesign,
  localID,
  type BusinessConcept,
  type ConceptAttribute,
  type ConceptCardinality,
  type ConceptRelation,
  type ConceptualDesign,
} from '../../types/dsl'
import type { ConceptualSlice, Store } from '../types'
import { saveChenPositions, uniqueConceptAttrName, uniqueConceptName } from '../utils'

function matchesConcept(concept: BusinessConcept, idOrName: string): boolean {
  return (
    concept.id === idOrName ||
    concept.name.toLowerCase() === idOrName.toLowerCase() ||
    legacyConceptSyntheticId(concept.name) === idOrName
  )
}

function matchesConceptRelation(rel: ConceptRelation, targetId: string): boolean {
  return Boolean(rel.id && (rel.id === targetId || `rel-${rel.id}` === targetId))
}

export const createConceptualSlice: StateCreator<Store, [], [], ConceptualSlice> = (set, get) => ({
  conceptualDesign: emptyConceptualDesign(),
  chenPositions: {},

  updateChenPositions(moves) {
    if (moves.length === 0) return
    const { project, chenPositions } = get()
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    const nextPositions = { ...chenPositions }
    const moveMap = new Map(moves.map((m) => [m.id, m.position]))
    for (const move of moves) {
      nextPositions[move.id] = move.position
    }

    let conceptualChanged = false
    const nextConcepts = conceptualDesign.concepts.map((c) => {
      const pos = (c.id ? moveMap.get(c.id) : undefined) ?? moveMap.get(legacyConceptSyntheticId(c.name))
      if (pos) {
        conceptualChanged = true
        return { ...c, position: pos }
      }
      return c
    })

    const nextRelations = conceptualDesign.relations.map((r) => {
      const rid = r.id!
      const pos = moveMap.get(rid) ?? moveMap.get(`rel-${rid}`)
      if (pos) {
        conceptualChanged = true
        return { ...r, position: pos }
      }
      return r
    })

    if (conceptualChanged) {
      get().mutateConceptual(
        {
          ...conceptualDesign,
          concepts: nextConcepts,
          relations: nextRelations,
        },
        undefined,
        { chenPositions: nextPositions },
      )
    } else {
      set({ chenPositions: nextPositions })
    }

    if (project) {
      saveChenPositions(project.id, nextPositions)
    }
  },

  resetChenPositions() {
    const { conceptualDesign } = get()
    const hasCustomConceptPos =
      (conceptualDesign.concepts || []).some((c) => c.position !== undefined) ||
      (conceptualDesign.relations || []).some((r) => r.position !== undefined)

    const nextConceptual: ConceptualDesign | undefined = hasCustomConceptPos
      ? {
          ...conceptualDesign,
          concepts: (conceptualDesign.concepts || []).map((c) => ({ ...c, position: undefined })),
          relations: (conceptualDesign.relations || []).map((r) => ({ ...r, position: undefined })),
        }
      : undefined

    get().mutateChenPositions({}, nextConceptual)
  },

  addConcept(customPosition) {
    const { conceptualDesign } = get()
    const concepts = conceptualDesign.concepts || []
    const name = uniqueConceptName(concepts, 'NewConcept')
    const newConcept: BusinessConcept = {
      id: localID(),
      name,
      display_name: '新概念',
      description: '',
      position: customPosition
        ? {
            x: Math.max(40, Math.round(customPosition.x / 20) * 20),
            y: Math.max(40, Math.round(customPosition.y / 20) * 20),
          }
        : undefined,
      attributes: [
        {
          id: localID(),
          name: 'id',
          display_name: '标识号',
          category: 'string',
          is_business_key: true,
          required: true,
          description: '业务唯一标识',
        },
      ],
    }

    get().mutateConceptual(
      {
        ...conceptualDesign,
        concepts: [...concepts, newConcept],
      },
      undefined,
      {
        selection: { kind: 'entity', id: newConcept.id! },
        inspectorOpen: true,
      },
    )
  },

  updateConcept(id, patch) {
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    const target = conceptualDesign.concepts.find((c) => matchesConcept(c, id))
    if (!target) return

    const ensuredId = target.id!
    const oldNameLower = target.name.toLowerCase()

    const nextConcepts = conceptualDesign.concepts.map((c) =>
      c === target ? { ...c, ...patch } : c,
    )

    let nextRelations = conceptualDesign.relations
    if (patch.name !== undefined && patch.name !== target.name) {
      const nextEndpointRef = patch.name.trim() !== '' ? patch.name : ensuredId
      const matchesEndpoint = (endpoint: string) =>
        endpoint.toLowerCase() === oldNameLower || endpoint === ensuredId

      nextRelations = nextRelations.map((r) => {
        const srcHit = matchesEndpoint(r.source_concept)
        const tgtHit = matchesEndpoint(r.target_concept)
        if (!srcHit && !tgtHit) return r
        return {
          ...r,
          source_concept: srcHit ? nextEndpointRef : r.source_concept,
          target_concept: tgtHit ? nextEndpointRef : r.target_concept,
        }
      })
    }

    get().mutateConceptual(
      {
        ...conceptualDesign,
        concepts: nextConcepts,
        relations: nextRelations,
      },
      `concept-update-${ensuredId}`,
    )
  },

  deleteConcept(id) {
    const { selection, chenPositions, project } = get()
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    const target = conceptualDesign.concepts.find((c) => matchesConcept(c, id))
    const targetId = target?.id ?? id
    const targetNameLower = (target?.name ?? '').toLowerCase()
    const legacyKey = target ? legacyConceptSyntheticId(target.name) : ''

    const nextConcepts = conceptualDesign.concepts.filter((c) => c !== target)
    const removedRelIds = new Set<string>()
    const nextRelations = conceptualDesign.relations.filter((r) => {
      const hit =
        r.source_concept === targetId ||
        r.target_concept === targetId ||
        (targetNameLower !== '' &&
          (r.source_concept.toLowerCase() === targetNameLower ||
            r.target_concept.toLowerCase() === targetNameLower))
      if (hit && r.id) {
        removedRelIds.add(r.id)
      }
      return !hit
    })

    const nextChenPositions = { ...chenPositions }
    delete nextChenPositions[targetId]
    delete nextChenPositions[id]
    if (legacyKey) {
      delete nextChenPositions[legacyKey]
    }
    for (const relId of removedRelIds) {
      delete nextChenPositions[relId]
      delete nextChenPositions[`rel-${relId}`]
    }
    for (const key of Object.keys(nextChenPositions)) {
      if (
        key.startsWith(`attr-${targetId}-`) ||
        key.startsWith(`attr-${id}-`) ||
        (legacyKey && key.startsWith(`attr-${legacyKey}-`))
      ) {
        delete nextChenPositions[key]
      }
    }
    if (project) {
      saveChenPositions(project.id, nextChenPositions)
    }

    const clearSelection =
      (selection?.kind === 'entity' &&
        (selection.id === id || selection.id === targetId || selection.id === legacyKey)) ||
      (selection?.kind === 'relation' && removedRelIds.has(selection.id))

    get().mutateConceptual(
      {
        ...conceptualDesign,
        concepts: nextConcepts,
        relations: nextRelations,
      },
      undefined,
      {
        chenPositions: nextChenPositions,
        selection: clearSelection ? null : selection,
        toast: {
          kind: 'info',
          text: `已删除业务概念「${target?.display_name || target?.name || id}」`,
        },
      },
    )
  },

  addConceptAttribute(conceptID) {
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    const nextConcepts = conceptualDesign.concepts.map((c) => {
      if (!matchesConcept(c, conceptID)) return c
      const newAttr: ConceptAttribute = {
        id: localID(),
        name: uniqueConceptAttrName(c, 'attr'),
        display_name: '新属性',
        category: 'string',
        is_business_key: false,
        required: false,
        description: '',
      }
      return {
        ...c,
        attributes: [...c.attributes, newAttr],
      }
    })
    get().mutateConceptual({
      ...conceptualDesign,
      concepts: nextConcepts,
    })
  },

  updateConceptAttribute(conceptID, attributeID, patch) {
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    const nextConcepts = conceptualDesign.concepts.map((c) => {
      if (!matchesConcept(c, conceptID)) return c
      return {
        ...c,
        attributes: c.attributes.map((a) =>
          a.id === attributeID || a.name === attributeID ? { ...a, ...patch } : a,
        ),
      }
    })
    get().mutateConceptual(
      {
        ...conceptualDesign,
        concepts: nextConcepts,
      },
      `concept-attr-${conceptID}-${attributeID}`,
    )
  },

  deleteConceptAttribute(conceptID, attributeID) {
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    const nextConcepts = conceptualDesign.concepts.map((c) => {
      if (!matchesConcept(c, conceptID)) return c
      return {
        ...c,
        attributes: c.attributes.filter((a) => a.id !== attributeID && a.name !== attributeID),
      }
    })
    get().mutateConceptual({
      ...conceptualDesign,
      concepts: nextConcepts,
    })
  },

  moveConceptAttribute(conceptID, attributeID, direction) {
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    const nextConcepts = conceptualDesign.concepts.map((c) => {
      if (!matchesConcept(c, conceptID)) return c
      const attrs = [...c.attributes]
      const idx = attrs.findIndex((a) => a.id === attributeID || a.name === attributeID)
      if (idx < 0) return c
      const targetIdx = idx + direction
      if (targetIdx < 0 || targetIdx >= attrs.length) return c
      const temp = attrs[idx]
      attrs[idx] = attrs[targetIdx]
      attrs[targetIdx] = temp
      return { ...c, attributes: attrs }
    })
    get().mutateConceptual({
      ...conceptualDesign,
      concepts: nextConcepts,
    })
  },

  addConceptRelation(sourceID, targetID, cardinality: ConceptCardinality = 'one_to_many') {
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    const srcConcept = conceptualDesign.concepts.find((c) => matchesConcept(c, sourceID))
    const tgtConcept = conceptualDesign.concepts.find((c) => matchesConcept(c, targetID))
    if (!srcConcept || !tgtConcept) return

    const isSelf = srcConcept === tgtConcept
    const srcLower = srcConcept.name.toLowerCase()
    const tgtLower = tgtConcept.name.toLowerCase()

    const existing = conceptualDesign.relations.some((r) => {
      const rSrc = r.source_concept.toLowerCase()
      const rTgt = r.target_concept.toLowerCase()
      return isSelf
        ? rSrc === srcLower && rTgt === srcLower
        : (rSrc === srcLower && rTgt === tgtLower) || (rSrc === tgtLower && rTgt === srcLower)
    })
    if (existing) {
      set({
        toast: {
          kind: 'info',
          text: isSelf
            ? `概念「${srcConcept.display_name || srcConcept.name}」已存在自引用关系`
            : `概念「${srcConcept.display_name || srcConcept.name}」与「${tgtConcept.display_name || tgtConcept.name}」已存在联系`,
        },
      })
      return
    }

    const newRel: ConceptRelation = {
      id: localID(),
      name: isSelf ? '层级包含' : '关联',
      source_concept: srcConcept.name,
      target_concept: tgtConcept.name,
      cardinality,
      description: isSelf ? '自引用层级结构' : '',
    }

    get().mutateConceptual(
      {
        ...conceptualDesign,
        relations: [...conceptualDesign.relations, newRel],
      },
      undefined,
      {
        selection: { kind: 'relation', id: newRel.id! },
        inspectorOpen: true,
      },
    )
  },

  updateConceptRelation(relationID, patch) {
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    let resolvedKey = relationID
    const nextRelations = conceptualDesign.relations.map((r) => {
      if (!matchesConceptRelation(r, relationID)) {
        return r
      }
      resolvedKey = r.id!
      return { ...r, ...patch }
    })
    get().mutateConceptual(
      {
        ...conceptualDesign,
        relations: nextRelations,
      },
      `concept-rel-${resolvedKey}`,
    )
  },

  deleteConceptRelation(relationID) {
    const { selection, chenPositions, project } = get()
    const conceptualDesign = normalizeConceptualDesign(get().conceptualDesign)
    const removedIds = new Set<string>()
    const nextRelations = conceptualDesign.relations.filter((r) => {
      const hit = matchesConceptRelation(r, relationID)
      if (hit) {
        if (r.id) removedIds.add(r.id)
        removedIds.add(relationID)
      }
      return !hit
    })

    const nextChenPositions = { ...chenPositions }
    for (const rid of removedIds) {
      delete nextChenPositions[rid]
      delete nextChenPositions[`rel-${rid}`]
    }
    if (project) {
      saveChenPositions(project.id, nextChenPositions)
    }

    get().mutateConceptual(
      {
        ...conceptualDesign,
        relations: nextRelations,
      },
      undefined,
      {
        chenPositions: nextChenPositions,
        selection:
          selection?.kind === 'relation' &&
          (removedIds.has(selection.id) || selection.id === `rel-${relationID}`)
            ? null
            : selection,
        toast: { kind: 'info', text: '已删除业务概念联系' },
      },
    )
  },
})
