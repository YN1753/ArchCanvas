import {
  emptyConceptualDesign,
  type BusinessConcept,
  type ConceptAttribute,
  type ConceptRelation,
  type ConceptualDesign,
  type Position,
} from '../types/dsl'

/**
 * 业务概念模型（ConceptualDesign）入口规范化内核：
 * 在数据进入 Store / API 响应 / 渲染管线时一次性补齐稳定确定性的规范 `id`，
 * 彻底消除散落在 Store / Adapter / Inspector / History 中的正则合成 ID 兜底。
 */

export function legacyConceptSyntheticId(name: string): string {
  return `concept_${name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let seq = 2
  while (used.has(`${base}_${seq}`)) {
    seq += 1
  }
  const resolved = `${base}_${seq}`
  used.add(resolved)
  return resolved
}

function normalizeConceptAttributes(
  attrs: readonly ConceptAttribute[] | undefined,
): ConceptAttribute[] {
  if (!attrs || attrs.length === 0) return []
  const usedAttrIds = new Set<string>()
  return attrs.map((attr, idx) => {
    const rawId = attr.id?.trim()
    const baseId = rawId || attr.name?.trim() || `attr_${idx + 1}`
    const id = uniqueId(baseId, usedAttrIds)
    return attr.id === id ? attr : { ...attr, id }
  })
}

export function normalizeConceptualDesign(
  design: ConceptualDesign | null | undefined,
): ConceptualDesign {
  if (!design) {
    return emptyConceptualDesign()
  }

  const rawConcepts = design.concepts ?? []
  const rawRelations = design.relations ?? []

  if (rawConcepts.length === 0 && rawRelations.length === 0 && !design.summary) {
    return emptyConceptualDesign()
  }

  const usedConceptIds = new Set<string>()
  const conceptLookup = new Map<string, BusinessConcept>()

  const concepts: BusinessConcept[] = rawConcepts.map((c, idx) => {
    const rawId = c.id?.trim()
    const baseId = rawId || legacyConceptSyntheticId(c.name || `concept_${idx + 1}`)
    const id = uniqueId(baseId, usedConceptIds)
    const attributes = normalizeConceptAttributes(c.attributes)
    const normalized: BusinessConcept =
      c.id === id && c.attributes === attributes ? c : { ...c, id, attributes }

    conceptLookup.set(id, normalized)
    conceptLookup.set(id.toLowerCase(), normalized)
    conceptLookup.set(legacyConceptSyntheticId(c.name), normalized)
    if (c.name) {
      conceptLookup.set(c.name, normalized)
      conceptLookup.set(c.name.toLowerCase(), normalized)
    }
    if (c.display_name) {
      conceptLookup.set(c.display_name, normalized)
      conceptLookup.set(c.display_name.toLowerCase(), normalized)
    }
    return normalized
  })

  const usedRelationIds = new Set<string>()
  const relations: ConceptRelation[] = rawRelations.map((r) => {
    const rawId = r.id?.trim()
    const srcConcept =
      conceptLookup.get(r.source_concept) ?? conceptLookup.get(r.source_concept.toLowerCase())
    const tgtConcept =
      conceptLookup.get(r.target_concept) ?? conceptLookup.get(r.target_concept.toLowerCase())
    const srcKey = srcConcept?.id ?? legacyConceptSyntheticId(r.source_concept)
    const tgtKey = tgtConcept?.id ?? legacyConceptSyntheticId(r.target_concept)
    const baseId = rawId || `rel_${srcKey}_${tgtKey}`
    const id = uniqueId(baseId, usedRelationIds)
    return r.id === id ? r : { ...r, id }
  })

  return {
    ...(design.summary !== undefined ? { summary: design.summary } : {}),
    concepts,
    relations,
  }
}

/**
 * 兼容旧版持久化的 `chenPositions` 键名解析概念节点坐标。
 */
export function lookupConceptPosition(
  concept: BusinessConcept,
  customPositions?: Record<string, Position>,
): Position | undefined {
  if (customPositions) {
    if (concept.id && customPositions[concept.id]) {
      return customPositions[concept.id]
    }
    const legacyKey = legacyConceptSyntheticId(concept.name)
    if (customPositions[legacyKey]) {
      return customPositions[legacyKey]
    }
  }
  return concept.position
}

/**
 * 兼容旧版持久化的 `chenPositions` 键名解析联系菱形节点坐标。
 */
export function lookupConceptRelationPosition(
  params: {
    diamondId: string
    relationId: string
    sourceName: string
    targetName: string
    fallbackPosition?: Position
  },
  customPositions?: Record<string, Position>,
): Position | undefined {
  const { diamondId, relationId, sourceName, targetName, fallbackPosition } = params
  if (customPositions) {
    const legacySrc = legacyConceptSyntheticId(sourceName)
    const legacyTgt = legacyConceptSyntheticId(targetName)
    const legacyRel = `rel_${legacySrc}_${legacyTgt}`
    const legacyRaw = `rel_${sourceName}_${targetName}`
    const candidateKeys = [
      diamondId,
      relationId,
      `rel-${relationId}`,
      legacyRel,
      `rel-${legacyRel}`,
      legacyRaw,
      `rel-${legacyRaw}`,
    ]
    for (const key of candidateKeys) {
      if (customPositions[key]) {
        return customPositions[key]
      }
    }
  }
  return fallbackPosition
}
