import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { memo } from 'react'

export interface ChenEdgeData extends Record<string, unknown> {
  cardinalityLabel?: string // '1', 'N', 'M'
  isAttributeEdge?: boolean
}

export type ChenEdgeType = Edge<ChenEdgeData, 'chenEdge'>

function ChenEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<ChenEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: data?.isAttributeEdge ? 0.15 : 0.25,
  })

  const isAttr = data?.isAttributeEdge
  const cardLabel = data?.cardinalityLabel

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#df4e3e' : isAttr ? '#a8a29e' : '#1f1f1f',
          strokeWidth: selected ? 2.5 : isAttr ? 1.2 : 2,
          strokeDasharray: isAttr ? '3,3' : undefined,
        }}
      />

      {/* 实体与联系之间的基数标签：1, N, M */}
      {cardLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-[#1f1f1f] bg-white text-[11px] font-black font-mono text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f]"
          >
            {cardLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default memo(ChenEdge)
