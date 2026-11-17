import type { StateCreator } from 'zustand'

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
import {
  saveChenPositions,
  uniqueConceptAttrName,
  uniqueConceptName,
} from '../utils'

function conceptSyntheticId(name: string): string {
  return `concept_${name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
}

function matchesConceptById(c: BusinessConcept, targetId: string): boolean {
  return (
    c.id === targetId ||
    c.name.toLowerCase() === targetId.toLowerCase() ||
    conceptSyntheticId(c.name) === targetId
  )
}

function matchesConceptRelationById(r: ConceptRelation, targetId: string): boolean {
  if (r.id) {
    if (r.id === targetId || `rel-${r.id}` === targetId) {
      return true
    }
  }
  const srcCid = conceptSyntheticId(r.source_concept)
  const tgtCid = conceptSyntheticId(r.target_concept)
  const fallbackCid = `rel_${srcCid}_${tgtCid}`
  const fallbackRaw = `rel_${r.source_concept}_${r.target_concept}`
  return (
    targetId === fallbackCid ||
    targetId === `rel-${fallbackCid}` ||
    targetId === fallbackRaw ||
    targetId === `rel-${fallbackRaw}`
  )
}

export const createConceptualSlice: StateCreator<Store, [], [], ConceptualSlice> = (set, get) => ({
  conceptualDesign: emptyConceptualDesign(),
  chenPositions: {},

  updateChenPositions(moves) {
    if (moves.length === 0) return
    const { project, chenPositions, conceptualDesign } = get()
    const nextPositions = { ...chenPositions }
    const moveMap = new Map(moves.map((m) => [m.id, m.position]))
    for (const move of moves) {
      nextPositions[move.id] = move.position
    }

    let conceptualChanged = false
    const nextConcepts = (conceptualDesign.concepts || []).map((c) => {
      const cid = c.id || conceptSyntheticId(c.name)
      const pos = moveMap.get(cid) ?? (c.id ? moveMap.get(c.id) : undefined)
      if (pos) {
        conceptualChanged = true
        return { ...c, position: pos }
      }
      return c
    })

    const nextRelations = (conceptualDesign.relations || []).map((r) => {
      const diaId = `rel-${r.id}`
      const pos = (r.id ? moveMap.get(r.id) : undefined) ?? moveMap.get(diaId)
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

  async saveConceptualDesign(design: ConceptualDesign) {
    const { project } = get()
    if (!project) return
    get().mutateConceptual(design)
  },

  addConcept(customPosition) {
    const { conceptualDesign } = get()
    const concepts = conceptualDesign.concepts || []
    const name = uniqueConceptName(concepts, 'NewConcept')
    const newConcept: BusinessConcept = {
      id: localID('ent'),
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
          id: localID('attr'),
          name: 'id',
          display_name: '标识号',
          category: 'string',
          is_business_key: true,
          required: true,
          description: '业务唯一标识',
        },
      ],
    }

    const nextConceptual: ConceptualDesign = {
      ...conceptualDesign,
      concepts: [...concepts, newConcept],
    }

    get().mutateConceptual(nextConceptual, undefined, {
      selection: { kind: 'entity', id: newConcept.id! },
      inspectorOpen: true,
    })
  },

  updateConcept(id, patch) {
    const { conceptualDesign } = get()
    const target = (conceptualDesign.concepts || []).find((c) => matchesConceptById(c, id))
    if (!target) return

    const ensuredId = target.id || localID('ent')
    const oldNameLower = target.name.toLowerCase()
    const oldCid = conceptSyntheticId(target.name)

    const nextConcepts = (conceptualDesign.concepts || []).map((c) =>
      c === target ? { ...c, id: ensuredId, ...patch } : c,
    )

    // 级联同步关联端点名称：即便用户先全选清空再输入新名称，也用稳定 concept ID 桥接不断连
    let nextRelations = conceptualDesign.relations || []
    if (patch.name !== undefined && patch.name !== target.name) {
      const nextEndpointRef = patch.name.trim() !== '' ? patch.name : ensuredId
      const matchesEndpoint = (endpoint: string) => {
        const lower = endpoint.toLowerCase()
        return lower === oldNameLower || endpoint === ensuredId || endpoint === oldCid
      }
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
    const { conceptualDesign, selection, chenPositions, project } = get()
    const target = (conceptualDesign.concepts || []).find((c) => matchesConceptById(c, id))
    const targetId = target?.id || id
    const targetNameLower = (target?.name || '').toLowerCase()
    const targetSynthetic = target ? conceptSyntheticId(target.name) : ''

    const nextConcepts = (conceptualDesign.concepts || []).filter(
      (c) => c !== target && !matchesConceptById(c, id),
    )
    const removedRelIds = new Set<string>()
    const nextRelations = (conceptualDesign.relations || []).filter((r) => {
      const srcLower = r.source_concept.toLowerCase()
      const tgtLower = r.target_concept.toLowerCase()
      const hit =
        r.source_concept === targetId ||
        r.target_concept === targetId ||
        (targetSynthetic !== '' && (r.source_concept === targetSynthetic || r.target_concept === targetSynthetic)) ||
        (targetNameLower !== '' && (srcLower === targetNameLower || tgtLower === targetNameLower))
      if (hit && r.id) {
        removedRelIds.add(r.id)
      }
      return !hit
    })

    const nextChenPositions = { ...chenPositions }
    delete nextChenPositions[targetId]
    delete nextChenPositions[id]
    if (targetSynthetic) {
      delete nextChenPositions[targetSynthetic]
    }
    for (const relId of removedRelIds) {
      delete nextChenPositions[relId]
      delete nextChenPositions[`rel-${relId}`]
    }
    for (const key of Object.keys(nextChenPositions)) {
      if (
        key.startsWith(`attr-${targetId}-`) ||
        key.startsWith(`attr-${id}-`) ||
        (targetSynthetic && key.startsWith(`attr-${targetSynthetic}-`))
      ) {
        delete nextChenPositions[key]
      }
    }
    if (project) {
      saveChenPositions(project.id, nextChenPositions)
    }

    const clearSelection =
      (selection?.kind === 'entity' &&
        (selection.id === id || selection.id === targetId || selection.id === targetSynthetic)) ||
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
        toast: { kind: 'info', text: `已删除业务概念「${target?.display_name || target?.name || id}」` },
      },
    )
  },

  addConceptAttribute(conceptID) {
    const { conceptualDesign } = get()
    const nextConcepts = (conceptualDesign.concepts || []).map((c) => {
      if (matchesConceptById(c, conceptID)) {
        const attrName = uniqueConceptAttrName(c, 'attr')
        const newAttr: ConceptAttribute = {
          id: localID('attr'),
          name: attrName,
          display_name: '新属性',
          category: 'string',
          is_business_key: false,
          required: false,
          description: '',
        }
        return {
          ...c,
          attributes: [...(c.attributes || []), newAttr],
        }
      }
      return c
    })
    get().mutateConceptual({
      ...conceptualDesign,
      concepts: nextConcepts,
    })
  },

  updateConceptAttribute(conceptID, attributeID, patch) {
    const { conceptualDesign } = get()
    const nextConcepts = (conceptualDesign.concepts || []).map((c) => {
      if (matchesConceptById(c, conceptID)) {
        const nextAttrs = (c.attributes || []).map((a) =>
          a.id === attributeID || a.name === attributeID ? { ...a, ...patch } : a,
        )
        return { ...c, attributes: nextAttrs }
      }
      return c
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
    const { conceptualDesign } = get()
    const nextConcepts = (conceptualDesign.concepts || []).map((c) => {
      if (matchesConceptById(c, conceptID)) {
        const nextAttrs = (c.attributes || []).filter(
          (a) => a.id !== attributeID && a.name !== attributeID,
        )
        return { ...c, attributes: nextAttrs }
      }
      return c
    })
    get().mutateConceptual({
      ...conceptualDesign,
      concepts: nextConcepts,
    })
  },

  moveConceptAttribute(conceptID, attributeID, direction) {
    const { conceptualDesign } = get()
    const nextConcepts = (conceptualDesign.concepts || []).map((c) => {
      if (matchesConceptById(c, conceptID)) {
        const attrs = [...(c.attributes || [])]
        const idx = attrs.findIndex((a) => a.id === attributeID || a.name === attributeID)
        if (idx < 0) return c
        const targetIdx = idx + direction
        if (targetIdx < 0 || targetIdx >= attrs.length) return c
        const temp = attrs[idx]
        attrs[idx] = attrs[targetIdx]
        attrs[targetIdx] = temp
        return { ...c, attributes: attrs }
      }
      return c
    })
    get().mutateConceptual({
      ...conceptualDesign,
      concepts: nextConcepts,
    })
  },

  addConceptRelation(sourceID, targetID, cardinality: ConceptCardinality = 'one_to_many') {
    const { conceptualDesign } = get()
    const findConcept = (id: string) =>
      (conceptualDesign.concepts || []).find((c) => matchesConceptById(c, id))
    const srcConcept = findConcept(sourceID)
    const tgtConcept = findConcept(targetID)
    if (!srcConcept || !tgtConcept) return

    const isSelf = srcConcept === tgtConcept

    const existing = (conceptualDesign.relations || []).some((r) => {
      if (isSelf) {
        return (
          r.source_concept.toLowerCase() === srcConcept.name.toLowerCase() &&
          r.target_concept.toLowerCase() === srcConcept.name.toLowerCase()
        )
      }
      return (
        (r.source_concept.toLowerCase() === srcConcept.name.toLowerCase() &&
          r.target_concept.toLowerCase() === tgtConcept.name.toLowerCase()) ||
        (r.source_concept.toLowerCase() === tgtConcept.name.toLowerCase() &&
          r.target_concept.toLowerCase() === srcConcept.name.toLowerCase())
      )
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
      id: localID('rel'),
      name: isSelf ? '层级包含' : '关联',
      source_concept: srcConcept.name,
      target_concept: tgtConcept.name,
      cardinality,
      description: isSelf ? '自引用层级结构' : '',
    }

    const nextConceptual: ConceptualDesign = {
      ...conceptualDesign,
      relations: [...(conceptualDesign.relations || []), newRel],
    }
    get().mutateConceptual(nextConceptual, undefined, {
      selection: { kind: 'relation', id: newRel.id! },
      inspectorOpen: true,
    })
  },

  updateConceptRelation(relationID, patch) {
    const { conceptualDesign } = get()
    let resolvedKey = relationID
    const nextRelations = (conceptualDesign.relations || []).map((r) => {
      if (!matchesConceptRelationById(r, relationID)) {
        return r
      }
      const ensuredId = r.id || localID('rel')
      resolvedKey = ensuredId
      return { ...r, id: ensuredId, ...patch }
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
    const { conceptualDesign, selection, chenPositions, project } = get()
    const removedIds = new Set<string>()
    const nextRelations = (conceptualDesign.relations || []).filter((r) => {
      const hit = matchesConceptRelationById(r, relationID)
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
