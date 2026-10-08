import type { Node } from '@xyflow/react'

import type {
  Attribute,
  BusinessConcept,
  Cardinality,
  ConceptAttribute,
  ConceptualDesign,
  Entity,
  ERDesign,
  Position,
  Relation,
} from '../types/dsl'
import { getAttributeChineseName, getEntityChineseName } from '../utils/chinese'
import type { ChenEntityNodeData } from '../components/chen/ChenEntityNode'
import type { ChenRelationNodeData } from '../components/chen/ChenRelationNode'
import type { ChenAttributeNodeData } from '../components/chen/ChenAttributeNode'
import type { ChenEdgeType } from '../components/chen/ChenEdge'

export type ChenNode = Node<ChenEntityNodeData | ChenRelationNodeData | ChenAttributeNodeData>

/**
 * 通用审计与技术运维字段名集合（不计入领域独立业务字段）
 */
export const TECHNICAL_AUDIT_FIELDS = new Set([
  'created_at',
  'create_time',
  'created_time',
  'create_at',
  'gmt_create',
  'created_date',
  'created_by',
  'creator',
  'updated_at',
  'update_time',
  'updated_time',
  'update_at',
  'gmt_modified',
  'updated_date',
  'updated_by',
  'updater',
  'deleted_at',
  'delete_time',
  'deleted_time',
  'delete_at',
  'is_deleted',
  'deleted',
  'del_flag',
  'version',
  'lock_version',
  'revision',
])

/**
 * 识别是否为多对多纯技术中间表（Junction Table）
 *
 * 核心判定法则：
 * 1. 显式用户配置（最高优先级）：
 *    - entity.is_junction_table === false：强制保留为实体与字段椭圆，绝不折叠；
 *    - entity.is_junction_table === true：只要能识别出两个关联父实体，强制折叠为多对多联系菱形。
 * 2. 必须能识别出至少 2 个不同的关联父实体（通过外键命名或组合表名）。
 * 3. 统计除主键、两端关联外键、技术审计字段之外的独立业务字段数：
 *    - 若业务字段数 > 1（例如包含 status, expire_at, amount, price, quantity 等），
 *      判定为“关联实体（Associative Entity）”，保留实体矩形及其业务属性椭圆，不强行折叠；
 *    - 若业务字段数 <= 1 且字段总数 <= 6，判定为轻量级/纯技术中间表，折叠为多对多联系。
 */
export function detectJunctionTable(
  entity: Entity,
  allEntities: Entity[],
): { isJunction: boolean; leftEntity?: Entity; rightEntity?: Entity; businessFieldCount?: number } {
  // 1. 显式用户配置：若用户显式关闭中间表折叠，强制保留
  if (entity.is_junction_table === false) {
    return { isJunction: false, businessFieldCount: 0 }
  }

  const normName = entity.name.toLowerCase()
  const attributes = entity.attributes || []

  // 2. 识别两端外键候选字段并匹配父实体
  const foreignKeys = attributes.filter(
    (a) => (a.name.endsWith('_id') || a.name.endsWith('id')) && a.name.toLowerCase() !== 'id',
  )

  const matchedParents: Entity[] = []
  const matchedFkAttrIds = new Set<string>()

  for (const fk of foreignKeys) {
    const base = fk.name.toLowerCase().replace(/_?id$/, '')
    for (const candidate of allEntities) {
      if (candidate.id === entity.id) continue
      const cName = candidate.name.toLowerCase()
      const cSingular = cName.endsWith('s') ? cName.slice(0, -1) : cName
      if (cName === base || cSingular === base || cName.includes(base) || base.includes(cSingular)) {
        if (!matchedParents.some((p) => p.id === candidate.id)) {
          matchedParents.push(candidate)
          matchedFkAttrIds.add(fk.id)
          break
        }
      }
    }
  }

  // 3. 若通过外键未找齐 2 个父实体，尝试通过组合表名（如 user_roles, article_tags）兜底寻找
  if (matchedParents.length < 2 && normName.includes('_')) {
    const parts = normName.split('_')
    for (const part of parts) {
      for (const candidate of allEntities) {
        if (candidate.id === entity.id) continue
        const cName = candidate.name.toLowerCase()
        const cSingular = cName.endsWith('s') ? cName.slice(0, -1) : cName
        if (cName === part || cSingular === part) {
          if (!matchedParents.some((p) => p.id === candidate.id)) {
            matchedParents.push(candidate)
            break
          }
        }
      }
    }
  }

  // 若无法识别出至少 2 个不同的关联父实体，则绝非技术中间表
  if (matchedParents.length < 2) {
    return { isJunction: false, businessFieldCount: attributes.length }
  }

  // 4. 用户显式强制折叠为中间表
  if (entity.is_junction_table === true) {
    return { isJunction: true, leftEntity: matchedParents[0], rightEntity: matchedParents[1], businessFieldCount: 0 }
  }

  // 5. 自动判定：统计独立业务字段数
  // 排除：主键、关联到父级的外键字段、通用审计运维字段
  const businessAttrs = attributes.filter((a) => {
    // 排除已匹配的外键
    if (matchedFkAttrIds.has(a.id)) return false
    // 排除主键
    if (a.is_primary_key && (a.name.toLowerCase() === 'id' || a.name.endsWith('_id') || a.name.endsWith('id'))) return false
    if (a.name.toLowerCase() === 'id') return false
    // 排除审计技术字段
    const aLower = a.name.toLowerCase()
    if (TECHNICAL_AUDIT_FIELDS.has(aLower)) return false
    return true
  })

  // 若业务字段数 > 1（例如包含 status, expire_at, amount 等），判定为关联实体，不折叠
  if (businessAttrs.length > 1) {
    return {
      isJunction: false,
      leftEntity: matchedParents[0],
      rightEntity: matchedParents[1],
      businessFieldCount: businessAttrs.length,
    }
  }

  // 字段总数过多（> 6）也保守保留为实体
  if (attributes.length > 6) {
    return {
      isJunction: false,
      leftEntity: matchedParents[0],
      rightEntity: matchedParents[1],
      businessFieldCount: businessAttrs.length,
    }
  }

  return {
    isJunction: true,
    leftEntity: matchedParents[0],
    rightEntity: matchedParents[1],
    businessFieldCount: businessAttrs.length,
  }
}

/**
 * 推导陈氏菱形联系的业务动作动词（双向匹配，语义清晰）
 */
