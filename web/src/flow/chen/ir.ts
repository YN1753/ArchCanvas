import type { ChenAttributeNodeData } from '../../components/chen/ChenAttributeNode'
import type { ChenEntityNodeData } from '../../components/chen/ChenEntityNode'
import {
  lookupConceptPosition,
  lookupConceptRelationPosition,
  normalizeConceptualDesign,
} from '../../domain/conceptNormalize'
import { isForeignKeyColumnName } from '../../domain/foreignKey'
import { detectJunctionTable } from '../../domain/junction'
import type {
  Attribute,
  Cardinality,
  ConceptAttribute,
  ConceptualDesign,
  Entity,
  ERDesign,
  Position,
} from '../../types/dsl'
import { getAttributeChineseName, getEntityChineseName } from '../../utils/chinese'
import { getRelationshipVerb } from './geometry'

/**
 * 统一陈氏图中间表示（ChenGraphIR）：
 * 将 Layer 1 概念模型（ConceptualDesign）与 Layer 2 物理表模型（ERDesign）收敛到同一套轻量 IR，
 * 由单一投影管线 `projectChenIRToFlow` 统一完成 2D 排版、属性扇形分布、AABB 消碰与最近锚点连线。
 */

export interface ChenIRAttribute {
  nodeId: string
  data: ChenAttributeNodeData
}

export interface ChenIREntity {
  id: string
  name: string
  displayName: string
  selectionIds: string[]
  resolveCustomPosition: (customPositions?: Record<string, Position>) => Position | undefined
  buildNodeData: (resolvedPosition: Position) => ChenEntityNodeData
  attributes: ChenIRAttribute[]
}

export interface ChenIRRelation {
  /** 画布菱形节点 ID（如 `rel-xxx` 或 `junction-xxx`） */
  id: string
  /** 底层领域关系/中间表 ID */
  relationId: string
  name: string
  cardinality: Cardinality
  sourceId: string
  targetId: string
  sourceCardLabel: string
  targetCardLabel: string
  isJunctionTable?: boolean
  isSelf?: boolean
  propagateEdgeSelection?: boolean
  selectionIds: string[]
  resolveCustomPosition: (customPositions?: Record<string, Position>) => Position | undefined
}

export interface ChenGraphIR {
  entities: ChenIREntity[]
  relations: ChenIRRelation[]
}

/**
 * 将物理表设计（ERDesign）映射为 `ChenGraphIR`
 */
export function erDesignToChenIR(design: ERDesign | null | undefined): ChenGraphIR {
  if (!design?.entities?.length) {
    return { entities: [], relations: [] }
  }

  const junctionEntityIds = new Set<string>()
  const junctionRelations: ChenIRRelation[] = []
  const processedPairKeys = new Set<string>()

  for (const entity of design.entities) {
    const check = detectJunctionTable(entity, design.entities, design.relations)
    if (check.isJunction && check.leftEntity && check.rightEntity) {
      junctionEntityIds.add(entity.id)
      const diaId = `junction-${entity.id}`
      const pairKey = [check.leftEntity.id, check.rightEntity.id].toSorted().join('--')
      processedPairKeys.add(pairKey)

      junctionRelations.push({
        id: diaId,
        relationId: entity.id,
        name: entity.comment?.trim() || getEntityChineseName(entity.name, entity.comment),
        cardinality: 'many_to_many',
        sourceId: check.leftEntity.id,
        targetId: check.rightEntity.id,
        sourceCardLabel: 'M',
        targetCardLabel: 'N',
        isJunctionTable: true,
        propagateEdgeSelection: false,
        selectionIds: [diaId, entity.id],
        resolveCustomPosition: (customPositions) => customPositions?.[diaId],
      })
    }
  }

  const normalEntities = design.entities.filter((e) => !junctionEntityIds.has(e.id))
  const entityMap = new Map<string, Entity>(normalEntities.map((e) => [e.id, e]))

  const irEntities: ChenIREntity[] = normalEntities.map((entity) => {
    const pkAttrs = entity.attributes.filter((a) => a.is_primary_key)
    const bizAttrs = entity.attributes.filter(
      (a) => !a.is_primary_key && !isForeignKeyColumnName(a.name),
    )
    const selectedAttrs: Attribute[] = [...pkAttrs, ...bizAttrs.slice(0, 4)]
    if (selectedAttrs.length === 0 && entity.attributes.length > 0) {
      selectedAttrs.push(entity.attributes[0])
    }

    const displayName = getEntityChineseName(entity.name, entity.comment)

    return {
      id: entity.id,
      name: entity.name,
      displayName,
      selectionIds: [entity.id],
      resolveCustomPosition: (customPositions) => customPositions?.[entity.id],
      buildNodeData: () => ({
        entity,
        name: entity.name,
        displayName,
      }),
      attributes: selectedAttrs.map((attr) => ({
        nodeId: `attr-${entity.id}-${attr.id}`,
        data: {
          attribute: attr,
          entityId: entity.id,
          entityName: entity.name,
        },
      })),
    }
  })

  const regularRelations: ChenIRRelation[] = []
  for (const rel of design.relations ?? []) {
    if (junctionEntityIds.has(rel.source_entity_id) || junctionEntityIds.has(rel.target_entity_id)) {
      continue
    }
    const src = entityMap.get(rel.source_entity_id)
    const tgt = entityMap.get(rel.target_entity_id)
    if (!src || !tgt) continue

    const isSelf = src.id === tgt.id
    const pairKey = isSelf ? `self--${src.id}--${rel.id}` : [src.id, tgt.id].toSorted().join('--')
    if (processedPairKeys.has(pairKey)) continue
    processedPairKeys.add(pairKey)

    const diaId = `rel-${rel.id}`
    const card: Cardinality =
      rel.cardinality || (rel.relation_type_id as Cardinality | undefined) || 'one_to_many'

    regularRelations.push({
      id: diaId,
      relationId: rel.id,
      name: getRelationshipVerb(src.name, tgt.name, card),
      cardinality: card,
      sourceId: src.id,
      targetId: tgt.id,
      sourceCardLabel: card === 'many_to_many' ? 'M' : '1',
      targetCardLabel: card === 'one_to_one' ? '1' : 'N',
      isSelf,
      propagateEdgeSelection: true,
      selectionIds: [diaId, rel.id],
      resolveCustomPosition: (customPositions) => customPositions?.[diaId],
    })
  }

  return {
    entities: irEntities,
    relations: [...junctionRelations, ...regularRelations],
  }
}

