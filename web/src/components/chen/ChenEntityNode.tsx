import type { Node, NodeProps } from '@xyflow/react'
import { memo } from 'react'

import { CHEN_NODE_DIMENSIONS } from '../../flow/chen/dimensions'
import { useStore } from '../../store/erStore'
import type { BusinessConcept, Entity } from '../../types/dsl'
import { getEntityChineseName } from '../../utils/chinese'
import ChenNodeHandles from './ChenNodeHandles'

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
  const chineseName =
    data.displayName ||
    concept?.display_name ||
    entity?.comment?.trim() ||
    (name ? getEntityChineseName(name, entity?.comment || concept?.description) : '')
  const entityId = data.conceptId || concept?.id || entity?.id || ''

  const isFocused = useStore((state) =>
    Boolean(
      state.focusedEntityId &&
        (state.focusedEntityId === entityId ||
          (name && state.focusedEntityId.toLowerCase() === name.toLowerCase())),
    ),
  )

  return (
    <div
      title={chineseName && name && chineseName !== name ? `${chineseName} (${name})` : chineseName || name}
      style={{
        width: CHEN_NODE_DIMENSIONS.entity.width,
        height: CHEN_NODE_DIMENSIONS.entity.height,
      }}
      className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 bg-white px-3 py-1.5 transition-all select-none ${
        selected || isFocused
          ? 'border-[#df4e3e] shadow-[3px_3px_0px_#df4e3e] ring-2 ring-red-200'
          : 'border-[#1f1f1f] shadow-[3px_3px_0px_#1f1f1f] hover:shadow-[4px_4px_0px_#1f1f1f]'
      }`}
    >
      <ChenNodeHandles mode="bidirectional" />

      <div className="flex items-center justify-center text-center">
        <span className="text-[14px] font-black text-[#1f1f1f] tracking-tight leading-none truncate max-w-[130px]">
          {chineseName || name}
        </span>
      </div>
    </div>
  )
}

export default memo(ChenEntityNode)
