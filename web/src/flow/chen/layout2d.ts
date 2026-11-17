import type { Position } from '../../types/dsl'
import { CHEN_NODE_DIMENSIONS } from './dimensions'

export interface ChenLayoutInputEntity {
  id: string
  name: string
}

export interface ChenLayoutInputRelation {
  id: string
  sourceId: string
  targetId: string
  isSelf?: boolean
}

export interface ChenEntityFreeFace {
  preferTop: boolean
  preferBottom: boolean
}

export interface ChenLayoutOutput {
  entityPositions: Map<string, Position>
  relationPositions: Map<string, Position>
  freeFaces: Map<string, ChenEntityFreeFace>
}

export interface Chen2DLayoutOptions {
  entityW?: number
  entityH?: number
  relationW?: number
  relationH?: number
  colGap?: number
  rowGap?: number
  originX?: number
  originY?: number
}

/**
 * 按无向连通分量拆分子图，用于独立子图与孤立节点的确定性归置。
 */
export function extractConnectedComponents(
  entities: readonly ChenLayoutInputEntity[],
  adj: ReadonlyMap<string, ReadonlySet<string>>,
): ChenLayoutInputEntity[][] {
  const visited = new Set<string>()
  const byId = new Map(entities.map((e) => [e.id, e]))
  const components: ChenLayoutInputEntity[][] = []

  for (const ent of entities) {
    if (visited.has(ent.id)) continue
    const comp: ChenLayoutInputEntity[] = []
    const queue = [ent.id]
    visited.add(ent.id)

    while (queue.length > 0) {
      const curId = queue.shift()!
      const curEnt = byId.get(curId)
      if (curEnt) comp.push(curEnt)
      for (const nextId of adj.get(curId) ?? []) {
        if (!visited.has(nextId)) {
          visited.add(nextId)
          queue.push(nextId)
        }
      }
    }
    components.push(comp)
  }

  return components
}

/**
 * 拓扑感知 2D 紧凑聚类排版引擎：
 * 1. 自动识别中心枢纽实体（Hub Entity）并置顶居中；
 * 2. 聚类关联子图为 2D 紧凑网格，控制宽高比在舒适宽屏比例；
 * 3. 联系菱形在两端实体几何中心插值，并自动绕行中间障碍实体与已放置菱形；
 * 4. 推算实体空闲外侧面（Free Faces）供属性椭圆向外吸附。
 */
