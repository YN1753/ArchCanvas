import { useMemo, useState } from 'react'

import { getDialect } from '../../dialects'
import { entityToSQL } from '../../export/sql'
import { detectJunctionTable } from '../../flow/chenAdapter'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { useStore } from '../../store/erStore'
import { DB_TYPE_SUGGESTIONS, type DatabaseDialect } from '../../types/dsl'
import { getEntityChineseName } from '../../utils/chinese'
import DialectSegment from '../ui/DialectSegment'
import AttributeListEditor from './AttributeListEditor'
import IndexListEditor from './IndexListEditor'
import { inputClass, normalizeIdentifier, SectionTitle } from './shared'

export default function PhysicalEntityInspector({ entityID }: { entityID: string }) {
  const entity = useStore((state) => state.design.entities.find((item) => item.id === entityID))
  const renameEntity = useStore((state) => state.renameEntity)
  const updateEntity = useStore((state) => state.updateEntity)
  const deleteEntity = useStore((state) => state.deleteEntity)
  const addAttribute = useStore((state) => state.addAttribute)
  const targetDialect = useStore((state) => state.targetDialect)
  const allEntities = useStore((state) => state.design.entities)
  const allRelations = useStore((state) => state.design.relations)
  const [tab, setTab] = useState<'fields' | 'indexes' | 'sql'>('fields')
  const [previewDialect, setPreviewDialect] = useState<DatabaseDialect>(targetDialect || 'mysql')
  const { copied, copyText } = useCopyFeedback(1500)

  const typeSuggestions = useMemo(() => {
    const dialectTypes = getDialect(targetDialect || 'mysql').recommendedTypes
    return Array.from(new Set([...dialectTypes, ...DB_TYPE_SUGGESTIONS]))
  }, [targetDialect])

  const junctionCheck = useMemo(
    () =>
      entity
        ? detectJunctionTable(entity, allEntities, allRelations)
        : { isJunction: false, businessFieldCount: 0 },
    [entity, allEntities, allRelations],
  )
  const sqlString = useMemo(
    () => (entity && tab === 'sql' ? entityToSQL(entity, previewDialect) : ''),
    [entity, tab, previewDialect],
  )

  if (!entity) {
    return (
      <div className="rounded-xl border-[1.5px] border-stone-300 bg-white p-4 text-center text-xs text-stone-500">
        未找到对应的物理数据表实体，可能已被移除。
      </div>
    )
  }

  const entityChinese = entity.comment?.trim() || getEntityChineseName(entity.name)

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>数据实体表</SectionTitle>
          <span className="text-[11px] font-semibold text-[#df4e3e] bg-[#fdf0ee] border border-[#df4e3e]/30 px-2 py-0.5 rounded-full">
            {entityChinese}
          </span>
        </div>

        <input
          className={`${inputClass} ident font-bold text-sm`}
          value={entity.name}
          placeholder="数据表物理名（如 users）"
          spellCheck={false}
          onChange={(event) => renameEntity(entity.id, event.target.value)}
          onBlur={(event) => renameEntity(entity.id, normalizeIdentifier(event.target.value))}
        />

        <input
          className={`${inputClass} text-xs mt-2`}
          value={entity.comment || ''}
          placeholder="数据表业务中文说明（如：用户核心表）"
          spellCheck={false}
          onChange={(event) => updateEntity(entity.id, { comment: event.target.value })}
        />

        <div className="mt-2.5 pt-2 border-t border-stone-200">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-[1.5px] border-[#1f1f1f] text-[#df4e3e] focus:ring-0 cursor-pointer accent-[#df4e3e]"
                checked={
                  entity.is_junction_table !== undefined
                    ? entity.is_junction_table
                    : junctionCheck.isJunction
                }
                onChange={(e) => updateEntity(entity.id, { is_junction_table: e.target.checked })}
              />
              <span className="text-xs font-bold text-[#1f1f1f]">
                视为技术中间表并在概念图中折叠为联系
              </span>
            </label>
            {entity.is_junction_table !== undefined && (
              <button
                type="button"
                onClick={() => updateEntity(entity.id, { is_junction_table: undefined })}
                className="text-[10px] text-stone-400 hover:text-[#df4e3e] underline cursor-pointer ml-2 shrink-0"
                title="重置为根据字段特征自动判断"
              >
                重置为自动
              </button>
            )}
          </div>
          <p className="mt-1 text-[10px] text-stone-400 pl-5.5 leading-normal">
            {entity.is_junction_table !== undefined
              ? entity.is_junction_table
                ? '已手动设置：强制折叠为多对多菱形联系'
                : '已手动设置：强制保留实体与独立字段椭圆'
              : junctionCheck.isJunction
                ? '系统已根据外键特征自动识别为技术中间表（将折叠为菱形）'
                : `系统识别到包含 ${junctionCheck.businessFieldCount ?? 0} 个独立业务字段，已保留为关联实体`}
          </p>
        </div>

        <div className="mt-3 flex items-center rounded-lg bg-stone-100 p-0.5 border-[1.5px] border-[#1f1f1f]">
          {(['fields', 'indexes', 'sql'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`flex-1 text-center py-1 text-xs rounded-md transition font-medium cursor-pointer ${
                tab === item
                  ? 'bg-white text-[#1f1f1f] font-bold shadow-[1px_1px_0px_#1f1f1f]'
                  : 'text-stone-500 hover:text-[#1f1f1f]'
              }`}
            >
              {item === 'fields'
                ? `结构字段 (${entity.attributes.length})`
                : item === 'indexes'
                  ? `索引 (${(entity.indexes || []).length})`
                  : 'SQL 预览'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'fields' && (
        <AttributeListEditor
          entityID={entity.id}
          attributes={entity.attributes}
          typeSuggestions={typeSuggestions}
          onAddAttribute={() => addAttribute(entity.id)}
        />
      )}

      {tab === 'indexes' && (
        <IndexListEditor
          entity={entity}
          onUpdateIndexes={(indexes) => updateEntity(entity.id, { indexes })}
        />
      )}

      {tab === 'sql' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionTitle>SQL DDL 结构预览</SectionTitle>
            <div className="flex items-center gap-1.5">
              <DialectSegment
                value={previewDialect}
                onChange={setPreviewDialect}
                variant="compact"
                ariaLabel="SQL 预览数据库方言"
              />
              <button
                type="button"
                onClick={() => void copyText(sqlString)}
                className="flex items-center gap-1 rounded border-[1.5px] border-[#1f1f1f] bg-white text-[#1f1f1f] px-2 py-0.5 text-[11px] font-bold hover:bg-stone-100 shadow-[1px_1px_0px_#1f1f1f] transition cursor-pointer"
              >
                {copied ? '✓ 已复制' : '复制 DDL'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#1f1f1f] p-3 text-[11px] font-mono leading-relaxed text-emerald-400 overflow-x-auto shadow-[2px_2px_0px_#1f1f1f] max-h-72">
            <pre className="whitespace-pre">{sqlString}</pre>
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-stone-300">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-rose-300 bg-rose-50/80 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-400 shadow-[1px_1px_0px_#1f1f1f] cursor-pointer"
          onClick={() => deleteEntity(entity.id)}
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>删除该实体表</span>
        </button>
      </div>
    </div>
  )
}
