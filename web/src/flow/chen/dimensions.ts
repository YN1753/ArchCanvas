/**
 * 陈氏 ER 图（Chen's Notation）统一几何尺寸与排版间距真源（Single Source of Truth）。
 * 供 `flow/chen/*` 布局/碰撞/连线几何、React 节点组件与 `DataDialog` 图片导出裁剪包围盒共同引用。
 */
export const CHEN_NODE_DIMENSIONS = {
  entity: {
    width: 150,
    height: 52,
  },
  relation: {
    width: 114,
    height: 74,
  },
  attribute: {
    width: 76,
    minWidth: 64,
    maxWidth: 100,
    height: 28,
  },
  layout: {
    colGap: 460,
    rowGap: 320,
    originX: 80,
    originY: 100,
    attrYOffset: 56,
    attrRowGap: 10,
    collisionMinGap: 24,
    minCanvasCoord: 40,
  },
} as const

export function getChenNodeSize(type?: string): { width: number; height: number } {
  switch (type) {
    case 'chenEntity':
      return CHEN_NODE_DIMENSIONS.entity
    case 'chenRelation':
      return CHEN_NODE_DIMENSIONS.relation
    case 'chenAttribute':
      return {
        width: CHEN_NODE_DIMENSIONS.attribute.width,
        height: CHEN_NODE_DIMENSIONS.attribute.height,
      }
    default:
      return CHEN_NODE_DIMENSIONS.entity
  }
}
