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
  const rowGap = 64
  const columnGap = 160

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
  const cleanRelations = (design.relations ?? []).filter(
    (r) => r.source_entity_id !== r.target_entity_id,
  )
  const cleanedDesign = { ...design, relations: cleanRelations }

  const missing = cleanedDesign.entities.filter((entity) => !entity.position)
  if (missing.length === 0) {
    return cleanedDesign
  }
  if (missing.length === cleanedDesign.entities.length) {
    return layoutDesign(cleanedDesign)
  }
  return placeNewEntities(
    cleanedDesign,
    missing.map((entity) => entity.id),
  )
}

/**
 * 专业紧凑 ER 智能分层排版算法（Compact ER Layout Engine）。
 *
 * 针对数据库 ER 图与通用流程图的本质区别进行专门优化：
 * 1. 中心维度表解耦（Hub Table Decoupling）：对超高出度实体（如 users），将跨层引用标记为松弛边，
 *    避免单表将整张图拉扯为 4~5 列的稀疏巨幅画卷；
 * 2. 垂直死区消除与紧凑压缩（Vertical Dead Space Compaction）：
 *    消除传统 Dagre 对齐产生的大量数百像素空白断层（如 500px 荒芜死区），紧凑收拢列内间距至 52px；
 * 3. 几何中心平衡：对短列做柔和的垂直居中平衡，实现蓝图级的工整对称美感。
 */
export function layoutDesign(design: ERDesign): ERDesign {
  if (design.entities.length === 0) {
    return design
  }

  const currentWidth = nodeWidth()
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 48,
    ranksep: 110,
    marginx: 48,
    marginy: 48,
  })

  for (const entity of design.entities) {
    graph.setNode(entity.id, { width: currentWidth, height: nodeHeight(entity) })
  }

  // 统计每张表的出度与入度，识别中心维度表
  const outDegree = new Map<string, number>()
  const inDegree = new Map<string, number>()
  for (const rel of design.relations) {
    if (rel.source_entity_id === rel.target_entity_id) continue
    outDegree.set(rel.source_entity_id, (outDegree.get(rel.source_entity_id) || 0) + 1)
    inDegree.set(rel.target_entity_id, (inDegree.get(rel.target_entity_id) || 0) + 1)
  }

  // 构建主干拓扑骨架，跨级长边设为松弛边避免强行拉大列数
  for (const rel of design.relations) {
    if (
      rel.source_entity_id === rel.target_entity_id ||
      !graph.hasNode(rel.source_entity_id) ||
      !graph.hasNode(rel.target_entity_id)
    ) {
      continue
    }

    const isHubSource = (outDegree.get(rel.source_entity_id) || 0) >= 3
    const hasMultipleParents = (inDegree.get(rel.target_entity_id) || 0) > 1
    // 如果源表是高出度 Hub 表且目标表已有主要业务父级（非 products 核心实体），作为松弛边处理
    const isCrossCutting = isHubSource && hasMultipleParents && !rel.target_entity_id.toLowerCase().includes('product')

    if (!isCrossCutting) {
      graph.setEdge(rel.source_entity_id, rel.target_entity_id, {
        weight: rel.cardinality === 'one_to_one' ? 3 : 2,
        minlen: 1,
      })
    }
  }

  dagre.layout(graph)

  // 按 X 坐标波段划分列（将 100px 容差内的节点聚在同一列）
  const colMap = new Map<number, Array<{ id: string; x: number; y: number; width: number; height: number }>>()
  const nodeMap = new Map<string, { id: string; x: number; y: number; width: number; height: number }>()

  for (const entity of design.entities) {
    const laidOut = graph.node(entity.id) as { x: number; y: number } | undefined
    if (!laidOut) continue

    const h = nodeHeight(entity)
    const item = {
      id: entity.id,
      x: laidOut.x,
      y: laidOut.y,
      width: currentWidth,
      height: h,
    }
    nodeMap.set(entity.id, item)

    const colBand = Math.round(laidOut.x / 100) * 100
    if (!colMap.has(colBand)) colMap.set(colBand, [])
    colMap.get(colBand)!.push(item)
  }

  // 垂直死区消除（Vertical Dead Space Compaction）：消除列内悬殊的数百像素空白空洞
  const targetGap = 52
  const sortedColBands = Array.from(colMap.keys()).sort((a, b) => a - b)

  for (const band of sortedColBands) {
    const colNodes = colMap.get(band)!
    colNodes.sort((a, b) => a.y - b.y)

    for (let i = 1; i < colNodes.length; i++) {
      const prev = colNodes[i - 1]
      const curr = colNodes[i]
      const prevBottom = prev.y + prev.height / 2
      const currTop = curr.y - curr.height / 2
      const actualGap = currTop - prevBottom

      if (actualGap > targetGap) {
        const shiftY = actualGap - targetGap
        for (let j = i; j < colNodes.length; j++) {
          colNodes[j].y -= shiftY
        }
      }
    }
  }

  // 计算全局 Y 轴包围盒
  let minY = Infinity
  let maxY = -Infinity
  for (const n of nodeMap.values()) {
    minY = Math.min(minY, n.y - n.height / 2)
    maxY = Math.max(maxY, n.y + n.height / 2)
  }
  const totalHeight = maxY - minY

  // 短列柔和垂直居中（平滑对齐画布中轴）
  for (const band of sortedColBands) {
    const colNodes = colMap.get(band)!
    let colMinY = Infinity
    let colMaxY = -Infinity
    for (const n of colNodes) {
      colMinY = Math.min(colMinY, n.y - n.height / 2)
      colMaxY = Math.max(colMaxY, n.y + n.height / 2)
    }
    const colHeight = colMaxY - colMinY
    if (colHeight < totalHeight * 0.85) {
      const desiredTop = minY + (totalHeight - colHeight) / 2
      const shift = (desiredTop - colMinY) * 0.6
      for (const n of colNodes) {
        n.y += shift
      }
    }
  }

  const entities = design.entities.map((entity) => {
    const laidOut = nodeMap.get(entity.id)
    if (!laidOut) {
      return entity
    }
    return {
      ...entity,
      position: {
        x: Math.round(laidOut.x - laidOut.width / 2),
        y: Math.round(laidOut.y - laidOut.height / 2),
      },
    }
  })

  return { ...design, entities }
}
