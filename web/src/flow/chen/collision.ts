import type { Node } from '@xyflow/react'
import type { ChenAttributeNodeData } from '../../components/chen/ChenAttributeNode'
import type { ChenEntityNodeData } from '../../components/chen/ChenEntityNode'
import type { ChenRelationNodeData } from '../../components/chen/ChenRelationNode'
import { CHEN_NODE_DIMENSIONS, getChenNodeSize } from './dimensions'
import type { ChenEntityFreeFace } from './layout2d'

export type ChenNode = Node<ChenEntityNodeData | ChenRelationNodeData | ChenAttributeNodeData>

/**
 * 计算属性行在水平方向的居中对称偏移量（支持至多 6+ 个属性优雅扇形延展）
 */
export function getRowXOffsets(
  count: number,
  width: number = CHEN_NODE_DIMENSIONS.attribute.width,
  gap: number = CHEN_NODE_DIMENSIONS.layout.attrRowGap,
): number[] {
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

/**
 * 根据实体外侧空闲面（Free Faces）将候选属性分配至上方扇区或下方扇区。
 */
export function partitionAttributeFan<T>(
  selectedAttrs: readonly T[],
  face?: ChenEntityFreeFace,
): { topAttrs: T[]; bottomAttrs: T[] } {
  if (face?.preferTop) {
    return { topAttrs: [...selectedAttrs], bottomAttrs: [] }
  }
  if (face?.preferBottom) {
    return { topAttrs: [], bottomAttrs: [...selectedAttrs] }
  }
  const topCount = Math.ceil(selectedAttrs.length / 2)
  return {
    topAttrs: selectedAttrs.slice(0, topCount),
    bottomAttrs: selectedAttrs.slice(topCount),
  }
}

/**
 * 陈氏图全局 AABB 无重叠松弛求解器。
 * 保证任意两个图元（实体、菱形联系、属性椭圆）之间留有安全间距，并将异常极值负坐标收敛至安全可视正区间。
 */
export function resolveChenCollisions(
  nodes: ChenNode[],
  minGap: number = CHEN_NODE_DIMENSIONS.layout.collisionMinGap,
): void {
  if (!nodes || nodes.length === 0) return

  const minCoord = CHEN_NODE_DIMENSIONS.layout.minCanvasCoord
  for (const n of nodes) {
    if (n.position.x < minCoord) n.position.x = minCoord
    if (n.position.y < minCoord) n.position.y = minCoord
  }

  if (nodes.length < 2) return

  const MAX_ITERATIONS = 50

  const getNodeBounds = (n: ChenNode) => {
    const size = getChenNodeSize(n.type)
    return {
      w: size.width,
      h: size.height,
      cx: n.position.x + size.width / 2,
      cy: n.position.y + size.height / 2,
      isAnchor: n.type === 'chenEntity',
      isAttribute: n.type === 'chenAttribute',
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

        const attrEntityIdA = boundsA.isAttribute
          ? (nodeA.data as ChenAttributeNodeData).entityId
          : undefined
        const attrEntityIdB = boundsB.isAttribute
          ? (nodeB.data as ChenAttributeNodeData).entityId
          : undefined

        const isSiblingAttrs =
          boundsA.isAttribute &&
          boundsB.isAttribute &&
          Boolean(attrEntityIdA) &&
          attrEntityIdA === attrEntityIdB

        const isParentChild =
          (boundsA.isAnchor && boundsB.isAttribute && attrEntityIdB === nodeA.id) ||
          (boundsB.isAnchor && boundsA.isAttribute && attrEntityIdA === nodeB.id)

        const currentGap = isSiblingAttrs ? 8 : isParentChild ? 12 : minGap

        const reqDistX = (boundsA.w + boundsB.w) / 2 + currentGap
        const reqDistY = (boundsA.h + boundsB.h) / 2 + currentGap

        const dx = boundsB.cx - boundsA.cx
        const dy = boundsB.cy - boundsA.cy

        const overlapX = reqDistX - Math.abs(dx)
        const overlapY = reqDistY - Math.abs(dy)

        if (overlapX > 0 && overlapY > 0) {
          hasCollision = true

          if (overlapX < overlapY) {
            const dir = dx === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dx)
            const shift = overlapX

            if (boundsA.isAnchor && !boundsB.isAnchor) {
              nodeB.position.x += dir * shift
            } else if (!boundsA.isAnchor && boundsB.isAnchor) {
              nodeA.position.x -= dir * shift
            } else if (boundsA.isAttribute && !boundsB.isAttribute) {
              nodeB.position.x += dir * shift
            } else if (!boundsA.isAttribute && boundsB.isAttribute) {
              nodeA.position.x -= dir * shift
            } else {
              nodeA.position.x -= dir * (shift / 2)
              nodeB.position.x += dir * (shift / 2)
            }
          } else {
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

  for (const n of nodes) {
    if (n.position.x < minCoord) n.position.x = minCoord
    if (n.position.y < minCoord) n.position.y = minCoord
  }
}
