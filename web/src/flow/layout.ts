import dagre from 'dagre'

import type { ERDesign } from '../types/dsl'
import { nodeHeight, nodeWidth } from './adapter'

/**
 * 给「刚被创建出来」的实体安排坐标。
 *
 * 为什么不做全量重排：用户在画布上摆的位置是他的劳动成果，
 * AI 新增一张表不该把整张图打乱。所以新表统一放到现有内容的右侧，
 * 只有用户显式点「自动布局」时才做全量重排。
 */
export function placeNewEntities(
  design: ERDesign,
  newEntityIDs: Iterable<string>,
): ERDesign {
  const pending = new Set(newEntityIDs)
  if (pending.size === 0) {
    return design
  }

  const currentWidth = nodeWidth()
  const placed = design.entities.filter((entity) => entity.position && !pending.has(entity.id))
  const startX =
    placed.length > 0 ? Math.max(...placed.map((entity) => entity.position!.x + currentWidth)) + 110 : 40
  const startY = 40
  const perColumn = 3
  const rowGap = 48
  const columnGap = 90

  const positions = new Map<string, { x: number; y: number }>()
  const columnOffsets = new Map<number, number>()

  let index = 0
  for (const entity of design.entities) {
    if (!pending.has(entity.id)) {
      continue
    }
    const column = Math.floor(index / perColumn)
    const offset = columnOffsets.get(column) ?? startY

    positions.set(entity.id, {
      x: startX + column * (currentWidth + columnGap),
      y: offset,
    })
    columnOffsets.set(column, offset + nodeHeight(entity) + rowGap)
    index += 1
  }

  return {
    ...design,
    entities: design.entities.map((entity) => {
      const position = positions.get(entity.id)
      return position ? { ...entity, position } : entity
    }),
  }
}

/**
 * 校验一份从服务端取回来的设计是否有可渲染的坐标。
 *
 * 坐标是展示信息，后端允许为空（比如纯 API 创建的设计）。
 * 如果有实体没有坐标，它们会全部堆在 (0,0) 重叠成一团，
 * 这时直接做一次全量布局 —— 反正这份设计本来就没有被手工摆过。
 */
export function ensureLayout(design: ERDesign): ERDesign {
  if (design.entities.length === 0) {
    return design
  }
  const missing = design.entities.filter((entity) => !entity.position)
  if (missing.length === 0) {
    return design
  }
  if (missing.length === design.entities.length) {
    return layoutDesign(design)
  }
  return placeNewEntities(
    design,
    missing.map((entity) => entity.id),
  )
}

/**
 * 用 dagre 给实体排一个左右向的层次布局。
 *
 * ER 图的阅读顺序通常是「主表在左、从表在右」，所以 rankdir 用 LR；
 * 关系密集时层次布局比力导向稳定得多，也不会出现节点漫天飞的情况。
 *
 * 这是全量重排，只在用户显式点「自动布局」时调用。
 */
export function layoutDesign(design: ERDesign): ERDesign {
  if (design.entities.length === 0) {
    return design
  }

  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 48,
    ranksep: 110,
    marginx: 40,
    marginy: 40,
  })

  const currentWidth = nodeWidth()
  for (const entity of design.entities) {
    graph.setNode(entity.id, { width: currentWidth, height: nodeHeight(entity) })
  }
  for (const relation of design.relations) {
    if (graph.hasNode(relation.source_entity_id) && graph.hasNode(relation.target_entity_id)) {
      graph.setEdge(relation.source_entity_id, relation.target_entity_id)
    }
  }

  dagre.layout(graph)

  const entities = design.entities.map((entity) => {
    const laidOut = graph.node(entity.id) as { x: number; y: number } | undefined
    if (!laidOut) {
      return entity
    }
    // dagre 返回中心点坐标，React Flow 用左上角坐标。
    return {
      ...entity,
      position: {
        x: Math.round(laidOut.x - currentWidth / 2),
        y: Math.round(laidOut.y - nodeHeight(entity) / 2),
      },
    }
  })

  return { ...design, entities }
}
