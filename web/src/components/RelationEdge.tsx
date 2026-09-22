import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'

import type { Cardinality } from '../types/dsl'
import { CARDINALITY_LABEL } from '../types/dsl'
import type { RelationEdge as RelationEdgeType } from '../flow/adapter'
import { useStore } from '../store/erStore'

/**
 * 关系边，使用专业 SmoothStep 直角圆角路径与 crow's foot（鸦爪）记法。
 *
 * 符号绘制在边的起点/终点处，朝节点外侧展开：
 *   ——|      「一」端：一条垂直于边的短横线
 *   ——<      「多」端：三条张开的线
 */

/** 局部坐标里 +x 指向「沿边远离节点」的方向。 */
function awayAngle(position: Position): number {
  switch (position) {
    case Position.Left:
      return 180
    case Position.Top:
      return -90
    case Position.Bottom:
      return 90
    case Position.Right:
    default:
      return 0
  }
}

function EndSymbol({
  x,
  y,
  angle,
  many,
}: {
  x: number
  y: number
  angle: number
  many: boolean
}) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${angle})`} strokeWidth={1.5} fill="none">
      {many ? (
        <>
          <path d="M 0 0 L 13 7" strokeLinecap="round" />
          <path d="M 0 0 L 13 0" strokeLinecap="round" />
          <path d="M 0 0 L 13 -7" strokeLinecap="round" />
        </>
      ) : (
        <path d="M 9 -6 L 9 6" strokeLinecap="round" />
      )}
    </g>
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
  selected,
}: EdgeProps<RelationEdgeType>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  })

  const deleteRelation = useStore((state) => state.deleteRelation)
  const select = useStore((state) => state.select)

  const cardinality = data?.relation.cardinality ?? 'one_to_many'
  const { sourceMany, targetMany } = endsOf(cardinality)

  const stroke = selected ? '#df4e3e' : '#262626'

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth: selected ? 2.5 : 1.75,
          transition: 'stroke 0.15s, stroke-width 0.15s',
        }}
      />

      {/* 鸦爪符号标注端点 */}
      <g stroke={stroke}>
        <EndSymbol
          x={sourceX}
          y={sourceY}
          angle={awayAngle(sourcePosition)}
          many={sourceMany}
        />
        <EndSymbol
          x={targetX}
          y={targetY}
          angle={awayAngle(targetPosition)}
          many={targetMany}
        />
      </g>

      {/* 关系基数标签与快捷删除操作 */}
      <EdgeLabelRenderer>
        <div
          onClick={(e) => {
            e.stopPropagation()
            select({ kind: 'relation', id })
          }}
          className={`group flex items-center gap-1.5 rounded-xl border-[1.5px] px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer select-none ${
            selected
              ? 'border-[#df4e3e] bg-[#fdf0ee] text-[#df4e3e] shadow-[2px_2px_0px_#df4e3e]'
              : 'border-[#1f1f1f] bg-white text-[#1f1f1f] shadow-[2px_2px_0px_#1f1f1f] hover:border-[#df4e3e]'
          }`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <span>{CARDINALITY_LABEL[cardinality]}</span>
          {selected && (
            <button
              type="button"
              title="删除此关联关系"
              onClick={(e) => {
                e.stopPropagation()
                deleteRelation(id)
              }}
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[#df4e3e] hover:bg-red-100 transition font-bold"
            >
              ×
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
