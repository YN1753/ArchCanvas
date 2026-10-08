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
      const cid = c.id || `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
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
    const { project, conceptualDesign } = get()
    const nextConceptual: ConceptualDesign = {
      ...conceptualDesign,
      concepts: (conceptualDesign.concepts || []).map((c) => ({ ...c, position: undefined })),
      relations: (conceptualDesign.relations || []).map((r) => ({ ...r, position: undefined })),
    }
    set({ chenPositions: {}, conceptualDesign: nextConceptual })
    if (project) {
      saveChenPositions(project.id, {})
      get().scheduleSaveConceptual()
    }
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
    const matchesConcept = (c: BusinessConcept, targetId: string) =>
      c.id === targetId ||
      c.name.toLowerCase() === targetId.toLowerCase() ||
      `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}` === targetId

    const nextConcepts = (conceptualDesign.concepts || []).map((c) =>
      matchesConcept(c, id) ? { ...c, ...patch } : c,
    )
    get().mutateConceptual(
      {
        ...conceptualDesign,
        concepts: nextConcepts,
      },
      `concept-update-${id}`,
    )
  },

  deleteConcept(id) {
    const { conceptualDesign, selection, chenPositions, project } = get()
    const matchesConcept = (c: BusinessConcept, targetId: string) =>
      c.id === targetId ||
      c.name.toLowerCase() === targetId.toLowerCase() ||
      `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}` === targetId

    const target = (conceptualDesign.concepts || []).find((c) => matchesConcept(c, id))
    const targetId = target?.id || id
    const targetName = target?.name || ''

    const nextConcepts = (conceptualDesign.concepts || []).filter(
      (c) =>
        c.id !== targetId &&
        c.name.toLowerCase() !== targetName.toLowerCase() &&
        !matchesConcept(c, id),
    )
    const nextRelations = (conceptualDesign.relations || []).filter(
      (r) =>
        r.source_concept !== targetId &&
        r.target_concept !== targetId &&
        r.source_concept.toLowerCase() !== targetName.toLowerCase() &&
        r.target_concept.toLowerCase() !== targetName.toLowerCase(),
    )

    const nextChenPositions = { ...chenPositions }
    delete nextChenPositions[targetId]
    delete nextChenPositions[id]
    for (const key of Object.keys(nextChenPositions)) {
      if (key.startsWith(`attr-${targetId}-`) || key.startsWith(`attr-${id}-`)) {
        delete nextChenPositions[key]
      }
    }
    if (project) {
      saveChenPositions(project.id, nextChenPositions)
    }

    get().mutateConceptual(
      {
        ...conceptualDesign,
        concepts: nextConcepts,
        relations: nextRelations,
      },
      undefined,
      {
        chenPositions: nextChenPositions,
        selection:
          selection?.kind === 'entity' &&
          (selection.id === id || selection.id === targetId)
            ? null
            : selection,
        toast: { kind: 'info', text: `已删除业务概念「${target?.display_name || targetName || id}」` },
      },
    )
  },

  addConceptAttribute(conceptID) {
    const { conceptualDesign } = get()
    const matchesConcept = (c: BusinessConcept, targetId: string) =>
      c.id === targetId ||
      c.name.toLowerCase() === targetId.toLowerCase() ||
      `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}` === targetId

    const nextConcepts = (conceptualDesign.concepts || []).map((c) => {
      if (matchesConcept(c, conceptID)) {
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
    const matchesConcept = (c: BusinessConcept, targetId: string) =>
      c.id === targetId ||
      c.name.toLowerCase() === targetId.toLowerCase() ||
      `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}` === targetId

    const nextConcepts = (conceptualDesign.concepts || []).map((c) => {
      if (matchesConcept(c, conceptID)) {
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
    const matchesConcept = (c: BusinessConcept, targetId: string) =>
      c.id === targetId ||
      c.name.toLowerCase() === targetId.toLowerCase() ||
      `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}` === targetId

    const nextConcepts = (conceptualDesign.concepts || []).map((c) => {
      if (matchesConcept(c, conceptID)) {
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
    const matchesConcept = (c: BusinessConcept, targetId: string) =>
      c.id === targetId ||
      c.name.toLowerCase() === targetId.toLowerCase() ||
      `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}` === targetId

    const nextConcepts = (conceptualDesign.concepts || []).map((c) => {
      if (matchesConcept(c, conceptID)) {
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
      (conceptualDesign.concepts || []).find(
        (c) =>
          c.id === id ||
          c.name.toLowerCase() === id.toLowerCase() ||
          `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}` === id,
      )
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
    const nextRelations = (conceptualDesign.relations || []).map((r) => {
      const matches =
        (r.id && (r.id === relationID || relationID.includes(r.id) || `rel-${r.id}` === relationID)) ||
        (r.source_concept &&
          r.target_concept &&
          relationID.toLowerCase().includes(r.source_concept.toLowerCase()) &&
          relationID.toLowerCase().includes(r.target_concept.toLowerCase()))
      return matches ? { ...r, ...patch } : r
    })
    get().mutateConceptual(
      {
        ...conceptualDesign,
        relations: nextRelations,
      },
      `concept-rel-${relationID}`,
    )
  },

  deleteConceptRelation(relationID) {
    const { conceptualDesign, selection } = get()
    const nextRelations = (conceptualDesign.relations || []).filter((r) => {
      const matches =
        (r.id && (r.id === relationID || relationID.includes(r.id) || `rel-${r.id}` === relationID)) ||
        (r.source_concept &&
          r.target_concept &&
          relationID.toLowerCase().includes(r.source_concept.toLowerCase()) &&
          relationID.toLowerCase().includes(r.target_concept.toLowerCase()))
      return !matches
    })
    get().mutateConceptual(
      {
        ...conceptualDesign,
        relations: nextRelations,
      },
      undefined,
      {
        selection:
          selection?.kind === 'relation' &&
          (selection.id === relationID || (selection.id && relationID.includes(selection.id)))
            ? null
            : selection,
        toast: { kind: 'info', text: '已删除业务概念联系' },
      },
    )
  },
})