export function computeChen2DLayout(
  entities: ChenLayoutInputEntity[],
  relations: ChenLayoutInputRelation[],
  options?: Chen2DLayoutOptions,
): ChenLayoutOutput {
  const EW = options?.entityW ?? CHEN_NODE_DIMENSIONS.entity.width
  const EH = options?.entityH ?? CHEN_NODE_DIMENSIONS.entity.height
  const RW = options?.relationW ?? CHEN_NODE_DIMENSIONS.relation.width
  const RH = options?.relationH ?? CHEN_NODE_DIMENSIONS.relation.height
  const COL_GAP = options?.colGap ?? CHEN_NODE_DIMENSIONS.layout.colGap
  const ROW_GAP = options?.rowGap ?? CHEN_NODE_DIMENSIONS.layout.rowGap
  const ORIGIN_X = options?.originX ?? CHEN_NODE_DIMENSIONS.layout.originX
  const ORIGIN_Y = options?.originY ?? CHEN_NODE_DIMENSIONS.layout.originY

  const entityPositions = new Map<string, Position>()
  const relationPositions = new Map<string, Position>()
  const freeFaces = new Map<string, ChenEntityFreeFace>()

  if (entities.length === 0) {
    return { entityPositions, relationPositions, freeFaces }
  }

  const adj = new Map<string, Set<string>>()
  const entityMap = new Map<string, ChenLayoutInputEntity>()
  for (const ent of entities) {
    adj.set(ent.id, new Set())
    entityMap.set(ent.id, ent)
  }

  const validRelations = relations.filter(
    (r) => !r.isSelf && r.sourceId !== r.targetId && entityMap.has(r.sourceId) && entityMap.has(r.targetId),
  )

  for (const rel of validRelations) {
    adj.get(rel.sourceId)!.add(rel.targetId)
    adj.get(rel.targetId)!.add(rel.sourceId)
  }

  const degrees = new Map<string, number>()
  for (const ent of entities) {
    degrees.set(ent.id, adj.get(ent.id)?.size ?? 0)
  }

  const sortedEntities = entities.toSorted(
    (a, b) => (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0),
  )

  const gridCoords = new Map<string, { row: number; col: number }>()
  const topHub = sortedEntities[0]
  const hubNeighbors = adj.get(topHub.id) ?? new Set<string>()

  // 5 实体典型企业双翼模型特化聚类（Hub 居中置顶，左翼组织架构，右翼权限体系）
  if (entities.length === 5 && (degrees.get(topHub.id) ?? 0) >= 3) {
    const nonHubs = entities.filter((e) => e.id !== topHub.id)
    let leftCluster: ChenLayoutInputEntity[] = []
    let rightCluster: ChenLayoutInputEntity[] = []

    for (let i = 0; i < nonHubs.length; i++) {
      for (let j = i + 1; j < nonHubs.length; j++) {
        const e1 = nonHubs[i]
        const e2 = nonHubs[j]
        if (adj.get(e1.id)?.has(e2.id)) {
          const rest = nonHubs.filter((e) => e.id !== e1.id && e.id !== e2.id)
          leftCluster = [e1, e2]
          rightCluster = rest
          break
        }
      }
      if (leftCluster.length > 0) break
    }

    if (leftCluster.length === 2 && rightCluster.length === 2) {
      if (!hubNeighbors.has(leftCluster[0].id) && hubNeighbors.has(leftCluster[1].id)) {
        leftCluster.reverse()
      }
      if (!hubNeighbors.has(rightCluster[0].id) && hubNeighbors.has(rightCluster[1].id)) {
        rightCluster.reverse()
      }

      gridCoords.set(topHub.id, { row: 0, col: 1 })
      gridCoords.set(leftCluster[0].id, { row: 0, col: 0 })
      gridCoords.set(leftCluster[1].id, { row: 1, col: 0 })
      gridCoords.set(rightCluster[0].id, { row: 0, col: 2 })
      gridCoords.set(rightCluster[1].id, { row: 1, col: 2 })
    }
  }

  // 通用连通分量感知 2D 紧凑网格嵌入
  if (gridCoords.size < entities.length) {
    gridCoords.clear()
    const N = entities.length
    if (N === 1) {
      gridCoords.set(entities[0].id, { row: 0, col: 0 })
    } else if (N === 2) {
      gridCoords.set(entities[0].id, { row: 0, col: 0 })
      gridCoords.set(entities[1].id, { row: 0, col: 1 })
    } else if (N === 3) {
      gridCoords.set(sortedEntities[0].id, { row: 0, col: 1 })
      gridCoords.set(sortedEntities[1].id, { row: 1, col: 0 })
      gridCoords.set(sortedEntities[2].id, { row: 1, col: 2 })
    } else if (N === 4) {
      gridCoords.set(sortedEntities[0].id, { row: 0, col: 0 })
      gridCoords.set(sortedEntities[1].id, { row: 0, col: 1 })
      gridCoords.set(sortedEntities[2].id, { row: 1, col: 0 })
      gridCoords.set(sortedEntities[3].id, { row: 1, col: 1 })
    } else {
      const C = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(N * 1.4))))
      const R = Math.ceil(N / C)
      const occupied = new Set<string>()
      const getCellKey = (r: number, c: number) => `${r},${c}`

      // 按连通分量从大到小依次嵌入，防止孤立子图打散核心主连通块
      const components = extractConnectedComponents(sortedEntities, adj).toSorted(
        (a, b) => b.length - a.length,
      )
      const orderedQueue = components.flat()

      const hubCol = Math.floor(C / 2)
      gridCoords.set(orderedQueue[0].id, { row: 0, col: hubCol })
      occupied.add(getCellKey(0, hubCol))
      const placed = new Set<string>([orderedQueue[0].id])

      while (placed.size < N) {
        let bestCandidate: ChenLayoutInputEntity | null = null
        let bestScore = -1

        for (const ent of orderedQueue) {
          if (placed.has(ent.id)) continue
          let placedNeighborsCount = 0
          for (const nId of adj.get(ent.id) ?? []) {
            if (placed.has(nId)) placedNeighborsCount += 1
          }
          const score = placedNeighborsCount * 100 + (degrees.get(ent.id) ?? 0)
          if (score > bestScore) {
            bestScore = score
            bestCandidate = ent
          }
        }

        if (!bestCandidate) {
          bestCandidate = orderedQueue.find((e) => !placed.has(e.id)) ?? null
          if (!bestCandidate) break
        }

        let bestCell = { row: 0, col: 0 }
        let minCost = Infinity

        for (let r = 0; r < R + 2; r++) {
          for (let c = 0; c < C; c++) {
            const key = getCellKey(r, c)
            if (occupied.has(key)) continue

            let cost = 0
            for (const nId of adj.get(bestCandidate.id) ?? []) {
              if (placed.has(nId)) {
                const nPos = gridCoords.get(nId)!
                cost += Math.abs(r - nPos.row) * 1.5 + Math.abs(c - nPos.col)
              }
            }
            cost += r * 0.2 + Math.abs(c - hubCol) * 0.1

            if (cost < minCost) {
              minCost = cost
              bestCell = { row: r, col: c }
            }
          }
        }

        gridCoords.set(bestCandidate.id, bestCell)
        occupied.add(getCellKey(bestCell.row, bestCell.col))
        placed.add(bestCandidate.id)
      }
    }
  }

  for (const ent of entities) {
    const cell = gridCoords.get(ent.id) ?? { row: 0, col: 0 }
    entityPositions.set(ent.id, {
      x: ORIGIN_X + cell.col * COL_GAP,
      y: ORIGIN_Y + cell.row * ROW_GAP,
    })
  }

  for (const ent of entities) {
    const myPos = entityPositions.get(ent.id)!
    let hasAbove = false
    let hasBelow = false

    for (const nId of adj.get(ent.id) ?? []) {
      const nPos = entityPositions.get(nId)
      if (!nPos) continue
      if (nPos.y < myPos.y - 40) hasAbove = true
      if (nPos.y > myPos.y + 40) hasBelow = true
    }

    freeFaces.set(ent.id, {
      preferTop: !hasAbove,
      preferBottom: !hasBelow && hasAbove,
    })
  }

  const processedPairCounts = new Map<string, number>()
  const placedDiamonds: Array<{ id: string; cx: number; cy: number }> = []

  for (const rel of relations) {
    if (rel.isSelf || rel.sourceId === rel.targetId) {
      const srcPos = entityPositions.get(rel.sourceId)
      if (srcPos) {
        const selfX = srcPos.x + EW + 60
        const selfY = srcPos.y - 10
        relationPositions.set(rel.id, { x: selfX, y: selfY })
        placedDiamonds.push({
          id: rel.id,
          cx: selfX + RW / 2,
          cy: selfY + RH / 2,
        })
      }
      continue
    }

    const srcPos = entityPositions.get(rel.sourceId)
    const tgtPos = entityPositions.get(rel.targetId)
    if (!srcPos || !tgtPos) continue

    const srcCenter = { x: srcPos.x + EW / 2, y: srcPos.y + EH / 2 }
    const tgtCenter = { x: tgtPos.x + EW / 2, y: tgtPos.y + EH / 2 }

    const pairKey = [rel.sourceId, rel.targetId].toSorted().join('--')
    const count = processedPairCounts.get(pairKey) ?? 0
    processedPairCounts.set(pairKey, count + 1)

    let midX = (srcCenter.x + tgtCenter.x) / 2
    let midY = (srcCenter.y + tgtCenter.y) / 2

    if (count > 0) {
      const dx = tgtCenter.x - srcCenter.x
      const dy = tgtCenter.y - srcCenter.y
      const len = Math.hypot(dx, dy) || 1
      const sign = count % 2 === 1 ? 1 : -1
      midX += (-dy / len) * 45 * sign
      midY += (dx / len) * 45 * sign
    }

    const testEntityCollision = (cx: number, cy: number) => {
      for (const ent of entities) {
        if (ent.id === rel.sourceId || ent.id === rel.targetId) continue
        const ep = entityPositions.get(ent.id)
        if (!ep) continue
        const ecx = ep.x + EW / 2
        const ecy = ep.y + EH / 2
        const safeW = (EW + RW) / 2 + 25
        const safeH = (EH + RH) / 2 + 25
        if (Math.abs(cx - ecx) < safeW && Math.abs(cy - ecy) < safeH) {
          return { collides: true, ecx, ecy }
        }
      }
      return { collides: false, ecx: 0, ecy: 0 }
    }

    const colCheck = testEntityCollision(midX, midY)
    if (colCheck.collides) {
      const dx = tgtCenter.x - srcCenter.x
      const dy = tgtCenter.y - srcCenter.y
      const isHorizontal = Math.abs(dx) >= Math.abs(dy)
      const candidates: Position[] = isHorizontal
        ? [
            { x: midX, y: colCheck.ecy + ROW_GAP * 0.45 },
            { x: midX, y: colCheck.ecy - ROW_GAP * 0.45 },
            { x: midX, y: colCheck.ecy + 110 },
            { x: midX, y: colCheck.ecy - 110 },
          ]
        : [
            { x: colCheck.ecx + COL_GAP * 0.45, y: midY },
            { x: colCheck.ecx - COL_GAP * 0.45, y: midY },
            { x: colCheck.ecx + 130, y: midY },
            { x: colCheck.ecx - 130, y: midY },
          ]

      for (const cand of candidates) {
        if (!testEntityCollision(cand.x, cand.y).collides) {
          midX = cand.x
          midY = cand.y
          break
        }
      }
    }

    for (const other of placedDiamonds) {
      const dist = Math.hypot(midX - other.cx, midY - other.cy)
      if (dist < Math.max(RW, RH) + 15) {
        midX += 50
        midY += 35
      }
    }

    placedDiamonds.push({ id: rel.id, cx: midX, cy: midY })
    relationPositions.set(rel.id, {
      x: midX - RW / 2,
      y: midY - RH / 2,
    })
  }

  return { entityPositions, relationPositions, freeFaces }
}
