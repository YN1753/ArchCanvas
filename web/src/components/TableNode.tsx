import { Handle, Position, type NodeProps } from '@xyflow/react'

import {
  NODE_FOOTER_PADDING,
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
    return 'bg-blue-50 text-blue-700 border-blue-200/60'
  }
  if (norm.includes('CHAR') || norm.includes('TEXT') || norm.includes('STRING')) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
  }
  if (norm.includes('TIME') || norm.includes('DATE')) {
    return 'bg-amber-50 text-amber-700 border-amber-200/60'
  }
  if (norm.includes('BOOL')) {
    return 'bg-purple-50 text-purple-700 border-purple-200/60'
  }
  return 'bg-slate-50 text-slate-600 border-slate-200/60'
}

/**
 * 实体表节点（现代化企业级 ER 数据卡片视图）。
 * 提供 4 方向连线锚点、PK/FK/UQ 徽标分类、字段类型语义色彩与拖拽抓手微动效。
 */
export default function TableNode({ data, selected }: NodeProps<TableNodeType>) {
  const entity = data.entity
  const fkAttrNames = data.foreignKeyAttrNames ?? []
  const addAttribute = useStore((state) => state.addAttribute)
  const primaryKeyAttrs = entity.attributes.filter((attribute) => attribute.is_primary_key)
  const chineseName = getEntityChineseName(entity.name)

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-white select-none transition-all duration-150 cursor-grab active:cursor-grabbing ${
        selected
          ? 'border-indigo-500 shadow-xl ring-2 ring-indigo-500/25 scale-[1.01] z-30'
          : 'border-slate-300/90 shadow-2xs hover:border-slate-400 hover:shadow-md'
      }`}
      style={{ width: NODE_WIDTH, height: nodeHeight(entity) }}
    >
      {/* 4 方向连线锚点 (Loose 模式下支持双向任意拖拽) */}
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!-left-[6px] !w-3 !h-3 !border-2 !border-white !bg-slate-400 group-hover:!bg-indigo-600 hover:!scale-125 !transition-all !shadow-xs"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!-right-[6px] !w-3 !h-3 !border-2 !border-white !bg-slate-400 group-hover:!bg-indigo-600 hover:!scale-125 !transition-all !shadow-xs"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!-top-[6px] !w-3 !h-3 !border-2 !border-white !bg-slate-400 group-hover:!bg-indigo-600 hover:!scale-125 !transition-all !shadow-xs"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!-bottom-[6px] !w-3 !h-3 !border-2 !border-white !bg-slate-400 group-hover:!bg-indigo-600 hover:!scale-125 !transition-all !shadow-xs"
      />

      {/* 表头 */}
      <div
        className={`flex items-center justify-between gap-1.5 border-b px-3 transition-colors ${
          selected
            ? 'border-indigo-100 bg-indigo-50/80 text-indigo-950'
            : 'border-slate-200/90 bg-slate-50/90 text-slate-800'
        }`}
        style={{ height: NODE_HEADER_HEIGHT }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Table Icon */}
          <div
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${
              selected ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>

          <span className="ident truncate font-bold text-xs" title={entity.name}>
            {entity.name}
          </span>

          {chineseName !== entity.name && (
            <span
              className="text-[10px] text-slate-400 truncate max-w-[70px] bg-slate-100 px-1 py-0.2 rounded"
              title={`中文业务概念: ${chineseName}`}
            >
              {chineseName}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {primaryKeyAttrs.length === 0 && entity.attributes.length > 0 && (
            <span
              className="rounded bg-rose-50 border border-rose-200 px-1 py-0.2 text-[9px] font-semibold text-rose-600"
              title="缺少主键"
            >
              无PK
            </span>
          )}

          <span className="text-[10px] tabular-nums text-slate-400 font-mono">
            {entity.attributes.length}
          </span>

          {/* 快捷添加字段按钮 */}
          <button
            type="button"
            title="添加字段"
            onClick={(e) => {
              e.stopPropagation()
              addAttribute(entity.id)
            }}
            className="p-0.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* 字段列表 */}
      <div className="divide-y divide-slate-100/60">
        {entity.attributes.map((attribute) => {
          const isFk = fkAttrNames.includes(attribute.name)
          const typeStyle = getTypeBadgeStyle(attribute.db_type)

          return (
            <div
              key={attribute.id}
              className="flex items-center gap-1.5 px-3 text-[11px] leading-none hover:bg-slate-50/80 transition-colors"
              style={{ height: NODE_ROW_HEIGHT }}
            >
              {/* PK / FK / UQ 徽章列 */}
              <span className="w-10 shrink-0 flex items-center gap-0.5">
                {attribute.is_primary_key && (
                  <span
                    className="inline-flex items-center justify-center rounded bg-amber-100 text-amber-800 px-1 py-0.2 text-[9px] font-bold tracking-tighter shadow-2xs"
                    title="主键 (Primary Key)"
                  >
                    PK
                  </span>
                )}
                {isFk && (
                  <span
                    className="inline-flex items-center justify-center rounded bg-indigo-100 text-indigo-700 px-1 py-0.2 text-[9px] font-bold tracking-tighter shadow-2xs"
                    title="外键 (Foreign Key)"
                  >
                    FK
                  </span>
                )}
                {attribute.is_unique && !attribute.is_primary_key && (
                  <span
                    className="inline-flex items-center justify-center rounded bg-slate-100 text-slate-600 px-1 py-0.2 text-[9px] font-semibold tracking-tighter"
                    title="唯一约束 (Unique)"
                  >
                    UQ
                  </span>
                )}
              </span>

              {/* 字段名称 */}
              <span
                className={
                  attribute.is_primary_key
                    ? 'ident flex-1 truncate font-semibold text-slate-800'
                    : 'ident flex-1 truncate text-slate-600'
                }
                title={attribute.description ? `${attribute.name} · ${attribute.description}` : attribute.name}
              >
                {attribute.name}
              </span>

              {/* 可空标记 */}
              {attribute.is_nullable ? (
                <span className="shrink-0 text-[10px] text-slate-300 font-mono" title="可为空 (Nullable)">
                  ?
                </span>
              ) : null}

              {/* 数据库类型分类徽章 */}
              <span
                className={`shrink-0 max-w-[84px] truncate rounded px-1.5 py-0.5 text-right font-mono text-[10px] border ${typeStyle}`}
                title={`${attribute.db_type} → ${attribute.code_type}`}
              >
                {attribute.db_type}
              </span>
            </div>
          )
        })}

        {entity.attributes.length === 0 && (
          <div
            className="flex items-center justify-center px-3 text-[11px] text-slate-400 italic"
            style={{ height: NODE_ROW_HEIGHT }}
          >
            暂无字段
          </div>
        )}
      </div>

      <div style={{ height: NODE_FOOTER_PADDING }} />
    </div>
  )
}
