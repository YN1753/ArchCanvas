import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'

import type { Cardinality } from '../types/dsl'
import { CARDINALITY_LABEL } from '../types/dsl'
import type { RelationEdge as RelationEdgeType } from '../flow/adapter'
import { useStore } from '../store/erStore'

/**
 * 优雅鸦爪符号（Martin ER 记法）：
 * 在 Many 端的实体边界处，三条分叉向实体展开并紧贴实体边缘。
 * 在 One 端，线条平滑插入实体锚点，无多余交叉线干扰。
 */
function CrowFoot({
  x,
  y,
  position,
  stroke,
  strokeWidth,
}: {
  x: number
  y: number
  position: Position
  stroke: string
  strokeWidth: number
}) {
  let d = ''
  const spread = 6
  const depth = 10

  switch (position) {
    case Position.Left:
      // 目标节点在右侧，边从左向右接入：在 (x - depth, y) 处分叉，紧贴 (x, y ± spread)
      d = `M ${x} ${y - spread} L ${x - depth} ${y} L ${x} ${y + spread}`
      break
    case Position.Right:
      // 源节点在左侧，边从左向右伸出：在 (x + depth, y) 处分叉，紧贴 (x, y ± spread)
      d = `M ${x} ${y - spread} L ${x + depth} ${y} L ${x} ${y + spread}`
      break
    default:
      break
  }

  return (
    <path
      d={d}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  )
}

function endsOf(cardinality: Cardinality): { sourceMany: boolean; targetMany: boolean } {
  switch (cardinality) {
    case 'one_to_one':
      return { sourceMany: false, targetMany: false }
    case 'many_to_many':
      return { sourceMany: true, targetMany: true }
    case 'one_to_many':
    default:
      return { sourceMany: false, targetMany: true }
  }
}

