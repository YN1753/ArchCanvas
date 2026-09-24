import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import { useStore } from '../../store/erStore'
import type { Entity } from '../../types/dsl'
import { getEntityChineseName } from '../../utils/chinese'

export interface ChenEntityNodeData extends Record<string, unknown> {
  entity: Entity
}

export type ChenEntityNodeType = Node<ChenEntityNodeData, 'chenEntity'>

function ChenEntityNode({ data, selected }: NodeProps<ChenEntityNodeType>) {
  const entity = data.entity
  const chineseName = getEntityChineseName(entity.name)
  const select = useStore((state) => state.select)
  const focusedEntityId = useStore((state) => state.focusedEntityId)
  const isFocused = focusedEntityId === entity.id

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    select({ kind: 'entity', id: entity.id })
  }

  return (
    <div
      onClick={handleClick}
      className={`group relative flex h-[52px] w-[150px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 bg-white px-3 py-1.5 transition-all select-none ${
        selected || isFocused
          ? 'border-[#df4e3e] shadow-[3px_3px_0px_#df4e3e] ring-2 ring-red-200'
          : 'border-[#1f1f1f] shadow-[3px_3px_0px_#1f1f1f] hover:shadow-[4px_4px_0px_#1f1f1f]'
      }`}
    >
      {/* 4 方向隐式锚点，供菱形联系与属性椭圆对接 */}
      <Handle type="source" position={Position.Top} id="top" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="source" position={Position.Right} id="right" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="target" position={Position.Left} id="left" className="!h-2 !w-2 !border-none !bg-transparent" />

      {/* 核心概念名与英文表名 */}
      <div className="text-center">
        <div className="text-[14px] font-black text-[#1f1f1f] tracking-tight leading-tight">{chineseName}</div>
        <div className="font-mono text-[10px] font-medium text-stone-400 mt-0.5">{entity.name}</div>
      </div>
    </div>
  )
}

export default memo(ChenEntityNode)
