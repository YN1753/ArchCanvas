import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import { useStore } from '../../store/erStore'
import type { BusinessConcept, Entity } from '../../types/dsl'
import { getEntityChineseName } from '../../utils/chinese'

export interface ChenEntityNodeData extends Record<string, unknown> {
  entity?: Entity
  concept?: BusinessConcept
  name?: string
  displayName?: string
  conceptId?: string
}

export type ChenEntityNodeType = Node<ChenEntityNodeData, 'chenEntity'>

function ChenEntityNode({ data, selected }: NodeProps<ChenEntityNodeType>) {
  const entity = data.entity
  const concept = data.concept
  const name = data.name || concept?.name || entity?.name || ''
  const chineseName = data.displayName || concept?.display_name || (name ? getEntityChineseName(name) : '')
  const entityId = data.conceptId || concept?.id || entity?.id || ''

  const select = useStore((state) => state.select)
  const focusedEntityId = useStore((state) => state.focusedEntityId)
  const isFocused = Boolean(
    focusedEntityId &&
      (focusedEntityId === entityId || (name && focusedEntityId.toLowerCase() === name.toLowerCase())),
  )

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (entityId) {
      select({ kind: 'entity', id: entityId })
    }
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
      {/* 4 方向隐式锚点，供菱形联系、自引用回折与属性椭圆对接 */}
      <Handle type="source" position={Position.Top} id="top" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="source" position={Position.Top} id="top-source" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="target" position={Position.Top} id="top-target" className="!h-2 !w-2 !border-none !bg-transparent" />

      <Handle type="source" position={Position.Right} id="right" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="source" position={Position.Right} id="right-source" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="target" position={Position.Right} id="right-target" className="!h-2 !w-2 !border-none !bg-transparent" />

      <Handle type="source" position={Position.Bottom} id="bottom" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="source" position={Position.Bottom} id="bottom-source" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="target" position={Position.Bottom} id="bottom-target" className="!h-2 !w-2 !border-none !bg-transparent" />

      <Handle type="target" position={Position.Left} id="left" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="target" position={Position.Left} id="left-target" className="!h-2 !w-2 !border-none !bg-transparent" />
      <Handle type="source" position={Position.Left} id="left-source" className="!h-2 !w-2 !border-none !bg-transparent" />

      {/* 核心概念名与英文表名 */}
      <div className="text-center">
        <div className="text-[14px] font-black text-[#1f1f1f] tracking-tight leading-tight">{chineseName}</div>
        <div className="font-mono text-[10px] font-medium text-stone-400 mt-0.5">{name}</div>
      </div>
    </div>
  )
}

export default memo(ChenEntityNode)
