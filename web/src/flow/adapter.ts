import { Position, type Edge, type Node } from '@xyflow/react'

import type { Entity, ERDesign, Relation } from '../types/dsl'

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

  return design.relations
    .filter(
      (relation) =>
        nameByID.has(relation.source_entity_id) && nameByID.has(relation.target_entity_id),
    )
    .map((relation) => ({
      id: relation.id,
      type: 'relation' as const,
      source: relation.source_entity_id,
      target: relation.target_entity_id,
      selected: relation.id === selectedRelationID,
      data: {
        relation,
        sourceName: nameByID.get(relation.source_entity_id) ?? '',
        targetName: nameByID.get(relation.target_entity_id) ?? '',
      },
    }))
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
