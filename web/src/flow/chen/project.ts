import type { ChenEdgeType } from '../../components/chen/ChenEdge'
import type { Position } from '../../types/dsl'
import {
  getRowXOffsets,
  partitionAttributeFan,
  resolveChenCollisions,
  type ChenNode,
} from './collision'
import { CHEN_NODE_DIMENSIONS, getChenNodeSize } from './dimensions'
import { getNearestChenHandles } from './geometry'
import type { ChenGraphIR, ChenIRAttribute } from './ir'
import { computeChen2DLayout } from './layout2d'

export interface ProjectChenOptions {
  selectedId?: string | null
  customPositions?: Record<string, Position>
}

/**
 * 单一权威陈氏 ER 图投影管线（`ChenGraphIR` -> React Flow `{ nodes, edges }`）。
 * 彻底合并原先两套镜像克隆的物理/概念陈氏图构建流程。
 */
export function projectChenIRToFlow(
  ir: ChenGraphIR,
  options?: ProjectChenOptions,
): { nodes: ChenNode[]; edges: ChenEdgeType[] } {
  if (!ir.entities.length) {
    return { nodes: [], edges: [] }
  }

  const selectedId = options?.selectedId ?? null
  const customPositions = options?.customPositions

  const { entity: entDim, relation: relDim, attribute: attrDim, layout: layoutCfg } =
    CHEN_NODE_DIMENSIONS

  const layout = computeChen2DLayout(
    ir.entities.map((e) => ({ id: e.id, name: e.name })),
    ir.relations.map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      targetId: r.targetId,
      isSelf: r.isSelf,
    })),
    {
      entityW: entDim.width,
      entityH: entDim.height,
      relationW: relDim.width,
      relationH: relDim.height,
      colGap: layoutCfg.colGap,
      rowGap: layoutCfg.rowGap,
      originX: layoutCfg.originX,
      originY: layoutCfg.originY,
    },
  )

  const nodes: ChenNode[] = []
  const edges: ChenEdgeType[] = []

  const emitAttrRow = (
    entityId: string,
    attrs: ChenIRAttribute[],
    rowCenterY: number,
    baseCenterX: number,
    placement: 'top' | 'bottom',
  ) => {
    if (attrs.length === 0) return
    const offsets = getRowXOffsets(attrs.length)
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i]
      const defaultPos: Position = {
        x: baseCenterX + offsets[i] - attrDim.width / 2,
        y: rowCenterY - attrDim.height / 2,
      }
      nodes.push({
        id: attr.nodeId,
        type: 'chenAttribute',
        position: customPositions?.[attr.nodeId] ?? defaultPos,
        data: attr.data,
      })
      edges.push({
        id: `edge-${entityId}-${attr.nodeId}`,
        type: 'chenEdge',
        source: entityId,
        target: attr.nodeId,
        sourceHandle: placement === 'top' ? 'top-source' : 'bottom-source',
        targetHandle: placement === 'top' ? 'bottom-target' : 'top-target',
        data: { isAttributeEdge: true },
      })
    }
  }

  for (const ent of ir.entities) {
    const defaultPos = layout.entityPositions.get(ent.id) ?? { x: 100, y: 100 }
    const customPos = ent.resolveCustomPosition(customPositions)
    const entityPos: Position = customPos ? { x: customPos.x, y: customPos.y } : defaultPos

    nodes.push({
      id: ent.id,
      type: 'chenEntity',
      position: entityPos,
      data: ent.buildNodeData(entityPos),
      selected: Boolean(selectedId && ent.selectionIds.includes(selectedId)),
    })

    const baseCenterX = entityPos.x + entDim.width / 2
    const baseCenterY = entityPos.y + entDim.height / 2
    const fan = partitionAttributeFan(ent.attributes, layout.freeFaces.get(ent.id))

    emitAttrRow(ent.id, fan.topAttrs, baseCenterY - layoutCfg.attrYOffset, baseCenterX, 'top')
    emitAttrRow(ent.id, fan.bottomAttrs, baseCenterY + layoutCfg.attrYOffset, baseCenterX, 'bottom')
  }

  for (const rel of ir.relations) {
    const defaultPos = layout.relationPositions.get(rel.id) ?? { x: 250, y: 250 }
    const customPos = rel.resolveCustomPosition(customPositions)

    nodes.push({
      id: rel.id,
      type: 'chenRelation',
      position: customPos ? { x: customPos.x, y: customPos.y } : defaultPos,
      data: {
        relationId: rel.relationId,
        name: rel.name,
        cardinality: rel.cardinality,
        sourceEntityId: rel.sourceId,
        targetEntityId: rel.targetId,
        ...(rel.isJunctionTable ? { isJunctionTable: true } : {}),
      },
      selected: Boolean(selectedId && rel.selectionIds.includes(selectedId)),
    })
  }

  resolveChenCollisions(nodes, layoutCfg.collisionMinGap)

  const nodeCenterMap = new Map<string, Position>()
  for (const n of nodes) {
    const size = getChenNodeSize(n.type)
    nodeCenterMap.set(n.id, {
      x: n.position.x + size.width / 2,
      y: n.position.y + size.height / 2,
    })
  }

  for (const rel of ir.relations) {
    const isRelSelected = Boolean(
      rel.propagateEdgeSelection && selectedId && rel.selectionIds.includes(selectedId),
    )

    if (rel.isSelf) {
      edges.push({
        id: `edge-${rel.sourceId}-${rel.id}`,
        type: 'chenEdge',
        source: rel.sourceId,
        target: rel.id,
        sourceHandle: 'right-source',
        targetHandle: 'left-target',
        data: {
          cardinalityLabel: rel.sourceCardLabel,
          isAttributeEdge: false,
          isSelfLoop: true,
          loopDirection: 'top',
        },
        selected: isRelSelected,
      })
      edges.push({
        id: `edge-${rel.id}-${rel.targetId}`,
        type: 'chenEdge',
        source: rel.id,
        target: rel.targetId,
        sourceHandle: 'left-source',
        targetHandle: 'right-target',
        data: {
          cardinalityLabel: rel.targetCardLabel,
          isAttributeEdge: false,
          isSelfLoop: true,
          loopDirection: 'bottom',
        },
        selected: isRelSelected,
      })
      continue
    }

    const srcCenter = nodeCenterMap.get(rel.sourceId) ?? { x: 0, y: 0 }
    const diaCenter = nodeCenterMap.get(rel.id) ?? { x: 0, y: 0 }
    const tgtCenter = nodeCenterMap.get(rel.targetId) ?? { x: 0, y: 0 }

    const h1 = getNearestChenHandles(srcCenter, diaCenter)
    const h2 = getNearestChenHandles(diaCenter, tgtCenter)

    edges.push({
      id: `edge-${rel.sourceId}-${rel.id}`,
      type: 'chenEdge',
      source: rel.sourceId,
      target: rel.id,
      sourceHandle: h1.sourceHandle,
      targetHandle: h1.targetHandle,
      data: {
        cardinalityLabel: rel.sourceCardLabel,
        isAttributeEdge: false,
      },
      ...(rel.propagateEdgeSelection ? { selected: isRelSelected } : {}),
    })

    edges.push({
      id: `edge-${rel.id}-${rel.targetId}`,
      type: 'chenEdge',
      source: rel.id,
      target: rel.targetId,
      sourceHandle: h2.sourceHandle,
      targetHandle: h2.targetHandle,
      data: {
        cardinalityLabel: rel.targetCardLabel,
        isAttributeEdge: false,
      },
      ...(rel.propagateEdgeSelection ? { selected: isRelSelected } : {}),
    })
  }

  return { nodes, edges }
}
