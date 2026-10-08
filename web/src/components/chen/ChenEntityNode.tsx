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
  const chineseName = data.displayName || concept?.display_name || entity?.comment?.trim() || (name ? getEntityChineseName(name, entity?.comment || concept?.description) : '')
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
      title={chineseName && name && chineseName !== name ? `${chineseName} (${name})` : chineseName || name}
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

      {/* 核心实体名（严格遵循标准陈氏 ER 规范：单一纯粹居中名称，不堆叠次级英文） */}
      <div className="flex items-center justify-center text-center">
        <span className="text-[14px] font-black text-[#1f1f1f] tracking-tight leading-none truncate max-w-[130px]">
          {chineseName || name}
        </span>
      </div>
    </div>
  )
}

export default memo(ChenEntityNode)
