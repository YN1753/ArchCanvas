import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import { memo } from 'react'

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
      d = `M ${x} ${y - spread} L ${x - depth} ${y} L ${x} ${y + spread}`
      break
    case Position.Right:
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

type EdgeVisualState =
  | 'idle'
  | 'selected'
  | 'hovered'
  | 'source-focus'
  | 'target-focus'
  | 'dimmed'

function RelationEdge({
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
  const setHoveredRelationId = useStore((state) => state.setHoveredRelationId)

  const relation = data?.relation
  const srcEntityId = relation?.source_entity_id
  const tgtEntityId = relation?.target_entity_id

  // 原始字符串粒度 Selector：鼠标在非关联节点间移动时返回值恒为 'dimmed'，彻底消除全图连线无效重绘
  const visualState: EdgeVisualState = useStore((state) => {
    const sel = state.selection
    const hovEnt = state.hoveredEntityId
    const hovRel = state.hoveredRelationId

    if (isEdgeSelectedFromProps || (sel?.kind === 'relation' && sel.id === id)) {
      return 'selected'
    }
    if (hovRel === id) {
      return 'hovered'
    }
    const isSrcHovered = hovEnt !== null && hovEnt === srcEntityId
    const isTgtHovered = hovEnt !== null && hovEnt === tgtEntityId
    const isSrcSelected = sel?.kind === 'entity' && sel.id === srcEntityId
    const isTgtSelected = sel?.kind === 'entity' && sel.id === tgtEntityId

    if (isSrcHovered || isSrcSelected) {
      return 'source-focus'
    }
    if (isTgtHovered || isTgtSelected) {
      return 'target-focus'
    }
    if (sel || hovEnt || hovRel) {
      return 'dimmed'
    }
    return 'idle'
  })

  const cardinality = relation?.cardinality ?? 'one_to_many'
  const { sourceMany, targetMany } = endsOf(cardinality)

  const isSelected = visualState === 'selected'
  const isHovered = visualState === 'hovered'
  const isFocused =
    isSelected || isHovered || visualState === 'source-focus' || visualState === 'target-focus'

  const dx = targetX - sourceX
  let labelX = defaultLabelX
  let labelY = defaultLabelY

  if (Math.abs(dx) > 360) {
    if (visualState === 'source-focus') {
      labelX = dx > 0 ? sourceX + 55 : sourceX - 55
      labelY = sourceY
    } else {
      labelX = dx > 0 ? targetX - 55 : targetX + 55
      labelY = targetY
    }
  }

  let stroke = '#9ca3af'
  let strokeWidth = 1.25
  let opacity = 0.55
  let showBadge = false

  if (visualState === 'idle') {
    stroke = '#9ca3af'
    strokeWidth = 1.25
    opacity = 0.55
    showBadge = false
  } else if (isFocused) {
    if (isSelected || isHovered) {
      stroke = '#df4e3e'
      strokeWidth = 2.5
    } else {
      stroke = '#1f1f1f'
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

        <BaseEdge
          path={path}
          markerEnd={markerEnd}
          style={{
            stroke,
            strokeWidth,
            transition: 'stroke 0.2s ease, stroke-width 0.2s ease',
          }}
        />

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
              aria-label="删除此关联关系"
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

export default memo(RelationEdge)
