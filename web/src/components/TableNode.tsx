import { Handle, Position, type NodeProps } from '@xyflow/react'

import {
  NODE_HEADER_HEIGHT,
  NODE_ROW_HEIGHT,
  NODE_WIDTH,
  nodeHeight,
  type TableNode as TableNodeType,
} from '../flow/adapter'
import { useStore } from '../store/erStore'
import { getEntityChineseName } from '../utils/chinese'

function getTypeBadgeStyle(dbType: string): string {
  const norm = dbType.toUpperCase()
  if (
    norm.includes('INT') ||
    norm.includes('DECIMAL') ||
    norm.includes('NUMERIC') ||
    norm.includes('FLOAT') ||
    norm.includes('DOUBLE')
  ) {
    return 'text-blue-700 bg-blue-50/80 border-blue-200'
  }
  if (norm.includes('CHAR') || norm.includes('TEXT') || norm.includes('STRING')) {
    return 'text-emerald-700 bg-emerald-50/80 border-emerald-200'
  }
  if (norm.includes('TIME') || norm.includes('DATE')) {
    return 'text-amber-800 bg-amber-50/80 border-amber-200'
  }
  if (norm.includes('BOOL')) {
    return 'text-purple-700 bg-purple-50/80 border-purple-200'
  }
  return 'text-stone-600 bg-stone-100 border-stone-200'
}

export default function TableNode({ data, selected }: NodeProps<TableNodeType>) {
  const entity = data.entity
  const fkAttrNames = data.foreignKeyAttrNames ?? []
  const addAttribute = useStore((state) => state.addAttribute)
  const chineseName = getEntityChineseName(entity.name)

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border-[1.5px] bg-white select-none transition-all duration-150 cursor-grab active:cursor-grabbing ${
        selected
          ? 'border-[#df4e3e] shadow-[4px_4px_0px_#df4e3e] scale-[1.01] z-30'
          : 'border-[#1f1f1f] shadow-[3px_3px_0px_#1f1f1f] hover:shadow-[4px_4px_0px_#1f1f1f]'
      }`}
      style={{ width: NODE_WIDTH, height: nodeHeight(entity) }}
    >
      {/* 4 方向连线锚点 */}
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!-left-[6px] !w-3 !h-3 !border-2 !border-white !bg-[#1f1f1f] group-hover:!bg-[#df4e3e] hover:!scale-125 !transition-all"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!-right-[6px] !w-3 !h-3 !border-2 !border-white !bg-[#1f1f1f] group-hover:!bg-[#df4e3e] hover:!scale-125 !transition-all"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!-top-[6px] !w-3 !h-3 !border-2 !border-white !bg-[#1f1f1f] group-hover:!bg-[#df4e3e] hover:!scale-125 !transition-all"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!-bottom-[6px] !w-3 !h-3 !border-2 !border-white !bg-[#1f1f1f] group-hover:!bg-[#df4e3e] hover:!scale-125 !transition-all"
      />

      {/* 表头 (暖色纸感底色 + 1.5px 黑线) */}
      <div
        className={`flex items-center justify-between gap-1.5 border-b-[1.5px] border-[#1f1f1f] px-3.5 transition-colors ${
          selected ? 'bg-[#fdf0ee]' : 'bg-[#faf7f0]'
        }`}
        style={{ height: NODE_HEADER_HEIGHT }}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* 表格图标 */}
          <div
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-lg transition-colors border border-[#1f1f1f] ${
              selected ? 'bg-[#df4e3e] text-white' : 'bg-white text-[#1f1f1f]'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>

          <div className="min-w-0 flex-1 leading-tight">
            <div className="ident truncate font-bold text-xs text-[#1f1f1f]">
              {entity.name}
            </div>
            {chineseName && chineseName !== entity.name && (
              <div className="text-[10px] text-stone-500 truncate mt-0.2">
                {chineseName}
              </div>
            )}
          </div>
        </div>

        {/* 字段计数徽标 */}
        <span className="shrink-0 rounded-md border border-[#1f1f1f] bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-stone-700 shadow-2xs">
          {entity.attributes.length}
        </span>
      </div>

      {/* 字段列表区 */}
      <div className="divide-y divide-stone-100 bg-white">
        {entity.attributes.map((attribute) => {
          const isFk = fkAttrNames.includes(attribute.name)
          return (
            <div
              key={attribute.id}
              className={`flex items-center justify-between gap-1 px-3.5 text-xs transition-colors hover:bg-[#faf7f0] ${
                attribute.is_primary_key ? 'bg-amber-50/20' : ''
              }`}
              style={{ height: NODE_ROW_HEIGHT }}
            >
              {/* 左侧：主键/外键标记与字段名 */}
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {attribute.is_primary_key ? (
                  <span
                    className="flex shrink-0 items-center justify-center rounded border border-[#df4e3e]/40 bg-[#fdf0ee] px-1 font-mono text-[10px] font-bold text-[#df4e3e]"
                    title="主键 (Primary Key)"
                  >
                    PK
                  </span>
                ) : isFk ? (
                  <span
                    className="flex shrink-0 items-center justify-center rounded border border-blue-200 bg-blue-50 px-1 font-mono text-[10px] font-semibold text-blue-600"
                    title="外键 (Foreign Key)"
                  >
                    FK
                  </span>
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-300 shrink-0" />
                )}

                <span
                  className={`ident truncate ${
                    attribute.is_primary_key ? 'font-bold text-[#1f1f1f]' : 'text-stone-700'
                  }`}
                  title={attribute.description || attribute.name}
                >
                  {attribute.name}
                </span>

                {!attribute.is_nullable && !attribute.is_primary_key && (
                  <span
                    className="text-[9px] text-stone-400 font-mono"
                    title="非空 (NOT NULL)"
                  >
                    *
                  </span>
                )}
              </div>

              {/* 右侧：数据类型徽标 */}
              <span
                className={`ident shrink-0 rounded border px-1 py-0.2 text-[10px] ${getTypeBadgeStyle(
                  attribute.db_type
                )}`}
              >
                {attribute.db_type}
              </span>
            </div>
          )
        })}
      </div>

      {/* 底部微操作条：快速新增字段 */}
      <div className="border-t-[1.5px] border-[#1f1f1f] bg-[#faf7f0] p-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            addAttribute(entity.id)
          }}
          className="w-full flex items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-stone-400 bg-white py-1 text-[11px] font-bold text-stone-700 hover:border-[#df4e3e] hover:text-[#df4e3e] hover:bg-[#fdf0ee] transition shadow-[1px_1px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px]"
        >
          <span>+ 添加字段</span>
        </button>
      </div>
    </div>
  )
}
