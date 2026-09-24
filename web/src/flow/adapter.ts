import { Position, type Edge, type Node } from '@xyflow/react'

import type { Attribute, Entity, ERDesign, Relation } from '../types/dsl'

/**
 * DSL ↔ React Flow 适配层。
 *
 * 这一层是「单向投影」：DSL 决定画布长什么样，画布不能反过来成为模型。
 * 每个 node 的 id 就是实体 ID，每个 edge 的 id 就是关系 ID，
 * 因此选择、编辑、删除都可以直接用领域对象的 ID 定位，不需要额外映射表。
 */

export const NODE_WIDTH = 272
export const NODE_HEADER_HEIGHT = 38
export const NODE_ROW_HEIGHT = 28
export const NODE_FOOTER_PADDING = 8

export interface TableNodeData extends Record<string, unknown> {
  entity: Entity
  foreignKeyAttrNames?: string[]
}

export interface RelationEdgeData extends Record<string, unknown> {
  relation: Relation
  sourceName: string
  targetName: string
  sourceAttrId?: string
  targetAttrId?: string
  sourceAttrName?: string
  targetAttrName?: string
  laneIndex?: number
}

export type TableNode = Node<TableNodeData, 'table'>
export type RelationEdge = Edge<RelationEdgeData, 'relation'>

export function nodeWidth(): number {
  return NODE_WIDTH
}

/** 节点高度必须与 TableNode 的真实渲染一致，否则 dagre 布局会出现重叠。 */
export function nodeHeight(entity: Entity): number {
  return NODE_HEADER_HEIGHT + Math.max(entity.attributes.length, 1) * NODE_ROW_HEIGHT + NODE_FOOTER_PADDING
}

/** 查找宿端匹配源端的外键属性 */
function findTargetForeignKeyAttribute(
  sourceEntity: Entity,
  targetEntity: Entity,
  usedAttrIds: Set<string>,
): Attribute | undefined {
  const srcName = sourceEntity.name.toLowerCase()
  const srcSingular = srcName.endsWith('s') ? srcName.slice(0, -1) : srcName

  // 1. 优先精确匹配以源实体名开头的外键字段（如 user_id, users_id, product_id）
  const exactCandidates = targetEntity.attributes.filter((attr) => {
    if (attr.is_primary_key || usedAttrIds.has(attr.id)) return false
    const name = attr.name.toLowerCase()
    return (
      name === `${srcName}_id` ||
      name === `${srcSingular}_id` ||
      name === `${srcName}id` ||
      name === `${srcSingular}id`
    )
  })
  if (exactCandidates.length > 0) {
    return exactCandidates[0]
  }

  // 2. 角色语义外键（如 seller_id, buyer_id, reviewer_id, participant_a_id 等）
  const fkCandidates = targetEntity.attributes.filter((attr) => {
    if (attr.is_primary_key || usedAttrIds.has(attr.id)) return false
    const name = attr.name.toLowerCase()
    return name.endsWith('_id') || name.endsWith('id')
  })
  if (fkCandidates.length > 0) {
    return fkCandidates[0]
  }

  // 3. 兜底返回第一个非主键字段
  return targetEntity.attributes.find((attr) => !attr.is_primary_key && !usedAttrIds.has(attr.id))
}

