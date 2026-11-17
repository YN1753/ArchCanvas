import { Position, type Edge, type Node } from '@xyflow/react'

import {
  isForeignKeyColumnName,
  matchesEntityForeignKeyColumn,
  resolvePrimaryKeyAttribute,
  resolveRelationForeignKey,
} from '../domain/foreignKey'
import type { Entity, ERDesign, Relation } from '../types/dsl'

export { isForeignKeyColumnName }

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
export const NODE_FOOTER_PADDING = 44

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
  return (
    NODE_HEADER_HEIGHT +
    Math.max(entity.attributes?.length ?? 0, 1) * NODE_ROW_HEIGHT +
    NODE_FOOTER_PADDING
  )
}

export function toFlowNodes(
  design: ERDesign,
  selectedEntityID?: string | null,
): TableNode[] {
  const entityMap = new Map(design.entities.map((e) => [e.id, e]))

  // 收集每个实体拥有的外键字段名（包含关系解析出的角色外键与语法外键）
  const fkNamesByEntity = new Map<string, Set<string>>()
  const usedFkByEntity = new Map<string, Set<string>>()

  for (const rel of design.relations) {
    const src = entityMap.get(rel.source_entity_id)
    const tgt = entityMap.get(rel.target_entity_id)
    if (!src || !tgt) continue

    if (!fkNamesByEntity.has(tgt.id)) fkNamesByEntity.set(tgt.id, new Set())
    if (!usedFkByEntity.has(tgt.id)) usedFkByEntity.set(tgt.id, new Set())
    const fkSet = fkNamesByEntity.get(tgt.id)!
    const usedSet = usedFkByEntity.get(tgt.id)!

    const resolvedFk = resolveRelationForeignKey(src, tgt, {
      usedAttrIds: usedSet,
      allEntities: design.entities,
      fallbackToAnyNonPk: false,
    })
    if (resolvedFk) {
      usedSet.add(resolvedFk.id)
      fkSet.add(resolvedFk.name)
    }

    for (const attr of tgt.attributes ?? []) {
      if (!attr.is_primary_key && matchesEntityForeignKeyColumn(attr.name, src.name)) {
        fkSet.add(attr.name)
      }
    }
  }

  return design.entities.map((entity) => {
    const fkSet = fkNamesByEntity.get(entity.id) ?? new Set<string>()
    for (const attr of entity.attributes ?? []) {
      if (!attr.is_primary_key && isForeignKeyColumnName(attr.name)) {
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

  const usedFkByEntity = new Map<string, Set<string>>()
  const outCountByEntity = new Map<string, number>()

  return design.relations
    .filter(
      (relation) =>
        nameByID.has(relation.source_entity_id) &&
        nameByID.has(relation.target_entity_id),
    )
    .map((relation) => {
      const srcEnt = entityMap.get(relation.source_entity_id)
      const tgtEnt = entityMap.get(relation.target_entity_id)

      const laneIndex = outCountByEntity.get(relation.source_entity_id) ?? 0
      outCountByEntity.set(relation.source_entity_id, laneIndex + 1)

      const sourceAttr = resolvePrimaryKeyAttribute(srcEnt)

      if (!usedFkByEntity.has(relation.target_entity_id)) {
        usedFkByEntity.set(relation.target_entity_id, new Set())
      }
      const usedSet = usedFkByEntity.get(relation.target_entity_id)!
      const targetAttr = resolveRelationForeignKey(srcEnt, tgtEnt, {
        usedAttrIds: usedSet,
        allEntities: design.entities,
        fallbackToAnyNonPk: relation.source_entity_id !== relation.target_entity_id,
      })

      if (targetAttr) {
        usedSet.add(targetAttr.id)
      }

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