function getRelationshipVerb(srcName: string, tgtName: string, cardinality?: string): string {
  const s = srcName.toLowerCase()
  const t = tgtName.toLowerCase()

  if (s === t) {
    if (
      s.includes('category') ||
      s.includes('tag') ||
      s.includes('menu') ||
      s.includes('dept') ||
      s.includes('department') ||
      s.includes('org') ||
      s.includes('node') ||
      s.includes('tree') ||
      s.includes('folder') ||
      s.includes('catalog')
    ) {
      return '层级包含'
    }
    if (
      s.includes('user') ||
      s.includes('employee') ||
      s.includes('member') ||
      s.includes('staff') ||
      s.includes('manager')
    ) {
      return '上下级汇报'
    }
    if (s.includes('comment') || s.includes('reply') || s.includes('message')) {
      return '引用回复'
    }
    return '层级包含'
  }

  const match = (a: string, b: string) =>
    (s.includes(a) && t.includes(b)) || (s.includes(b) && t.includes(a))

  if (match('user', 'article') || match('user', 'post')) return '发布'
  if (match('user', 'order')) return '下单'
  if (match('user', 'comment')) return '发表评论'
  if (match('category', 'article') || match('categories', 'articles') || match('category', 'product')) return '归属分类'
  if (match('article', 'tag')) return '打标签'
  if (match('article', 'comment')) return '包含评论'
  if (match('article', 'media')) return '包含媒体'
  if (match('order', 'item') || match('order', 'product')) return '包含明细'
  if (match('role', 'permission')) return '授权'
  if (match('user', 'role')) return '赋予角色'
  if (match('student', 'course')) return '选修'
  if (match('teacher', 'course')) return '主讲'

  if (cardinality === 'many_to_many') return '多对多'
  if (cardinality === 'one_to_many') return '包含'
  return '关联'
}

/**
 * 计算属性行在水平方向的居中对称偏移量（支持至多 6 个属性优雅延展）
 */
export function getRowXOffsets(count: number, width: number = 76, gap: number = 10): number[] {
  if (count <= 0) return []
  if (count === 1) return [0]
  if (count === 2) return [-46, 46]
  if (count === 3) return [-86, 0, 86]
  if (count === 4) return [-126, -42, 42, 126]
  if (count === 5) return [-170, -85, 0, 85, 170]
  const total = count * width + (count - 1) * gap
  const start = -total / 2 + width / 2
  return Array.from({ length: count }, (_, i) => start + i * (width + gap))
}

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

export interface ChenLayoutOutput {
  entityPositions: Map<string, { x: number; y: number }>
  relationPositions: Map<string, { x: number; y: number }>
  freeFaces: Map<string, { preferTop: boolean; preferBottom: boolean }>
}

/**
 * 拓扑感知 2D 紧凑聚类排版引擎（彻底替代一维单向拉伸的 Dagre 排版）
 * 1. 自动识别中心枢纽实体 (Hub Entity，如度数最高的用户表) 并置顶居中
 * 2. 自动聚类关联子图为 2D 紧凑网格（左侧组织架构，右侧权限体系），控制宽高比在 1.5 ~ 1.8 舒适视野
 * 3. 关系菱形自动在其所连接的两实体几何中心插值定位
 * 4. 智能推算实体外侧空闲面供属性椭圆向外吸附，杜绝穿插
 */