/**
 * 将业务概念模型（ConceptualDesign）映射为 `ChenGraphIR`
 */
export function conceptualToChenIR(conceptualDesign: ConceptualDesign | null | undefined): ChenGraphIR {
  const normalized = normalizeConceptualDesign(conceptualDesign)
  if (normalized.concepts.length === 0) {
    return { entities: [], relations: [] }
  }

  const lookupMap = new Map<string, (typeof normalized.concepts)[number]>()
  for (const c of normalized.concepts) {
    const cid = c.id!
    lookupMap.set(cid, c)
    lookupMap.set(cid.toLowerCase(), c)
    lookupMap.set(c.name, c)
    lookupMap.set(c.name.toLowerCase(), c)
    if (c.display_name) {
      lookupMap.set(c.display_name, c)
      lookupMap.set(c.display_name.toLowerCase(), c)
    }
  }

  const irEntities: ChenIREntity[] = normalized.concepts.map((c) => {
    const cid = c.id!
    const attrs = c.attributes ?? []
    const keyAttrs = attrs.filter((a) => a.is_business_key)
    const bizAttrs = attrs.filter((a) => !a.is_business_key)
    const selectedAttrs: ConceptAttribute[] = [
      ...keyAttrs,
      ...bizAttrs.slice(0, Math.max(0, 5 - keyAttrs.length)),
    ]
    if (selectedAttrs.length === 0 && attrs.length > 0) {
      selectedAttrs.push(attrs[0])
    }

    const displayName = c.display_name || getEntityChineseName(c.name, c.description)

    return {
      id: cid,
      name: c.name,
      displayName,
      selectionIds: [cid],
      resolveCustomPosition: (customPositions) => lookupConceptPosition(c, customPositions),
      buildNodeData: (pos) => ({
        concept: c,
        name: c.name,
        displayName,
        conceptId: cid,
        entity: {
          id: cid,
          name: c.name,
          comment: c.description,
          position: pos,
          attributes: attrs.map((ca) => ({
            id: ca.id || `attr_${cid}_${ca.name}`,
            name: ca.name,
            comment: ca.display_name,
            db_type: ca.category,
            code_type: ca.category,
            is_primary_key: Boolean(ca.is_business_key),
            is_nullable: !ca.required,
            is_unique: Boolean(ca.is_unique),
            description: ca.description || ca.display_name || '',
          })),
        },
      }),
      attributes: selectedAttrs.map((attr) => {
        const attrKey = attr.id || attr.name
        return {
          nodeId: `attr-${cid}-${attrKey}`,
          data: {
            conceptAttribute: attr,
            name: attr.name,
            displayName:
              attr.display_name ||
              getAttributeChineseName(attr.name, attr.description, attr.is_business_key),
            isKey: Boolean(attr.is_business_key),
            category: attr.category,
            description: attr.description,
            entityId: cid,
            entityName: c.name,
            attribute: {
              id: attrKey,
              name: attr.name,
              comment: attr.display_name,
              db_type: attr.category,
              code_type: attr.category,
              is_primary_key: Boolean(attr.is_business_key),
              is_nullable: !attr.required,
              is_unique: Boolean(attr.is_unique),
              description: attr.description || attr.display_name || '',
            },
          },
        }
      }),
    }
  })

  const irRelations: ChenIRRelation[] = []
  const processedPairs = new Set<string>()

  for (const rel of normalized.relations) {
    const src = lookupMap.get(rel.source_concept) ?? lookupMap.get(rel.source_concept.toLowerCase())
    const tgt = lookupMap.get(rel.target_concept) ?? lookupMap.get(rel.target_concept.toLowerCase())
    if (!src || !tgt) continue

    const srcId = src.id!
    const tgtId = tgt.id!
    const isSelf = srcId === tgtId
    const pairKey = isSelf
      ? `self--${srcId}--${rel.id || rel.name || 'self'}`
      : [srcId, tgtId].toSorted().join('--')
    if (processedPairs.has(pairKey)) continue
    processedPairs.add(pairKey)

    const rawId = rel.id!
    const diaId = rawId.startsWith('rel-') ? rawId : `rel-${rawId}`
    const card: Cardinality = rel.cardinality || 'one_to_many'

    irRelations.push({
      id: diaId,
      relationId: rawId,
      name: rel.name || getRelationshipVerb(src.name, tgt.name, card),
      cardinality: card,
      sourceId: srcId,
      targetId: tgtId,
      sourceCardLabel: card === 'many_to_many' ? 'M' : '1',
      targetCardLabel: card === 'one_to_one' ? '1' : 'N',
      isSelf,
      propagateEdgeSelection: true,
      selectionIds: [diaId, rawId],
      resolveCustomPosition: (customPositions) =>
        lookupConceptRelationPosition(
          {
            diamondId: diaId,
            relationId: rawId,
            sourceName: src.name,
            targetName: tgt.name,
            fallbackPosition: rel.position,
          },
          customPositions,
        ),
    })
  }

  return {
    entities: irEntities,
    relations: irRelations,
  }
}
