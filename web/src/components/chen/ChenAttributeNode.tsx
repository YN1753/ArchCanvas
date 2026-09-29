import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import type { Attribute, ConceptAttribute } from '../../types/dsl'
import { getAttributeChineseName } from '../../utils/chinese'

export interface ChenAttributeNodeData extends Record<string, unknown> {
  attribute?: Attribute
  conceptAttribute?: ConceptAttribute
  name?: string
  displayName?: string
  isKey?: boolean
  category?: string
  description?: string
  entityId: string
  entityName: string
}

export type ChenAttributeNodeType = Node<ChenAttributeNodeData, 'chenAttribute'>

function ChenAttributeNode({ data, selected }: NodeProps<ChenAttributeNodeType>) {
  const isKey = Boolean(data.isKey || data.conceptAttribute?.is_business_key || data.attribute?.is_primary_key)
  const name = data.name || data.conceptAttribute?.name || data.attribute?.name || ''
  const desc = data.description || data.conceptAttribute?.description || data.attribute?.description || ''
  const typeInfo = data.category || data.conceptAttribute?.category || data.attribute?.db_type || ''
  const chineseName =
    data.displayName ||
    data.conceptAttribute?.display_name ||
    getAttributeChineseName(name, desc, isKey)

  return (
    <div
      title={`${name}: ${typeInfo}${desc ? ` (${desc})` : ''}`}
      className={`group relative flex h-[28px] min-w-[64px] max-w-[100px] cursor-default items-center justify-center rounded-full border-[1.5px] px-2.5 transition-all select-none ${
        selected
          ? 'border-[#df4e3e] bg-red-50/90 shadow-[2px_2px_0px_#df4e3e]'
          : 'border-[#1f1f1f] bg-[#fbf9f4] shadow-[1.5px_1.5px_0px_#1f1f1f]'
      }`}
    >
      {/* 4 方向锚点 */}
      <Handle type="target" position={Position.Top} id="top" className="!h-1.5 !w-1.5 !border-none !bg-transparent" />
      <Handle type="target" position={Position.Right} id="right" className="!h-1.5 !w-1.5 !border-none !bg-transparent" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!h-1.5 !w-1.5 !border-none !bg-transparent" />
      <Handle type="target" position={Position.Left} id="left" className="!h-1.5 !w-1.5 !border-none !bg-transparent" />

      <div className="flex items-center justify-center overflow-hidden text-center">
        {isKey ? (
          <span className="truncate text-[11px] font-black text-[#1f1f1f]">
            {/* 陈氏标准：主键/业务标识属性带有下划线 */}
            <span className="underline decoration-[#1f1f1f] decoration-[1.5px] underline-offset-2">
              {chineseName || name}
            </span>
          </span>
        ) : (
          <span className="truncate text-[11px] font-bold text-[#1f1f1f]">
            {chineseName || name}
          </span>
        )}
      </div>
    </div>
  )
}

export default memo(ChenAttributeNode)