export default function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected: isEdgeSelectedFromProps,
}: EdgeProps<RelationEdgeType>) {
  const laneIndex = data?.laneIndex ?? 0
  const curvature = 0.3 + (laneIndex % 3) * 0.05

  const [path, defaultLabelX, defaultLabelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature,
  })

  const deleteRelation = useStore((state) => state.deleteRelation)
  const select = useStore((state) => state.select)
  const selection = useStore((state) => state.selection)
  const hoveredEntityId = useStore((state) => state.hoveredEntityId)
  const hoveredRelationId = useStore((state) => state.hoveredRelationId)
  const setHoveredRelationId = useStore((state) => state.setHoveredRelationId)

  const relation = data?.relation
  const cardinality = relation?.cardinality ?? 'one_to_many'
  const { sourceMany, targetMany } = endsOf(cardinality)

  // 1. 判断是否被直接选中，或所属源/宿实体节点被选中
  const isSelected = isEdgeSelectedFromProps || (selection?.kind === 'relation' && selection.id === id)
  const isNodeSelected =
    selection?.kind === 'entity' &&
    (selection.id === relation?.source_entity_id || selection.id === relation?.target_entity_id)

  // 2. 判断是否被直接悬停，或所属源/宿实体节点被悬停
  const isHovered = hoveredRelationId === id
  const isNodeHovered =
    hoveredEntityId !== null &&
    (hoveredEntityId === relation?.source_entity_id || hoveredEntityId === relation?.target_entity_id)

  // 3. 全局是否有任何实体或边正处于交互状态中
  const hasGlobalFocus = Boolean(
    selection || hoveredEntityId || hoveredRelationId
  )

  const isFocused = isSelected || isNodeSelected || isHovered || isNodeHovered

  // 自适应计算关系徽标坐标：
  // 1. 对于相邻两列连线（|dx| <= 360）：使用默认贝塞尔曲线中点（t = 0.5），自然居中在两表之间的通道正中；
  // 2. 对于跨列长连线（|dx| > 360，如 users ➔ reviews 跨越多列）：
  //    若使用全长百分比（如 50% 或 78%），极易砸在中间途经的表格腹部或边框上（如之前的 remark 字段碰撞）。
  //    因此将徽标稳定安置在进门前的平滑走廊中（距离目标端点 55px 处）：
  //    - 不贴死在锚点上（保留 55px 宽敞距离，不拥挤）；
  //    - 绝对处在列间纯净通道中（与两边表框均有 35px+ 留白，绝不撞表）；
  //    - 且稳稳浮现在该外键字段入边的水平引导线上。
  const dx = targetX - sourceX
  let labelX = defaultLabelX
  let labelY = defaultLabelY

  if (Math.abs(dx) > 360) {
    const isSourceFocus =
      (hoveredEntityId && relation && hoveredEntityId === relation.source_entity_id) ||
      (selection?.kind === 'entity' && selection.id === relation?.source_entity_id)

    if (isSourceFocus) {
      // 聚焦源表时，徽标舒展在出表后 55px 的平滑走廊上
      labelX = dx > 0 ? sourceX + 55 : sourceX - 55
      labelY = sourceY
    } else {
      // 默认及聚焦目标表时，徽标平滑浮现在进表前 55px 的平滑走廊上
      labelX = dx > 0 ? targetX - 55 : targetX + 55
      labelY = targetY
    }
  }

  // 样式三态分级：
  // State 1: 无焦点交互（常驻素雅态）—— 柔和 1.25px 浅灰线，隐藏 1:N 徽标，还画板以干净呼吸感
  // State 2: 交互焦点态（选中或悬停）—— 加粗高亮为墨黑或赤陶红，展现 1:N 徽标
  // State 3: 背景退避态（非关联边）—— 自动大幅淡化至 12% 半透明，彻底消除铁丝网毛线团感
  let stroke = '#9ca3af'
  let strokeWidth = 1.25
  let opacity = 0.55
  let showBadge = false

  if (!hasGlobalFocus) {
    stroke = '#9ca3af'
    strokeWidth = 1.25
    opacity = 0.55
    showBadge = false
  } else if (isFocused) {
    if (isSelected || isHovered) {
      stroke = '#df4e3e' // 赤陶红高亮
      strokeWidth = 2.5
    } else {
      stroke = '#1f1f1f' // 所属表交互时的加粗墨黑线
      strokeWidth = 2.0
    }
    opacity = 1
    showBadge = true
  } else {
    stroke = '#d6d3d1'
    strokeWidth = 1.0
    opacity = 0.12
    showBadge = false
  }

  return (
    <>
      <g
        style={{
          opacity,
          transition: 'opacity 0.2s ease, stroke 0.2s ease',
        }}
      >
        {/* 隐藏的加宽点击响应热区，大幅提升鼠标点选关系的灵敏度 */}
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={24}
          className="cursor-pointer"
          onMouseEnter={() => setHoveredRelationId(id)}
          onMouseLeave={() => setHoveredRelationId(null)}
          onClick={(e) => {
            e.stopPropagation()
            select({ kind: 'relation', id })
          }}
        />

        {/* 贝塞尔平滑流线 */}
        <BaseEdge
          path={path}
          markerEnd={markerEnd}
          style={{
            stroke,
            strokeWidth,
            transition: 'stroke 0.2s ease, stroke-width 0.2s ease',
          }}
        />

        {/* 规范鸦爪符号标注端点（仅在“多”端渲染贴边抓手） */}
        {sourceMany && (
          <CrowFoot
            x={sourceX}
            y={sourceY}
            position={sourcePosition}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        )}
        {targetMany && (
          <CrowFoot
            x={targetX}
            y={targetY}
            position={targetPosition}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        )}
      </g>

      {/* 关系基数徽章：仅在焦点高亮时平滑渐现浮现，静止时隐去，彻底消灭全屏浮空药丸 */}
      <EdgeLabelRenderer>
        <div
          onClick={(e) => {
            e.stopPropagation()
            select({ kind: 'relation', id })
          }}
          onMouseEnter={() => setHoveredRelationId(id)}
          onMouseLeave={() => setHoveredRelationId(null)}
          className={`group flex items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-0.5 text-[10px] font-bold transition-all duration-200 cursor-pointer select-none shadow-[2px_2px_0px_#1f1f1f] ${
            showBadge
              ? 'opacity-100 scale-100 pointer-events-auto z-40'
              : 'opacity-0 scale-90 pointer-events-none'
          } ${
            isSelected
              ? 'border-[#df4e3e] bg-[#fdf0ee] text-[#df4e3e] shadow-[2px_2px_0px_#df4e3e]'
              : isHovered
              ? 'border-[#df4e3e] bg-white text-[#df4e3e] shadow-[2px_2px_0px_#df4e3e]'
              : 'border-[#1f1f1f] bg-white text-[#1f1f1f]'
          }`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <span>{CARDINALITY_LABEL[cardinality]}</span>
          {isSelected && (
            <button
              type="button"
              title="删除此关联关系"
              onClick={(e) => {
                e.stopPropagation()
                deleteRelation(id)
              }}
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[#df4e3e] hover:bg-red-100 transition font-bold text-xs"
            >
              ×
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