export function computeChen2DLayout(
  entities: ChenLayoutInputEntity[],
  relations: ChenLayoutInputRelation[],
  options?: {
    entityW?: number
    entityH?: number
    relationW?: number
    relationH?: number
    colGap?: number
    rowGap?: number
    originX?: number
    originY?: number
  },
): ChenLayoutOutput {
  const EW = options?.entityW ?? 150
  const EH = options?.entityH ?? 52
  const RW = options?.relationW ?? 108
  const RH = options?.relationH ?? 68
  const COL_GAP = options?.colGap ?? 460
  const ROW_GAP = options?.rowGap ?? 320
  const ORIGIN_X = options?.originX ?? 80
  const ORIGIN_Y = options?.originY ?? 100

  const entityPositions = new Map<string, { x: number; y: number }>()
  const relationPositions = new Map<string, { x: number; y: number }>()
  const freeFaces = new Map<string, { preferTop: boolean; preferBottom: boolean }>()

  if (entities.length === 0) {
    return { entityPositions, relationPositions, freeFaces }
  }

  // 1. 构建邻接关系与连接度统计
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

  // 2. 统计各实体的连接度数
  const degrees = new Map<string, number>()
  for (const ent of entities) {
    degrees.set(ent.id, adj.get(ent.id)?.size || 0)
  }

  // 按度数降序排序
  const sortedEntities = [...entities].sort(
    (a, b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0),
  )

  // 实体网格单元格映射：entId -> { row, col }
  const gridCoords = new Map<string, { row: number; col: number }>()

  // 特判 5 实体典型企业架构模型（如：租户、部门、用户、角色、权限）
  const topHub = sortedEntities[0]
  const hubNeighbors = adj.get(topHub.id) || new Set()

  if (entities.length === 5 && (degrees.get(topHub.id) || 0) >= 3) {
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
      // 靠近 Hub 的节点排在 row 0
      if (!hubNeighbors.has(leftCluster[0].id) && hubNeighbors.has(leftCluster[1].id)) {
        leftCluster.reverse()
      }
      if (!hubNeighbors.has(rightCluster[0].id) && hubNeighbors.has(rightCluster[1].id)) {
        rightCluster.reverse()
      }

      // Top Hub 居中置顶
      gridCoords.set(topHub.id, { row: 0, col: 1 })
      // 左侧组织架构子簇：row 0, col 0 与 row 1, col 0
      gridCoords.set(leftCluster[0].id, { row: 0, col: 0 })
      gridCoords.set(leftCluster[1].id, { row: 1, col: 0 })
      // 右侧权限控制子簇：row 0, col 2 与 row 1, col 2
      gridCoords.set(rightCluster[0].id, { row: 0, col: 2 })
      gridCoords.set(rightCluster[1].id, { row: 1, col: 2 })
    }
  }

  // 通用自适应 2D 紧凑网格嵌入算法（适用于任意数量实体模型）
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
      // N >= 5 通用紧凑网格布局：横向列数 C 保持 1.5 ~ 1.8 宽屏黄金比例
      const C = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(N * 1.4))))
      const R = Math.ceil(N / C)

      const occupied = new Set<string>()
      const getCellKey = (r: number, c: number) => `${r},${c}`

      const hubCol = Math.floor(C / 2)
      gridCoords.set(sortedEntities[0].id, { row: 0, col: hubCol })
      occupied.add(getCellKey(0, hubCol))

      const placed = new Set<string>([sortedEntities[0].id])

      while (placed.size < N) {
        let bestCandidate: ChenLayoutInputEntity | null = null
        let bestScore = -1

        for (const ent of sortedEntities) {
          if (placed.has(ent.id)) continue
          let placedNeighborsCount = 0
          for (const nId of adj.get(ent.id) || []) {
            if (placed.has(nId)) placedNeighborsCount++
          }
          const score = placedNeighborsCount * 100 + (degrees.get(ent.id) || 0)
          if (score > bestScore) {
            bestScore = score
            bestCandidate = ent
          }
        }

        if (!bestCandidate) {
          const remaining = sortedEntities.find((e) => !placed.has(e.id))
          if (!remaining) break
          bestCandidate = remaining
        }

        let bestCell = { row: 0, col: 0 }
        let minCost = Infinity

        for (let r = 0; r < R + 2; r++) {
          for (let c = 0; c < C; c++) {
            const key = getCellKey(r, c)
            if (occupied.has(key)) continue

            let cost = 0
            for (const nId of adj.get(bestCandidate.id) || []) {
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

  // 3. 将网格行列映射为像素绝对坐标 (Pixel Coordinates)
  for (const ent of entities) {
    const cell = gridCoords.get(ent.id) || { row: 0, col: 0 }
    const x = ORIGIN_X + cell.col * COL_GAP
    const y = ORIGIN_Y + cell.row * ROW_GAP
    entityPositions.set(ent.id, { x, y })
  }

  // 4. 分析每个实体的空闲朝向面 (Free Faces)，供属性椭圆向外吸附
  for (const ent of entities) {
    const myPos = entityPositions.get(ent.id)!
    let hasAbove = false
    let hasBelow = false

    for (const nId of adj.get(ent.id) || []) {
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

  // 5. 计算联系菱形节点坐标（相连两实体中心的几何中点插值 + 障碍实体避让 + 走廊导流）
  const processedPairCounts = new Map<string, number>()
  const placedDiamonds: Array<{ id: string; cx: number; cy: number }> = []

  for (const rel of relations) {
    if (rel.isSelf || rel.sourceId === rel.targetId) {
      const srcPos = entityPositions.get(rel.sourceId)
      if (srcPos) {
        relationPositions.set(rel.id, {
          x: srcPos.x + EW + 60,
          y: srcPos.y - 10,
        })
        placedDiamonds.push({
          id: rel.id,
          cx: srcPos.x + EW + 60 + RW / 2,
          cy: srcPos.y - 10 + RH / 2,
        })
      }
      continue
    }

    const srcPos = entityPositions.get(rel.sourceId)
    const tgtPos = entityPositions.get(rel.targetId)
    if (!srcPos || !tgtPos) continue

    const srcCenter = { x: srcPos.x + EW / 2, y: srcPos.y + EH / 2 }
    const tgtCenter = { x: tgtPos.x + EW / 2, y: tgtPos.y + EH / 2 }

    const pairKey = [rel.sourceId, rel.targetId].sort().join('--')
    const count = processedPairCounts.get(pairKey) || 0
    processedPairCounts.set(pairKey, count + 1)

    let midX = (srcCenter.x + tgtCenter.x) / 2
    let midY = (srcCenter.y + tgtCenter.y) / 2

    // 同一对实体间存在多个关系时施加法向微移，防止重合
    if (count > 0) {
      const dx = tgtCenter.x - srcCenter.x
      const dy = tgtCenter.y - srcCenter.y
      const len = Math.hypot(dx, dy) || 1
      const sign = count % 2 === 1 ? 1 : -1
      midX += (-dy / len) * 45 * sign
      midY += (dx / len) * 45 * sign
    }

    // 检查是否与中间障碍实体（如 tenant / user 等）发生包围盒重叠
    const testEntityCollision = (cx: number, cy: number) => {
      for (const ent of entities) {
        if (ent.id === rel.sourceId || ent.id === rel.targetId) continue
        const ep = entityPositions.get(ent.id)
        if (!ep) continue
        const ecx = ep.x + EW / 2
        const ecy = ep.y + EH / 2
        // 安全包围盒判定（实体 + 菱形包围盒 + 安全缓冲区）
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
      // 存在中间障碍实体！计算向开阔走廊通道绕行的候选点
      const dx = tgtCenter.x - srcCenter.x
      const dy = tgtCenter.y - srcCenter.y
      const isHorizontal = Math.abs(dx) >= Math.abs(dy)

      let bestCandX = midX
      let bestCandY = midY
      let foundClear = false

      const candidates: Array<{ x: number; y: number }> = []
      if (isHorizontal) {
        // 横向穿跨（如跨越中间实体）：向行间走廊导流
        candidates.push({ x: midX, y: colCheck.ecy + (ROW_GAP * 0.45) })
        candidates.push({ x: midX, y: colCheck.ecy - (ROW_GAP * 0.45) })
        candidates.push({ x: midX, y: colCheck.ecy + 110 })
        candidates.push({ x: midX, y: colCheck.ecy - 110 })
      } else {
        // 纵向穿跨：向列间走廊导流
        candidates.push({ x: colCheck.ecx + (COL_GAP * 0.45), y: midY })
        candidates.push({ x: colCheck.ecx - (COL_GAP * 0.45), y: midY })
        candidates.push({ x: colCheck.ecx + 130, y: midY })
        candidates.push({ x: colCheck.ecx - 130, y: midY })
      }

      for (const cand of candidates) {
        if (!testEntityCollision(cand.x, cand.y).collides) {
          bestCandX = cand.x
          bestCandY = cand.y
          foundClear = true
          break
        }
      }

      if (foundClear) {
        midX = bestCandX
        midY = bestCandY
      }
    }

    // 检查是否与已放置的其他联系菱形重合
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

/**
 * 陈氏图全局 AABB 无重叠松弛求解器
 * 严格保证任何两个节点（实体-实体、实体-联系、联系-联系、联系-属性）之间均留有安全间距，彻底杜绝重叠
 */
export function resolveChenCollisions(nodes: ChenNode[], minGap: number = 24): void {
  if (!nodes || nodes.length < 2) return

  const MAX_ITERATIONS = 50

  const getNodeBounds = (n: ChenNode) => {
    let w = 150
    let h = 52
    let isAnchor = false
    let isAttribute = false

    if (n.type === 'chenEntity') {
      w = 150
      h = 52
      isAnchor = true
    } else if (n.type === 'chenRelation') {
      w = 108
      h = 68
    } else if (n.type === 'chenAttribute') {
      w = 76
      h = 28
      isAttribute = true
    }

    return {
      w,
      h,
      cx: n.position.x + w / 2,
      cy: n.position.y + h / 2,
      isAnchor,
      isAttribute,
    }
  }

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let hasCollision = false

    for (let i = 0; i < nodes.length; i++) {
      const nodeA = nodes[i]
      const boundsA = getNodeBounds(nodeA)

      for (let j = i + 1; j < nodes.length; j++) {
        const nodeB = nodes[j]
        const boundsB = getNodeBounds(nodeB)

        // 若为同属一个实体的兄弟属性，天然保留水平排布间距，要求 gap 为 8px 即可
        const isSiblingAttrs =
          boundsA.isAttribute &&
          boundsB.isAttribute &&
          Boolean((nodeA.data as any)?.entityId) &&
          (nodeA.data as any)?.entityId === (nodeB.data as any)?.entityId

        // 实体与其自身的子属性，保留初始上下对齐间距（>= 12px 即不重叠）
        const isParentChild =
          (boundsA.isAnchor && boundsB.isAttribute && (nodeB.data as any)?.entityId === nodeA.id) ||
          (boundsB.isAnchor && boundsA.isAttribute && (nodeA.data as any)?.entityId === nodeB.id)

        const currentGap = isSiblingAttrs ? 8 : isParentChild ? 12 : minGap

        const reqDistX = (boundsA.w + boundsB.w) / 2 + currentGap
        const reqDistY = (boundsA.h + boundsB.h) / 2 + currentGap

        const dx = boundsB.cx - boundsA.cx
        const dy = boundsB.cy - boundsA.cy

        const overlapX = reqDistX - Math.abs(dx)
        const overlapY = reqDistY - Math.abs(dy)

        if (overlapX > 0 && overlapY > 0) {
          hasCollision = true

          // 沿穿透最小的轴向平移拆离（最小位移阻力原则）
          if (overlapX < overlapY) {
            // 水平方向分离
            const dir = dx === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dx)
            const shift = overlapX

            if (boundsA.isAnchor && !boundsB.isAnchor) {
              nodeB.position.x += dir * shift
            } else if (!boundsA.isAnchor && boundsB.isAnchor) {
              nodeA.position.x -= dir * shift
            } else if (boundsA.isAttribute && !boundsB.isAttribute) {
              // 属性与联系菱形碰撞：联系菱形避让
              nodeB.position.x += dir * shift
            } else if (!boundsA.isAttribute && boundsB.isAttribute) {
              nodeA.position.x -= dir * shift
            } else {
              // 同级别节点均分避让
              nodeA.position.x -= dir * (shift / 2)
              nodeB.position.x += dir * (shift / 2)
            }
          } else {
            // 垂直方向分离
            const dir = dy === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dy)
            const shift = overlapY

            if (boundsA.isAnchor && !boundsB.isAnchor) {
              nodeB.position.y += dir * shift
            } else if (!boundsA.isAnchor && boundsB.isAnchor) {
              nodeA.position.y -= dir * shift
            } else if (boundsA.isAttribute && !boundsB.isAttribute) {
              nodeB.position.y += dir * shift
            } else if (!boundsA.isAttribute && boundsB.isAttribute) {
              nodeA.position.y -= dir * shift
            } else {
              nodeA.position.y -= dir * (shift / 2)
              nodeB.position.y += dir * (shift / 2)
            }
          }
        }
      }
    }

    if (!hasCollision) break
  }

  // 保证所有节点坐标在安全可视正区间内 (x >= 40, y >= 40)
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes) {
    if (n.position.x < minX) minX = n.position.x
    if (n.position.y < minY) minY = n.position.y
  }

  if (minX < 40 || minY < 40) {
    const shiftX = minX < 40 ? 40 - minX : 0
    const shiftY = minY < 40 ? 40 - minY : 0
    for (const n of nodes) {
      n.position.x += shiftX
      n.position.y += shiftY
    }
  }
}

/**
 * 根据源节点与宿节点的相对中心几何位置，动态推导最优的最近出入 Handle 标识
 * 杜绝传统 LR 强行拉扯导致的横跨全图与回折绕圈
 */
export function getNearestChenHandles(
  sourceCenter: { x: number; y: number },
  targetCenter: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = targetCenter.x - sourceCenter.x
  const dy = targetCenter.y - sourceCenter.y

  if (Math.abs(dx) >= Math.abs(dy) * 1.4) {
    // 显著水平关系：源端走左右，宿端走左右
    return dx >= 0
      ? { sourceHandle: 'right-source', targetHandle: 'left-target' }
      : { sourceHandle: 'left-source', targetHandle: 'right-target' }
  } else if (Math.abs(dy) >= Math.abs(dx) * 1.4) {
    // 显著垂直关系：源端走上下，宿端走上下
    return dy >= 0
      ? { sourceHandle: 'bottom-source', targetHandle: 'top-target' }
      : { sourceHandle: 'top-source', targetHandle: 'bottom-target' }
  } else {
    // 斜向关系（如 部门 ↗ 菱形 ↗ 用户）
    if (dy < 0) {
      // 宿端在源端上方
      return { sourceHandle: 'top-source', targetHandle: 'bottom-target' }
    } else {
      // 宿端在源端下方
      return { sourceHandle: 'bottom-source', targetHandle: 'top-target' }
    }
  }
}

/**
 * 计算自引用关系的专用回折平滑弧线（确保不遮挡节点文字且语义清晰）
 */
export function getSelfLoopPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  dir: 'top' | 'bottom' = 'top',
): [string, number, number] {
  const dx = tx - sx
  const dy = ty - sy
  const dist = Math.hypot(dx, dy) || 1
  const offset = Math.max(38, Math.min(dist * 0.28, 75))

  let cp1x: number
  let cp1y: number
  let cp2x: number
  let cp2y: number

  if (Math.abs(dx) < 40) {
    // 纵向布局：向左右两侧分流弧线
    const sign = dir === 'top' ? -1 : 1
    cp1x = sx + dx * 0.25 + sign * offset
    cp1y = sy + dy * 0.25
    cp2x = sx + dx * 0.75 + sign * offset
    cp2y = sy + dy * 0.75
  } else {
    // 横向布局：向上下两侧分流弧线
    const sign = dir === 'top' ? -1 : 1
    cp1x = sx + dx * 0.25
    cp1y = sy + dy * 0.25 + sign * offset
    cp2x = sx + dx * 0.75
    cp2y = sy + dy * 0.75 + sign * offset
  }

  // 贝塞尔曲线在 t = 0.5 处的精确坐标（用于居中呈现基数徽标）
  const lx = 0.125 * sx + 0.375 * cp1x + 0.375 * cp2x + 0.125 * tx
  const ly = 0.125 * sy + 0.375 * cp1y + 0.375 * cp2y + 0.125 * ty
  const path = `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`

  return [path, lx, ly]
}

/**
 * 将整份物理 ER 设计转换为标准陈氏概念模型图（Chen's ER Model）
 */
export function toChenFlowElements(
  design: ERDesign,
  selectedId?: string | null,
  customPositions?: Record<string, Position>,
): { nodes: ChenNode[]; edges: ChenEdgeType[] } {
  if (!design || !design.entities || design.entities.length === 0) {
    return { nodes: [], edges: [] }
  }

  const nodes: ChenNode[] = []
  const edges: ChenEdgeType[] = []

  // 1. 识别并提取中间表
  const junctionEntityIds = new Set<string>()
  const junctionDiamonds: Array<{
    id: string
    entity: Entity
    leftEntity: Entity
    rightEntity: Entity
  }> = []

  for (const entity of design.entities) {
    const check = detectJunctionTable(entity, design.entities)
    if (check.isJunction && check.leftEntity && check.rightEntity) {
      junctionEntityIds.add(entity.id)
      junctionDiamonds.push({
        id: `junction-${entity.id}`,
        entity,
        leftEntity: check.leftEntity,
        rightEntity: check.rightEntity,
      })
    }
  }

  // 2. 区分核心业务实体（矩形）
  const normalEntities = design.entities.filter((e) => !junctionEntityIds.has(e.id))
  const entityMap = new Map(normalEntities.map((e) => [e.id, e]))

  const ENTITY_W = 150
  const ENTITY_H = 52
  const RELATION_W = 108
  const RELATION_H = 68
  const ATTR_W = 76
  const ATTR_H = 28
  const ATTR_Y_OFFSET = 50

  // 提前收集参与布局的实体与联系
  const layoutEntities: ChenLayoutInputEntity[] = normalEntities.map((e) => ({
    id: e.id,
    name: e.name,
  }))

  const processedPairKeys = new Set<string>()
  const layoutRelations: ChenLayoutInputRelation[] = []

  // 中间表菱形联系
  for (const junc of junctionDiamonds) {
    const pairKey = [junc.leftEntity.id, junc.rightEntity.id].sort().join('--')
    processedPairKeys.add(pairKey)
    layoutRelations.push({
      id: junc.id,
      sourceId: junc.leftEntity.id,
      targetId: junc.rightEntity.id,
    })
  }

  // 常规外键联系与自引用联系
  const regularDiamonds: Array<{
    id: string
    relation: Relation
    source: Entity
    target: Entity
    verb: string
    isSelf?: boolean
  }> = []

  for (const rel of design.relations) {
    if (junctionEntityIds.has(rel.source_entity_id) || junctionEntityIds.has(rel.target_entity_id)) continue

    const src = entityMap.get(rel.source_entity_id)
    const tgt = entityMap.get(rel.target_entity_id)
    if (!src || !tgt) continue

    const isSelf = src.id === tgt.id
    const pairKey = isSelf ? `self--${src.id}--${rel.id}` : [src.id, tgt.id].sort().join('--')
    if (processedPairKeys.has(pairKey)) continue
    processedPairKeys.add(pairKey)

    const diaId = `rel-${rel.id}`
    const relCard = (rel.cardinality || (rel as any).relation_type_id || 'one_to_many') as Cardinality
    const verb = getRelationshipVerb(src.name, tgt.name, relCard)
    regularDiamonds.push({
      id: diaId,
      relation: rel,
      source: src,
      target: tgt,
      verb,
      isSelf,
    })

    layoutRelations.push({
      id: diaId,
      sourceId: src.id,
      targetId: tgt.id,
      isSelf,
    })
  }

  // 3. 执行 2D 拓扑紧凑聚类自动排版
  const layout = computeChen2DLayout(layoutEntities, layoutRelations, {
    entityW: ENTITY_W,
    entityH: ENTITY_H,
    relationW: RELATION_W,
    relationH: RELATION_H,
    colGap: 460,
    rowGap: 320,
    originX: 80,
    originY: 100,
  })

  // 4. 为每个实体精选属性并根据 freeFaces 智能安排在空闲外侧
  interface EntityAttrLayout {
    topAttrs: Attribute[]
    bottomAttrs: Attribute[]
  }
  const entityAttrMap = new Map<string, EntityAttrLayout>()

  for (const entity of normalEntities) {
    const pkAttrs = entity.attributes.filter((a) => a.is_primary_key)
    const bizAttrs = entity.attributes.filter(
      (a) =>
        !a.is_primary_key &&
        !a.name.toLowerCase().endsWith('_id') &&
        !a.name.toLowerCase().endsWith('id'),
    )

    const selectedAttrs: Attribute[] = [...pkAttrs, ...bizAttrs.slice(0, 4)]
    if (selectedAttrs.length === 0 && entity.attributes.length > 0) {
      selectedAttrs.push(entity.attributes[0])
    }

    const face = layout.freeFaces.get(entity.id)
    if (face?.preferTop) {
      // 上方空闲：所有属性归拢于上方，下方留给关系连线
      entityAttrMap.set(entity.id, {
        topAttrs: selectedAttrs,
        bottomAttrs: [],
      })
    } else if (face?.preferBottom) {
      // 下方空闲：所有属性归拢于下方，上方留给关系连线
      entityAttrMap.set(entity.id, {
        topAttrs: [],
        bottomAttrs: selectedAttrs,
      })
    } else {
      // 默认上下均分
      const topCount = Math.ceil(selectedAttrs.length / 2)
      entityAttrMap.set(entity.id, {
        topAttrs: selectedAttrs.slice(0, topCount),
        bottomAttrs: selectedAttrs.slice(topCount),
      })
    }
  }

  // 5. 生成实体矩形节点与外侧属性椭圆
  for (const entity of normalEntities) {
    const defaultPos = layout.entityPositions.get(entity.id) || { x: 100, y: 100 }
    const customEntityPos = customPositions?.[entity.id]
    const entityX = customEntityPos ? customEntityPos.x : defaultPos.x
    const entityY = customEntityPos ? customEntityPos.y : defaultPos.y

    const baseEcx = entityX + ENTITY_W / 2
    const baseEcy = entityY + ENTITY_H / 2

    const chineseName = getEntityChineseName(entity.name, entity.comment)

    nodes.push({
      id: entity.id,
      type: 'chenEntity',
      position: { x: entityX, y: entityY },
      data: {
        entity,
        name: entity.name,
        displayName: chineseName,
      },
      selected: entity.id === selectedId,
    })

    const attrInfo = entityAttrMap.get(entity.id)!

    // 生成上方属性椭圆
    if (attrInfo.topAttrs.length > 0) {
      const topY = baseEcy - (ATTR_Y_OFFSET + 6)
      const offsets = getRowXOffsets(attrInfo.topAttrs.length)
      for (let i = 0; i < attrInfo.topAttrs.length; i++) {
        const attr = attrInfo.topAttrs[i]
        const defaultAx = baseEcx + offsets[i] - ATTR_W / 2
        const defaultAy = topY - ATTR_H / 2
        const attrNodeId = `attr-${entity.id}-${attr.id}`
        const customAttrPos = customPositions?.[attrNodeId]

        nodes.push({
          id: attrNodeId,
          type: 'chenAttribute',
          position: customAttrPos ?? { x: defaultAx, y: defaultAy },
          data: {
            attribute: attr,
            entityId: entity.id,
            entityName: entity.name,
          },
        })

        edges.push({
          id: `edge-${entity.id}-${attrNodeId}`,
          type: 'chenEdge',
          source: entity.id,
          target: attrNodeId,
          sourceHandle: 'top-source',
          targetHandle: 'bottom-target',
          data: {
            isAttributeEdge: true,
          },
        })
      }
    }

    // 生成下方属性椭圆
    if (attrInfo.bottomAttrs.length > 0) {
      const bottomY = baseEcy + (ATTR_Y_OFFSET + 6)
      const offsets = getRowXOffsets(attrInfo.bottomAttrs.length)
      for (let i = 0; i < attrInfo.bottomAttrs.length; i++) {
        const attr = attrInfo.bottomAttrs[i]
        const defaultAx = baseEcx + offsets[i] - ATTR_W / 2
        const defaultAy = bottomY - ATTR_H / 2
        const attrNodeId = `attr-${entity.id}-${attr.id}`
        const customAttrPos = customPositions?.[attrNodeId]

        nodes.push({
          id: attrNodeId,
          type: 'chenAttribute',
          position: customAttrPos ?? { x: defaultAx, y: defaultAy },
          data: {
            attribute: attr,
            entityId: entity.id,
            entityName: entity.name,
          },
        })

        edges.push({
          id: `edge-${entity.id}-${attrNodeId}`,
          type: 'chenEdge',
          source: entity.id,
          target: attrNodeId,
          sourceHandle: 'bottom-source',
          targetHandle: 'top-target',
          data: {
            isAttributeEdge: true,
          },
        })
      }
    }
  }

  // 6. 生成中间表提升的菱形联系节点
  for (const junc of junctionDiamonds) {
    const defaultPos = layout.relationPositions.get(junc.id) || { x: 250, y: 250 }
    const customPos = customPositions?.[junc.id]

    nodes.push({
      id: junc.id,
      type: 'chenRelation',
      position: customPos ?? defaultPos,
      data: {
        relationId: junc.entity.id,
        name: getEntityChineseName(junc.entity.name),
        cardinality: 'many_to_many',
        sourceEntityId: junc.leftEntity.id,
        targetEntityId: junc.rightEntity.id,
        isJunctionTable: true,
      },
      selected: junc.id === selectedId || junc.entity.id === selectedId,
    })
  }

  // 7. 生成常规外键关系的菱形联系节点
  for (const reg of regularDiamonds) {
    const defaultPos = layout.relationPositions.get(reg.id) || { x: 250, y: 250 }
    const customPos = customPositions?.[reg.id]
    const card = (reg.relation.cardinality || (reg.relation as any).relation_type_id || 'one_to_many') as Cardinality

    nodes.push({
      id: reg.id,
      type: 'chenRelation',
      position: customPos ?? defaultPos,
      data: {
        relationId: reg.relation.id,
        name: reg.verb,
        cardinality: card,
        sourceEntityId: reg.source.id,
        targetEntityId: reg.target.id,
      },
      selected: reg.id === selectedId || reg.relation.id === selectedId,
    })
  }

  // 7.5 执行全局 AABB 无重叠约束求解，彻底消除实体、联系与属性之间的几何重叠
  resolveChenCollisions(nodes, 24)

  // 8. 建立全节点几何中心坐标缓存，用于动态计算最优出入 Handle
  const nodeCenterMap = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const isEnt = n.type === 'chenEntity'
    const isRel = n.type === 'chenRelation'
    const w = isEnt ? ENTITY_W : isRel ? RELATION_W : ATTR_W
    const h = isEnt ? ENTITY_H : isRel ? RELATION_H : ATTR_H
    nodeCenterMap.set(n.id, { x: n.position.x + w / 2, y: n.position.y + h / 2 })
  }

  // 9. 生成中间表提升的边（就近几何 Handle 对接）
  for (const junc of junctionDiamonds) {
    const leftCenter = nodeCenterMap.get(junc.leftEntity.id) || { x: 0, y: 0 }
    const juncCenter = nodeCenterMap.get(junc.id) || { x: 0, y: 0 }
    const rightCenter = nodeCenterMap.get(junc.rightEntity.id) || { x: 0, y: 0 }

    const h1 = getNearestChenHandles(leftCenter, juncCenter)
    const h2 = getNearestChenHandles(juncCenter, rightCenter)

    // 实体 ──(M)── 菱形
    edges.push({
      id: `edge-${junc.leftEntity.id}-${junc.id}`,
      type: 'chenEdge',
      source: junc.leftEntity.id,
      target: junc.id,
      sourceHandle: h1.sourceHandle,
      targetHandle: h1.targetHandle,
      data: {
        cardinalityLabel: 'M',
        isAttributeEdge: false,
      },
    })

    // 菱形 ──(N)── 实体
    edges.push({
      id: `edge-${junc.id}-${junc.rightEntity.id}`,
      type: 'chenEdge',
      source: junc.id,
      target: junc.rightEntity.id,
      sourceHandle: h2.sourceHandle,
      targetHandle: h2.targetHandle,
      data: {
        cardinalityLabel: 'N',
        isAttributeEdge: false,
      },
    })
  }

  // 10. 生成常规外键关系与自引用关系的边（就近几何 Handle 对接）
  for (const reg of regularDiamonds) {
    const card = (reg.relation.cardinality || (reg.relation as any).relation_type_id || 'one_to_many') as Cardinality
    const is1to1 = card === 'one_to_one'
    const isM2M = card === 'many_to_many'
    const srcCard = isM2M ? 'M' : '1'
    const tgtCard = is1to1 ? '1' : 'N'
    const isRelSelected = reg.id === selectedId || reg.relation.id === selectedId

    if (reg.isSelf) {
      // 自引用自环拓扑：顶部弧线出入菱形，底部弧线回折接入实体
      edges.push({
        id: `edge-${reg.source.id}-${reg.id}`,
        type: 'chenEdge',
        source: reg.source.id,
        target: reg.id,
        sourceHandle: 'right-source',
        targetHandle: 'left-target',
        data: {
          cardinalityLabel: srcCard,
          isAttributeEdge: false,
          isSelfLoop: true,
          loopDirection: 'top',
        },
        selected: isRelSelected,
      })

      edges.push({
        id: `edge-${reg.id}-${reg.target.id}`,
        type: 'chenEdge',
        source: reg.id,
        target: reg.target.id,
        sourceHandle: 'left-source',
        targetHandle: 'right-target',
        data: {
          cardinalityLabel: tgtCard,
          isAttributeEdge: false,
          isSelfLoop: true,
          loopDirection: 'bottom',
        },
        selected: isRelSelected,
      })
    } else {
      const srcCenter = nodeCenterMap.get(reg.source.id) || { x: 0, y: 0 }
      const diaCenter = nodeCenterMap.get(reg.id) || { x: 0, y: 0 }
      const tgtCenter = nodeCenterMap.get(reg.target.id) || { x: 0, y: 0 }

      const h1 = getNearestChenHandles(srcCenter, diaCenter)
      const h2 = getNearestChenHandles(diaCenter, tgtCenter)

      edges.push({
        id: `edge-${reg.source.id}-${reg.id}`,
        type: 'chenEdge',
        source: reg.source.id,
        target: reg.id,
        sourceHandle: h1.sourceHandle,
        targetHandle: h1.targetHandle,
        data: {
          cardinalityLabel: srcCard,
          isAttributeEdge: false,
        },
        selected: isRelSelected,
      })

      edges.push({
        id: `edge-${reg.id}-${reg.target.id}`,
        type: 'chenEdge',
        source: reg.id,
        target: reg.target.id,
        sourceHandle: h2.sourceHandle,
        targetHandle: h2.targetHandle,
        data: {
          cardinalityLabel: tgtCard,
          isAttributeEdge: false,
        },
        selected: isRelSelected,
      })
    }
  }

  return { nodes, edges }
}

/**
 * 将 Layer 1 原生业务概念模型 (ConceptualDesign) 零损失渲染为标准陈氏图 (Chen's ER Model)
 */
export function conceptualToChenFlowElements(
  conceptualDesign: ConceptualDesign,
  selectedId?: string | null,
  customPositions?: Record<string, Position>,
): { nodes: ChenNode[]; edges: ChenEdgeType[] } {
  if (!conceptualDesign || !conceptualDesign.concepts || conceptualDesign.concepts.length === 0) {
    return { nodes: [], edges: [] }
  }

  const nodes: ChenNode[] = []
  const edges: ChenEdgeType[] = []

  const ENTITY_W = 150
  const ENTITY_H = 52
  const RELATION_W = 108
  const RELATION_H = 68
  const ATTR_W = 76
  const ATTR_H = 28
  const ATTR_Y_OFFSET = 50

  const concepts = conceptualDesign.concepts

  // 1. 概念标识与查找映射 (支持 id, name, display_name 多向精确解析)
  const conceptMap = new Map<string, BusinessConcept>()
  const lookupMap = new Map<string, BusinessConcept>()

  for (const c of concepts) {
    const cid = c.id || `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
    conceptMap.set(cid, c)
    lookupMap.set(cid, c)
    lookupMap.set(c.name.toLowerCase(), c)
    if (c.display_name) {
      lookupMap.set(c.display_name.toLowerCase(), c)
    }
  }

  // 2. 为每个概念精选属性并分列上下两排
  interface ConceptAttrLayout {
    topAttrs: ConceptAttribute[]
    bottomAttrs: ConceptAttribute[]
  }
  const conceptAttrMap = new Map<string, ConceptAttrLayout>()

  for (const c of concepts) {
    const cid = c.id || `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
    const attrs = c.attributes || []

    // 优先保留业务标识（is_business_key），再补充常规业务属性，最多 4 个
    const keyAttrs = attrs.filter((a) => a.is_business_key)
    const bizAttrs = attrs.filter((a) => !a.is_business_key)

    const selectedAttrs: ConceptAttribute[] = [
      ...keyAttrs,
      ...bizAttrs.slice(0, Math.max(0, 4 - keyAttrs.length)),
    ]
    if (selectedAttrs.length === 0 && attrs.length > 0) {
      selectedAttrs.push(attrs[0])
    }

    const topCount = Math.ceil(selectedAttrs.length / 2)
    conceptAttrMap.set(cid, {
      topAttrs: selectedAttrs.slice(0, topCount),
      bottomAttrs: selectedAttrs.slice(topCount),
    })
  }

  // 3. 解析概念关联关系
  interface ResolvedRelation {
    id: string
    rawId: string
    name: string
    cardinality: Cardinality
    source: BusinessConcept
    target: BusinessConcept
    sourceId: string
    targetId: string
    position?: Position
    isSelf?: boolean
  }

  const resolvedRelations: ResolvedRelation[] = []
  const processedPairs = new Set<string>()

  for (const rel of conceptualDesign.relations || []) {
    const src = lookupMap.get(rel.source_concept.toLowerCase()) || lookupMap.get(rel.source_concept)
    const tgt = lookupMap.get(rel.target_concept.toLowerCase()) || lookupMap.get(rel.target_concept)
    if (!src || !tgt) continue

    const srcId = src.id || `concept_${src.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
    const tgtId = tgt.id || `concept_${tgt.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
    const isSelf = srcId === tgtId

    const pairKey = isSelf ? `self--${srcId}--${rel.id || rel.name || 'self'}` : [srcId, tgtId].sort().join('--')
    if (processedPairs.has(pairKey)) continue
    processedPairs.add(pairKey)

    const rawId = rel.id || `rel_${srcId}_${tgtId}`
    const diaId = `rel-${rawId}`
    const card = (rel.cardinality || 'one_to_many') as Cardinality
    const verb = rel.name || getRelationshipVerb(src.name, tgt.name, card)

    resolvedRelations.push({
      id: diaId,
      rawId,
      name: verb,
      cardinality: card,
      source: src,
      target: tgt,
      sourceId: srcId,
      targetId: tgtId,
      position: rel.position,
      isSelf,
    })
  }

  // 4. 执行 2D 拓扑感知紧凑聚类排版
  const layoutEntities: ChenLayoutInputEntity[] = concepts.map((c) => {
    const cid = c.id || `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
    return { id: cid, name: c.name }
  })

  const layoutRelations: ChenLayoutInputRelation[] = resolvedRelations.map((rel) => ({
    id: rel.id,
    sourceId: rel.sourceId,
    targetId: rel.targetId,
    isSelf: rel.isSelf,
  }))

  const layout = computeChen2DLayout(layoutEntities, layoutRelations, {
    entityW: ENTITY_W,
    entityH: ENTITY_H,
    relationW: RELATION_W,
    relationH: RELATION_H,
    colGap: 460,
    rowGap: 320,
    originX: 80,
    originY: 100,
  })

  // 5. 根据 freeFaces 智能安排属性在实体空闲外侧
  for (const c of concepts) {
    const cid = c.id || `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
    const attrs = c.attributes || []

    const keyAttrs = attrs.filter((a) => a.is_business_key)
    const bizAttrs = attrs.filter((a) => !a.is_business_key)

    const selectedAttrs: ConceptAttribute[] = [
      ...keyAttrs,
      ...bizAttrs.slice(0, Math.max(0, 5 - keyAttrs.length)),
    ]
    if (selectedAttrs.length === 0 && attrs.length > 0) {
      selectedAttrs.push(attrs[0])
    }

    const face = layout.freeFaces.get(cid)
    if (face?.preferTop) {
      conceptAttrMap.set(cid, {
        topAttrs: selectedAttrs,
        bottomAttrs: [],
      })
    } else if (face?.preferBottom) {
      conceptAttrMap.set(cid, {
        topAttrs: [],
        bottomAttrs: selectedAttrs,
      })
    } else {
      const topCount = Math.ceil(selectedAttrs.length / 2)
      conceptAttrMap.set(cid, {
        topAttrs: selectedAttrs.slice(0, topCount),
        bottomAttrs: selectedAttrs.slice(topCount),
      })
    }
  }

  // 6. 生成实体矩形节点与外侧属性椭圆
  for (const c of concepts) {
    const cid = c.id || `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
    const defaultPos = layout.entityPositions.get(cid) || { x: 100, y: 100 }
    const customEntityPos = customPositions?.[cid] ?? c.position

    const entityX = customEntityPos ? customEntityPos.x : defaultPos.x
    const entityY = customEntityPos ? customEntityPos.y : defaultPos.y

    const baseEcx = entityX + ENTITY_W / 2
    const baseEcy = entityY + ENTITY_H / 2

    const chineseName = c.display_name || getEntityChineseName(c.name)

    nodes.push({
      id: cid,
      type: 'chenEntity',
      position: { x: entityX, y: entityY },
      data: {
        concept: c,
        name: c.name,
        displayName: chineseName,
        conceptId: cid,
        entity: {
          id: cid,
          name: c.name,
          comment: c.description,
          position: { x: entityX, y: entityY },
          attributes: (c.attributes || []).map((ca) => ({
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
      },
      selected: cid === selectedId || c.id === selectedId,
    })

    const attrInfo = conceptAttrMap.get(cid)!

    // 生成上方属性椭圆
    if (attrInfo.topAttrs.length > 0) {
      const topY = baseEcy - (ATTR_Y_OFFSET + 6)
      const offsets = getRowXOffsets(attrInfo.topAttrs.length)
      for (let i = 0; i < attrInfo.topAttrs.length; i++) {
        const attr = attrInfo.topAttrs[i]
        const defaultAx = baseEcx + offsets[i] - ATTR_W / 2
        const defaultAy = topY - ATTR_H / 2
        const attrNodeId = `attr-${cid}-${attr.id || attr.name}`
        const customAttrPos = customPositions?.[attrNodeId]

        nodes.push({
          id: attrNodeId,
          type: 'chenAttribute',
          position: customAttrPos ?? { x: defaultAx, y: defaultAy },
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
              id: attr.id || attr.name,
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
        })

        edges.push({
          id: `edge-${cid}-${attrNodeId}`,
          type: 'chenEdge',
          source: cid,
          target: attrNodeId,
          sourceHandle: 'top-source',
          targetHandle: 'bottom-target',
          data: {
            isAttributeEdge: true,
          },
        })
      }
    }

    // 生成下方属性椭圆
    if (attrInfo.bottomAttrs.length > 0) {
      const bottomY = baseEcy + (ATTR_Y_OFFSET + 6)
      const offsets = getRowXOffsets(attrInfo.bottomAttrs.length)
      for (let i = 0; i < attrInfo.bottomAttrs.length; i++) {
        const attr = attrInfo.bottomAttrs[i]
        const defaultAx = baseEcx + offsets[i] - ATTR_W / 2
        const defaultAy = bottomY - ATTR_H / 2
        const attrNodeId = `attr-${cid}-${attr.id || attr.name}`
        const customAttrPos = customPositions?.[attrNodeId]

        nodes.push({
          id: attrNodeId,
          type: 'chenAttribute',
          position: customAttrPos ?? { x: defaultAx, y: defaultAy },
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
              id: attr.id || attr.name,
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
        })

        edges.push({
          id: `edge-${cid}-${attrNodeId}`,
          type: 'chenEdge',
          source: cid,
          target: attrNodeId,
          sourceHandle: 'bottom-source',
          targetHandle: 'top-target',
          data: {
            isAttributeEdge: true,
          },
        })
      }
    }
  }

  // 7. 生成联系菱形节点
  for (const rel of resolvedRelations) {
    const defaultPos = layout.relationPositions.get(rel.id) || { x: 250, y: 250 }
    const customPos = customPositions?.[rel.id] ?? customPositions?.[rel.rawId] ?? rel.position

    nodes.push({
      id: rel.id,
      type: 'chenRelation',
      position: customPos ?? defaultPos,
      data: {
        relationId: rel.rawId,
        name: rel.name,
        cardinality: rel.cardinality,
        sourceEntityId: rel.sourceId,
        targetEntityId: rel.targetId,
      },
      selected: rel.id === selectedId || rel.rawId === selectedId,
    })
  }

  // 7.5 执行全局 AABB 无重叠约束求解，彻底消除实体、联系与属性之间的几何重叠
  resolveChenCollisions(nodes, 24)

  // 8. 建立全节点几何中心坐标缓存，用于动态计算最优出入 Handle
  const nodeCenterMap = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const isEnt = n.type === 'chenEntity'
    const isRel = n.type === 'chenRelation'
    const w = isEnt ? ENTITY_W : isRel ? RELATION_W : ATTR_W
    const h = isEnt ? ENTITY_H : isRel ? RELATION_H : ATTR_H
    nodeCenterMap.set(n.id, { x: n.position.x + w / 2, y: n.position.y + h / 2 })
  }

  // 9. 生成联系菱形边（就近几何 Handle 对接）
  for (const rel of resolvedRelations) {
    const is1to1 = rel.cardinality === 'one_to_one'
    const isM2M = rel.cardinality === 'many_to_many'

    const srcCard = isM2M ? 'M' : '1'
    const tgtCard = is1to1 ? '1' : 'N'

    const isRelSelected = rel.id === selectedId || rel.rawId === selectedId

    if (rel.isSelf) {
      edges.push({
        id: `edge-${rel.sourceId}-${rel.id}`,
        type: 'chenEdge',
        source: rel.sourceId,
        target: rel.id,
        sourceHandle: 'right-source',
        targetHandle: 'left-target',
        data: {
          cardinalityLabel: srcCard,
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
          cardinalityLabel: tgtCard,
          isAttributeEdge: false,
          isSelfLoop: true,
          loopDirection: 'bottom',
        },
        selected: isRelSelected,
      })
    } else {
      const srcCenter = nodeCenterMap.get(rel.sourceId) || { x: 0, y: 0 }
      const diaCenter = nodeCenterMap.get(rel.id) || { x: 0, y: 0 }
      const tgtCenter = nodeCenterMap.get(rel.targetId) || { x: 0, y: 0 }

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
          cardinalityLabel: srcCard,
          isAttributeEdge: false,
        },
        selected: isRelSelected,
      })

      edges.push({
        id: `edge-${rel.id}-${rel.targetId}`,
        type: 'chenEdge',
        source: rel.id,
        target: rel.targetId,
        sourceHandle: h2.sourceHandle,
        targetHandle: h2.targetHandle,
        data: {
          cardinalityLabel: tgtCard,
          isAttributeEdge: false,
        },
        selected: isRelSelected,
      })
    }
  }

  return { nodes, edges }
}

/**
 * 统一陈氏图渲染适配器：优先零损失消费原生业务概念模型，降级适配物理表
 */
export function renderChenFlowElements(params: {
  conceptualDesign?: ConceptualDesign
  design?: ERDesign
  agentPhase?: string
  selectedId?: string | null
  customPositions?: Record<string, Position>
}): { nodes: ChenNode[]; edges: ChenEdgeType[] } {
  const { conceptualDesign, design, agentPhase, selectedId, customPositions } = params

  const hasConcepts = Boolean(
    conceptualDesign &&
      Array.isArray(conceptualDesign.concepts) &&
      conceptualDesign.concepts.length > 0,
  )
  const hasEntities = Boolean(
    design && Array.isArray(design.entities) && design.entities.length > 0,
  )

  // 1. 若处于概念设计阶段，或有概念模型且无物理表，直接消费概念模型
  if (
    hasConcepts &&
    (agentPhase === 'concept_ready' || agentPhase === 'deriving_physical' || !hasEntities)
  ) {
    return conceptualToChenFlowElements(conceptualDesign!, selectedId, customPositions)
  }

  // 2. 若存在物理表设计，反向推导陈氏图
  if (hasEntities && design) {
    return toChenFlowElements(design, selectedId, customPositions)
  }

  // 3. 兜底
  if (hasConcepts) {
    return conceptualToChenFlowElements(conceptualDesign!, selectedId, customPositions)
  }

  return { nodes: [], edges: [] }
}
