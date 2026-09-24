import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import { useStore } from '../../store/erStore'
import type { Cardinality } from '../../types/dsl'

export interface ChenRelationNodeData extends Record<string, unknown> {
  relationId?: string
  name: string
  cardinality: Cardinality
  sourceEntityId?: string
  targetEntityId?: string
  isJunctionTable?: boolean
}

export type ChenRelationNodeType = Node<ChenRelationNodeData, 'chenRelation'>

function ChenRelationNode({ data, selected }: NodeProps<ChenRelationNodeType>) {
  const select = useStore((state) => state.select)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (data.relationId) {
      select({ kind: 'relation', id: data.relationId })
    }
  }

  const isSelected = selected

  return (
    <div
      onClick={handleClick}
      className="group relative flex h-[74px] w-[114px] cursor-pointer items-center justify-center select-none"
    >
      {/* 4 顶点精确锚点：Top, Right, Bottom, Left */}
      <Handle type="target" position={Position.Top} id="top" className="!top-0 !h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="source" position={Position.Right} id="right" className="!right-0 !h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bottom-0 !h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="target" position={Position.Left} id="left" className="!left-0 !h-2 !w-2 !border-none !bg-transparent" />

      {/* 经典陈氏菱形 SVG 矢量绘制（带暖纸野兽派硬阴影） */}
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 114 74"
        fill="none"
      >
        {/* 硬阴影 */}
        <polygon
          points="57,5 111,39 57,73 3,39"
          fill="#1f1f1f"
          className="translate-x-[2px] translate-y-[2px]"
        />
        {/* 菱形本体 */}
        <polygon
          points="57,3 109,37 57,71 5,37"
          fill={isSelected ? '#fee2e2' : '#fef9ee'}
          stroke={isSelected ? '#df4e3e' : '#1f1f1f'}
          strokeWidth="2"
          strokeLinejoin="round"
          className="transition-colors"
        />
      </svg>

      {/* 菱形中心内容 */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center px-2">
        <span className="text-[12px] font-black text-[#1f1f1f] leading-tight">
          {data.name}
        </span>
        <span
          className="mt-0.5 rounded px-1.5 py-0.5 text-[9px] font-black font-mono leading-none bg-stone-100 text-stone-700 border border-stone-300"
        >
          {data.cardinality === 'many_to_many'
            ? 'M:N'
            : data.cardinality === 'one_to_many'
              ? '1:N'
              : '1:1'}
        </span>
      </div>
    </div>
  )
}

export default memo(ChenRelationNode)
