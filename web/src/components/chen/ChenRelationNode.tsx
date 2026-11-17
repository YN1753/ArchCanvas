import type { Node, NodeProps } from '@xyflow/react'
import { memo } from 'react'

import { CHEN_NODE_DIMENSIONS } from '../../flow/chen/dimensions'
import type { Cardinality } from '../../types/dsl'
import ChenNodeHandles from './ChenNodeHandles'

export interface ChenRelationNodeData extends Record<string, unknown> {
  relationId?: string
  name: string
  cardinality: Cardinality
  sourceEntityId?: string
  targetEntityId?: string
  isJunctionTable?: boolean
}

export type ChenRelationNodeType = Node<ChenRelationNodeData, 'chenRelation'>

const W = CHEN_NODE_DIMENSIONS.relation.width
const H = CHEN_NODE_DIMENSIONS.relation.height
const CX = W / 2
const CY = H / 2
const SHADOW_POINTS = `${CX},5 ${W - 3},${CY + 2} ${CX},${H - 1} 3,${CY + 2}`
const DIAMOND_POINTS = `${CX},3 ${W - 5},${CY} ${CX},${H - 3} 5,${CY}`

function ChenRelationNode({ data, selected }: NodeProps<ChenRelationNodeType>) {
  return (
    <div
      style={{ width: W, height: H }}
      className="group relative flex cursor-pointer items-center justify-center select-none"
    >
      <ChenNodeHandles mode="bidirectional" pinToVertices />

      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox={`0 0 ${W} ${H}`}
        fill="none"
      >
        <polygon
          points={SHADOW_POINTS}
          fill="#1f1f1f"
          className="translate-x-[2px] translate-y-[2px]"
        />
        <polygon
          points={DIAMOND_POINTS}
          fill={selected ? '#fee2e2' : '#fef9ee'}
          stroke={selected ? '#df4e3e' : '#1f1f1f'}
          strokeWidth="2"
          strokeLinejoin="round"
          className="transition-colors"
        />
      </svg>

      <div className="relative z-10 flex flex-col items-center justify-center text-center px-2">
        <span className="text-[12px] font-black text-[#1f1f1f] leading-tight">
          {data.name}
        </span>
        <span className="mt-0.5 rounded px-1.5 py-0.5 text-[9px] font-black font-mono leading-none bg-stone-100 text-stone-700 border border-stone-300">
          {data.cardinality === 'many_to_many'
            ? 'M:N'
            : data.cardinality === 'one_to_one'
              ? '1:1'
              : '1:N'}
        </span>
      </div>
    </div>
  )
}

export default memo(ChenRelationNode)