export function toFlowNodes(
  design: ERDesign,
  selectedEntityID?: string | null,
): TableNode[] {
  const entityMap = new Map(design.entities.map((e) => [e.id, e]))

  // 收集每个实体拥有的外键字段名
  const fkNamesByEntity = new Map<string, Set<string>>()
  for (const rel of design.relations) {
    const src = entityMap.get(rel.source_entity_id)
    const tgt = entityMap.get(rel.target_entity_id)
    if (src && tgt) {
      const prefix = src.name.toLowerCase()
      for (const attr of tgt.attributes) {
        const attrLower = attr.name.toLowerCase()
        if (
          !attr.is_primary_key &&
          (attrLower === `${prefix}_id` ||
            attrLower === `${prefix}id` ||
            (attrLower.endsWith('_id') && attrLower !== 'id'))
        ) {
          if (!fkNamesByEntity.has(tgt.id)) fkNamesByEntity.set(tgt.id, new Set())
          fkNamesByEntity.get(tgt.id)!.add(attr.name)
        }
      }
    }
  }

  return design.entities.map((entity) => {
    const fkSet = fkNamesByEntity.get(entity.id) ?? new Set<string>()
    for (const attr of entity.attributes) {
      if (
        !attr.is_primary_key &&
        attr.name.toLowerCase().endsWith('_id') &&
        attr.name.toLowerCase() !== 'id'
      ) {
        fkSet.add(attr.name)
      }
    }

    return {
      id: entity.id,
      type: 'table' as const,
      position: entity.position ?? { x: 0, y: 0 },
      data: {
        entity,
        foreignKeyAttrNames: Array.from(fkSet),
      },
      selected: entity.id === selectedEntityID,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      width: nodeWidth(),
      height: nodeHeight(entity),
    }
  })
}

export function toFlowEdges(
  design: ERDesign,
  selectedRelationID?: string | null,
): RelationEdge[] {
  const nameByID = new Map(design.entities.map((entity) => [entity.id, entity.name]))
  const entityMap = new Map(design.entities.map((e) => [e.id, e]))

  // 记录每个实体已分配的外键字段 ID，避免多个同源关系竞争同一个外键字段
  const usedFkByEntity = new Map<string, Set<string>>()

  // 统计每张表的出边序号
  const outCountByEntity = new Map<string, number>()

  return design.relations
    .filter(
      (relation) =>
        nameByID.has(relation.source_entity_id) && nameByID.has(relation.target_entity_id),
    )
    .map((relation) => {
      const srcEnt = entityMap.get(relation.source_entity_id)
      const tgtEnt = entityMap.get(relation.target_entity_id)

      const laneIndex = outCountByEntity.get(relation.source_entity_id) ?? 0
      outCountByEntity.set(relation.source_entity_id, laneIndex + 1)

      // 方案 A：精准解析源主键属性与目标外键属性
      const sourceAttr = srcEnt?.attributes.find((a) => a.is_primary_key) ?? srcEnt?.attributes[0]

      if (!usedFkByEntity.has(relation.target_entity_id)) {
        usedFkByEntity.set(relation.target_entity_id, new Set())
      }
      const usedSet = usedFkByEntity.get(relation.target_entity_id)!
      const targetAttr = srcEnt && tgtEnt ? findTargetForeignKeyAttribute(srcEnt, tgtEnt, usedSet) : undefined

      if (targetAttr) {
        usedSet.add(targetAttr.id)
      }

      // 字段级行锚点：field-src-${id} 与 field-tgt-${id}，无匹配时平滑回退到表级锚点
      const sourceHandle = sourceAttr ? `field-src-${sourceAttr.id}` : 'tbl-src'
      const targetHandle = targetAttr ? `field-tgt-${targetAttr.id}` : 'tbl-tgt'

      return {
        id: relation.id,
        type: 'relation' as const,
        source: relation.source_entity_id,
        target: relation.target_entity_id,
        sourceHandle,
        targetHandle,
        selected: relation.id === selectedRelationID,
        data: {
          relation,
          sourceName: nameByID.get(relation.source_entity_id) ?? '',
          targetName: nameByID.get(relation.target_entity_id) ?? '',
          sourceAttrId: sourceAttr?.id,
          targetAttrId: targetAttr?.id,
          sourceAttrName: sourceAttr?.name,
          targetAttrName: targetAttr?.name,
          laneIndex,
        },
      }
    })
}

/** 把画布上的位置变化写回 DSL。位置属于展示信息，不参与结构校验。 */
export function applyNodePositions(design: ERDesign, positions: Map<string, { x: number; y: number }>): ERDesign {
  let changed = false
  const entities = design.entities.map((entity) => {
    const position = positions.get(entity.id)
    if (!position) {
      return entity
    }
    if (entity.position && entity.position.x === position.x && entity.position.y === position.y) {
      return entity
    }
    changed = true
    return { ...entity, position }
  })

  return changed ? { ...design, entities } : design
}
