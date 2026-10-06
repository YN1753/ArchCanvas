import { useMemo, useState } from 'react'

import { entityToSQL } from '../export/sql'
import { useStore } from '../store/erStore'
import {
  CARDINALITIES,
  CARDINALITY_LABEL,
  DB_TYPE_SUGGESTIONS,
  isLocalID,
  type Attribute,
  type AttributeCategory,
  type Cardinality,
  type ConceptAttribute,
  type DatabaseDialect,
} from '../types/dsl'
import {
  CARDINALITY_CHINESE,
  getAttributeChineseName,
  getEntityChineseName,
} from '../utils/chinese'
import Combobox from './Combobox'
import Select from './Select'

const inputBase =
  'rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1.5 text-xs text-[#1f1f1f] outline-none transition focus:border-[#df4e3e] focus:ring-2 focus:ring-[#df4e3e]/20 shadow-[1px_1px_0px_#1f1f1f]'
const inputClass = `w-full ${inputBase}`

function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const replaced = trimmed.replace(/[^a-zA-Z0-9_]/g, '_')
  return replaced.replace(/^_+/, '').toLowerCase()
}

const CONCEPT_CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'string', label: '文本 (string)' },
  { value: 'number', label: '数值 (number)' },
  { value: 'boolean', label: '布尔 (boolean)' },
  { value: 'datetime', label: '时间 (datetime)' },
  { value: 'enum', label: '枚举 (enum)' },
  { value: 'media', label: '媒体 (media)' },
]

function Chip({
  active,
  children,
  title,
  tone = 'slate',
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  title: string
  tone?: 'slate' | 'amber' | 'indigo'
  onClick: () => void
}) {
  const activeClass =
    tone === 'amber'
      ? 'border-[#1f1f1f] bg-[#df4e3e] font-bold text-white shadow-[1px_1px_0px_#1f1f1f]'
      : tone === 'indigo'
        ? 'border-[#1f1f1f] bg-[#fdf0ee] font-bold text-[#df4e3e] shadow-[1px_1px_0px_#1f1f1f]'
        : 'border-[#1f1f1f] bg-stone-200 font-bold text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f]'

  const idleClass = 'border-stone-300 bg-white text-stone-500 hover:border-[#1f1f1f] hover:text-[#1f1f1f]'

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded border-[1.5px] px-1.5 py-0.5 text-[10px] transition ${
        active ? activeClass : idleClass
      }`}
    >
      {children}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-500">
      {children}
    </h3>
  )
}

function AttributeEditor({
  entityID,
  attribute,
  index,
  total,
}: {
  entityID: string
  attribute: Attribute
  index: number
  total: number
}) {
  const updateAttribute = useStore((state) => state.updateAttribute)
  const deleteAttribute = useStore((state) => state.deleteAttribute)
  const moveAttribute = useStore((state) => state.moveAttribute)

  const attrChinese = getAttributeChineseName(
    attribute.name,
    attribute.description,
    attribute.is_primary_key,
  )

  return (
    <div className="group rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-2.5 shadow-[2px_2px_0px_#1f1f1f] hover:shadow-[3px_3px_0px_#1f1f1f] transition">
      <div className="flex items-center gap-1.5">
        <input
          className={`${inputBase} ident min-w-0 flex-1`}
          value={attribute.name}
          placeholder="字段名"
          spellCheck={false}
          onChange={(event) =>
            updateAttribute(entityID, attribute.id, { name: event.target.value })
          }
          onBlur={(event) =>
            updateAttribute(entityID, attribute.id, {
              name: normalizeIdentifier(event.target.value),
            })
          }
        />

        <Combobox
          className="w-[108px] shrink-0"
          inputClassName={`${inputBase} ident text-xs font-mono`}
          value={attribute.db_type}
          suggestions={DB_TYPE_SUGGESTIONS}
          onChange={(val) =>
            updateAttribute(entityID, attribute.id, { db_type: val })
          }
        />
      </div>

      <div className="mt-2 flex items-center gap-1">
        <Chip
          tone="amber"
          active={attribute.is_primary_key}
          title="主键约束 (Primary Key)"
          onClick={() =>
            updateAttribute(entityID, attribute.id, {
              is_primary_key: !attribute.is_primary_key,
            })
          }
        >
          PK
        </Chip>

        <Chip
          active={attribute.is_unique}
          title="唯一约束 (Unique)"
          onClick={() =>
            updateAttribute(entityID, attribute.id, { is_unique: !attribute.is_unique })
          }
        >
          UQ
        </Chip>

        <Chip
          active={attribute.is_nullable}
          title="是否允许为 NULL"
          onClick={() =>
            updateAttribute(entityID, attribute.id, { is_nullable: !attribute.is_nullable })
          }
        >
          可空
        </Chip>

        {attrChinese !== attribute.name ? (
          <span
            className="text-[10px] text-[#df4e3e] bg-[#fdf0ee] border border-[#df4e3e]/30 rounded px-1.5 py-0.5 truncate max-w-[80px]"
            title={`中文业务含义：${attrChinese}`}
          >
            {attrChinese}
          </span>
        ) : null}

        <span
          className="ident ml-auto max-w-[70px] truncate text-[10px] text-slate-400 font-mono"
          title={`推导 Go 类型: ${attribute.code_type}`}
        >
          {attribute.code_type}
        </span>

        {/* 顺序微调 */}
        <div className="flex items-center gap-0.5 ml-1">
          <button
            type="button"
            title="上移"
            disabled={index === 0}
            className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
            onClick={() => moveAttribute(entityID, attribute.id, -1)}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            title="下移"
            disabled={index === total - 1}
            className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
            onClick={() => moveAttribute(entityID, attribute.id, 1)}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            type="button"
            title="删除字段"
            onClick={() => deleteAttribute(entityID, attribute.id)}
            className="p-1 rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function ConceptAttributeEditor({
  conceptID,
  attribute,
  index,
  total,
}: {
  conceptID: string
  attribute: ConceptAttribute
  index: number
  total: number
}) {
  const updateConceptAttribute = useStore((state) => state.updateConceptAttribute)
  const deleteConceptAttribute = useStore((state) => state.deleteConceptAttribute)
  const moveConceptAttribute = useStore((state) => state.moveConceptAttribute)

  const attrID = attribute.id || attribute.name

  return (
    <div className="group rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-2.5 shadow-[2px_2px_0px_#1f1f1f] hover:shadow-[3px_3px_0px_#1f1f1f] transition">
      <div className="flex items-center gap-1.5">
        <input
          className={`${inputBase} ident min-w-0 flex-1`}
          value={attribute.name}
          placeholder="字段标识"
          spellCheck={false}
          onChange={(event) =>
            updateConceptAttribute(conceptID, attrID, { name: event.target.value })
          }
          onBlur={(event) =>
            updateConceptAttribute(conceptID, attrID, {
              name: normalizeIdentifier(event.target.value),
            })
          }
        />

        <input
          className={`${inputBase} min-w-0 flex-1`}
          value={attribute.display_name || ''}
          placeholder="业务中文名"
          spellCheck={false}
          onChange={(event) =>
            updateConceptAttribute(conceptID, attrID, { display_name: event.target.value })
          }
        />

        <div className="w-[110px] shrink-0">
          <Select
            className="w-full"
            value={attribute.category}
            onChange={(val) =>
              updateConceptAttribute(conceptID, attrID, { category: val as AttributeCategory })
            }
            options={CONCEPT_CATEGORY_OPTIONS}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Chip
            active={Boolean(attribute.is_business_key)}
            title="业务标识：该属性是否为陈氏图中的下划线核心标识"
            tone="amber"
            onClick={() =>
              updateConceptAttribute(conceptID, attrID, {
                is_business_key: !attribute.is_business_key,
              })
            }
          >
            标识
          </Chip>

          <Chip
            active={Boolean(attribute.required)}
            title="必填约束"
            tone="indigo"
            onClick={() =>
              updateConceptAttribute(conceptID, attrID, {
                required: !attribute.required,
              })
            }
          >
            必填
          </Chip>

          <Chip
            active={Boolean(attribute.is_unique)}
            title="唯一性约束"
            tone="slate"
            onClick={() =>
              updateConceptAttribute(conceptID, attrID, {
                is_unique: !attribute.is_unique,
              })
            }
          >
            唯一
          </Chip>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="上移属性"
            disabled={index === 0}
            onClick={() => moveConceptAttribute(conceptID, attrID, -1)}
            className="p-1 rounded text-slate-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>

          <button
            type="button"
            title="下移属性"
            disabled={index === total - 1}
            onClick={() => moveConceptAttribute(conceptID, attrID, 1)}
            className="p-1 rounded text-slate-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <button
            type="button"
            title="删除属性"
            onClick={() => deleteConceptAttribute(conceptID, attrID)}
            className="p-1 rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function ConceptInspector({ conceptID }: { conceptID: string }) {
  const concept = useStore((state) =>
    state.conceptualDesign.concepts.find(
      (c) =>
        c.id === conceptID ||
        c.name.toLowerCase() === conceptID.toLowerCase() ||
        `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}` === conceptID,
    ),
  )
  const updateConcept = useStore((state) => state.updateConcept)
  const deleteConcept = useStore((state) => state.deleteConcept)
  const addConceptAttribute = useStore((state) => state.addConceptAttribute)

  if (!concept) {
    return (
      <div className="rounded-xl border-[1.5px] border-stone-300 bg-white p-4 text-center text-xs text-stone-500">
        未找到对应的业务概念实体，可能已被移除。
      </div>
    )
  }

  const cid = concept.id || conceptID
  const entityChinese = concept.display_name || getEntityChineseName(concept.name)

  return (
    <div className="space-y-4">
      {/* 概念实体基础信息卡片 */}
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>业务概念实体</SectionTitle>
          <span className="text-[11px] font-semibold text-[#df4e3e] bg-[#fdf0ee] border border-[#df4e3e]/30 px-2 py-0.5 rounded-full">
            {entityChinese}
          </span>
        </div>

        <div className="space-y-2 mt-2">
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">概念标识名 (English)</span>
            <input
              className={`${inputClass} ident font-bold text-sm`}
              value={concept.name}
              placeholder="概念标识名（如 User）"
              spellCheck={false}
              onChange={(e) => updateConcept(cid, { name: e.target.value })}
              onBlur={(e) => updateConcept(cid, { name: normalizeIdentifier(e.target.value) })}
            />
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">业务中文名 (Display Name)</span>
            <input
              className={inputClass}
              value={concept.display_name || ''}
              placeholder="中文业务名（如 用户）"
              spellCheck={false}
              onChange={(e) => updateConcept(cid, { display_name: e.target.value })}
            />
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">业务描述说明</span>
            <textarea
              className={`${inputBase} w-full resize-none text-xs`}
              rows={2}
              value={concept.description || ''}
              placeholder="描述该概念在业务链路中的定位..."
              onChange={(e) => updateConcept(cid, { description: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* 概念属性清单 */}
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f] space-y-2.5">
        <div className="flex items-center justify-between">
          <SectionTitle>核心业务属性与标识</SectionTitle>
          <button
            type="button"
            onClick={() => addConceptAttribute(cid)}
            className="flex items-center gap-1 rounded border border-[#df4e3e]/40 bg-[#fdf0ee] px-2 py-0.5 text-[11px] font-bold text-[#df4e3e] hover:bg-[#fae4e1] transition cursor-pointer"
          >
            <span>+</span>
            <span>添加属性</span>
          </button>
        </div>

        <div className="space-y-2">
          {concept.attributes.map((attr, idx) => (
            <ConceptAttributeEditor
              key={attr.id || `${concept.name}_${attr.name}_${idx}`}
              conceptID={cid}
              attribute={attr}
              index={idx}
              total={concept.attributes.length}
            />
          ))}
        </div>
      </div>

      {/* 删除概念危险区域 */}
      <div className="pt-2 border-t border-stone-300">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-rose-300 bg-rose-50/80 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-400 shadow-[1px_1px_0px_#1f1f1f] cursor-pointer"
          onClick={() => deleteConcept(cid)}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>删除该业务概念</span>
        </button>
      </div>
    </div>
  )
}

function EntityInspector({ entityID }: { entityID: string }) {
  const entity = useStore((state) => state.design.entities.find((item) => item.id === entityID))
  const renameEntity = useStore((state) => state.renameEntity)
  const deleteEntity = useStore((state) => state.deleteEntity)
  const addAttribute = useStore((state) => state.addAttribute)
  const targetDialect = useStore((state) => state.targetDialect)
  const [tab, setTab] = useState<'fields' | 'sql'>('fields')
  const [previewDialect, setPreviewDialect] = useState<DatabaseDialect>(targetDialect || 'mysql')
  const [copied, setCopied] = useState(false)

  if (!entity) {
    return (
      <div className="rounded-xl border-[1.5px] border-stone-300 bg-white p-4 text-center text-xs text-stone-500">
        未找到对应的物理数据表实体，可能已被移除。
      </div>
    )
  }

  const entityChinese = getEntityChineseName(entity.name)
  const sqlString = entityToSQL(entity, previewDialect)

  return (
    <div className="space-y-4">
      {/* 实体基础信息卡片 */}
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

        {isLocalID(entity.id) ? (
          <p className="mt-1.5 text-[10px] text-amber-700 font-medium">本地草稿：尚未保存至服务器数据库</p>
        ) : null}

        {/* 标签切换分段器 */}
        <div className="mt-3 flex items-center rounded-lg bg-stone-100 p-0.5 border-[1.5px] border-[#1f1f1f]">
          <button
            type="button"
            onClick={() => setTab('fields')}
            className={`flex-1 text-center py-1 text-xs rounded-md transition font-medium ${
              tab === 'fields'
                ? 'bg-white text-[#1f1f1f] font-bold shadow-[1px_1px_0px_#1f1f1f]'
                : 'text-stone-500 hover:text-[#1f1f1f]'
            }`}
          >
            结构字段 ({entity.attributes.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('sql')}
            className={`flex-1 text-center py-1 text-xs rounded-md transition font-medium ${
              tab === 'sql'
                ? 'bg-white text-[#1f1f1f] font-bold shadow-[1px_1px_0px_#1f1f1f]'
                : 'text-stone-500 hover:text-[#1f1f1f]'
            }`}
          >
            SQL DDL 预览
          </button>
        </div>
      </div>

      {/* Tab 1: 字段设计列表 */}
      {tab === 'fields' && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <SectionTitle>字段清单</SectionTitle>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-bold text-[#df4e3e] hover:underline"
              onClick={() => addAttribute(entity.id)}
            >
              <span>+ 添加新字段</span>
            </button>
          </div>

          <div className="space-y-2">
            {entity.attributes.map((attribute, idx) => (
              <AttributeEditor
                key={attribute.id}
                entityID={entity.id}
                attribute={attribute}
                index={idx}
                total={entity.attributes.length}
              />
            ))}

            {entity.attributes.length === 0 ? (
              <div className="rounded-xl border-[1.5px] border-dashed border-stone-300 p-5 text-center text-xs text-stone-400">
                暂无字段，点击右上角「+ 添加新字段」开始
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Tab 2: SQL DDL 预览 */}
      {tab === 'sql' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionTitle>SQL DDL 结构预览</SectionTitle>
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-[10px] font-bold shadow-2xs">
                {(['mysql', 'postgres', 'sqlite'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setPreviewDialect(d)}
                    className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                      previewDialect === d
                        ? 'bg-[#df4e3e] text-white'
                        : 'text-stone-600 hover:text-[#1f1f1f]'
                    }`}
                  >
                    {d === 'postgres' ? 'PG' : d.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(sqlString)
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1500)
                  } catch {}
                }}
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

      {/* 删除实体危险区域 */}
      <div className="pt-2 border-t border-stone-300">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-rose-300 bg-rose-50/80 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-400 shadow-[1px_1px_0px_#1f1f1f]"
          onClick={() => deleteEntity(entity.id)}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>删除该实体表</span>
        </button>
      </div>
    </div>
  )
}

function ConceptRelationInspector({ relationID }: { relationID: string }) {
  const rel = useStore((state) =>
    (state.conceptualDesign.relations || []).find(
      (r) =>
        (r.id && (r.id === relationID || `rel-${r.id}` === relationID || relationID.includes(r.id))) ||
        (r.source_concept &&
          r.target_concept &&
          relationID.toLowerCase().includes(r.source_concept.toLowerCase()) &&
          relationID.toLowerCase().includes(r.target_concept.toLowerCase())),
    ),
  )
  const updateConceptRelation = useStore((state) => state.updateConceptRelation)
  const deleteConceptRelation = useStore((state) => state.deleteConceptRelation)

  if (!rel) {
    return (
      <div className="rounded-xl border-[1.5px] border-stone-300 bg-white p-4 text-center text-xs text-stone-500">
        未找到对应的业务概念联系，可能已被移除。
      </div>
    )
  }

  const relId = rel.id || relationID
  const cardLabel =
    rel.cardinality === 'many_to_many'
      ? '多对多 (M:N)'
      : rel.cardinality === 'one_to_one'
        ? '一对一 (1:1)'
        : '一对多 (1:N)'

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>概念联系（{rel.name || '业务关联'}）</SectionTitle>
          <span className="text-[11px] font-semibold text-[#df4e3e] bg-[#fdf0ee] border border-[#df4e3e]/30 px-2 py-0.5 rounded-full">
            {cardLabel}
          </span>
        </div>

        <div className="space-y-3 mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-stone-600">源概念：</span>
            <span className="font-mono font-bold text-[#1f1f1f] bg-stone-100 px-2 py-0.5 rounded border border-stone-300">
              {rel.source_concept}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-stone-600">宿概念：</span>
            <span className="font-mono font-bold text-[#1f1f1f] bg-stone-100 px-2 py-0.5 rounded border border-stone-300">
              {rel.target_concept}
            </span>
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">联系谓词动作 (Verb)</span>
            <input
              className={inputClass}
              value={rel.name || ''}
              placeholder="动作谓词（如：发布、包含、选修）"
              spellCheck={false}
              onChange={(e) => updateConceptRelation(relId, { name: e.target.value })}
            />
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">对应基数 (Cardinality)</span>
            <div className="grid grid-cols-3 gap-2">
              {(['one_to_one', 'one_to_many', 'many_to_many'] as const).map((card) => (
                <button
                  key={card}
                  type="button"
                  onClick={() => updateConceptRelation(relId, { cardinality: card })}
                  className={`rounded-lg border-[1.5px] px-2 py-2 text-xs font-bold transition cursor-pointer ${
                    rel.cardinality === card
                      ? 'border-[#1f1f1f] bg-[#fdf0ee] text-[#df4e3e] shadow-[2px_2px_0px_#1f1f1f]'
                      : 'border-stone-300 bg-white text-stone-600 hover:border-[#1f1f1f]'
                  }`}
                >
                  {card === 'one_to_one' ? '1:1' : card === 'one_to_many' ? '1:N' : 'M:N'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">关系业务说明</span>
            <textarea
              className={`${inputBase} w-full resize-none text-xs`}
              rows={2}
              value={rel.description || ''}
              placeholder="说明两者的业务关联语义..."
              onChange={(e) => updateConceptRelation(relId, { description: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="pt-2 border-t border-stone-300">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-rose-300 bg-rose-50/80 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-400 shadow-[1px_1px_0px_#1f1f1f] cursor-pointer"
          onClick={() => deleteConceptRelation(relId)}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>删除此条概念联系</span>
        </button>
      </div>
    </div>
  )
}

function RelationInspector({ relationID }: { relationID: string }) {
  const relation = useStore((state) =>
    state.design.relations.find((item) => item.id === relationID),
  )
  const entities = useStore((state) => state.design.entities)
  const updateRelation = useStore((state) => state.updateRelation)
  const deleteRelation = useStore((state) => state.deleteRelation)

  if (!relation) {
    return (
      <div className="rounded-xl border-[1.5px] border-stone-300 bg-white p-4 text-center text-xs text-stone-500">
        未找到对应的物理关联关系，可能已被移除。
      </div>
    )
  }

  const entityOptions = entities.map((entity) => ({
    value: entity.id,
    label: entity.name,
    sublabel: getEntityChineseName(entity.name),
  }))

  const currentCard = (relation.cardinality || (relation as any).relation_type_id || 'one_to_many') as Cardinality
  const relLabel = CARDINALITY_CHINESE[currentCard]?.label ?? '关联'

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <SectionTitle>关系配置（{relLabel}）</SectionTitle>
        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">源实体（「一」端）</span>
            <Select
              className="w-full"
              value={relation.source_entity_id}
              onChange={(val) => updateRelation(relation.id, { source_entity_id: val })}
              options={entityOptions}
              placeholder="选择源实体..."
            />
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">目标实体</span>
            <Select
              className="w-full"
              value={relation.target_entity_id}
              onChange={(val) => updateRelation(relation.id, { target_entity_id: val })}
              options={entityOptions}
              placeholder="选择目标实体..."
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <SectionTitle>对应基数 (Cardinality)</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {CARDINALITIES.map((cardinality) => (
            <button
              key={cardinality}
              type="button"
              onClick={() => updateRelation(relation.id, { cardinality, relation_type_id: cardinality })}
              className={`rounded-lg border-[1.5px] px-2 py-2 text-xs font-bold transition ${
                currentCard === cardinality
                  ? 'border-[#1f1f1f] bg-[#fdf0ee] text-[#df4e3e] shadow-[2px_2px_0px_#1f1f1f]'
                  : 'border-stone-300 bg-white text-stone-600 hover:border-[#1f1f1f]'
              }`}
            >
              {CARDINALITY_LABEL[cardinality]}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-stone-300">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-rose-300 bg-rose-50/80 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-400 shadow-[1px_1px_0px_#1f1f1f]"
          onClick={() => deleteRelation(relation.id)}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>删除此条关联关系</span>
        </button>
      </div>
    </div>
  )
}

function OverviewInspector() {
  const design = useStore((state) => state.design)
  const report = useStore((state) => state.report)
  const serverWarnings = useStore((state) => state.serverWarnings)

  const warnings = useMemo(
    () => Array.from(new Set([...report.warnings, ...serverWarnings])),
    [report.warnings, serverWarnings],
  )

  const pkCount = design.entities.filter((e) => e.attributes.some((a) => a.is_primary_key)).length
  const pkCoverage = design.entities.length > 0 ? Math.round((pkCount / design.entities.length) * 100) : 100

  return (
    <div className="space-y-4">
      {/* 概览统计面板 */}
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <SectionTitle>设计健康度看板</SectionTitle>
        <div className="grid grid-cols-3 gap-2 text-center mt-2">
          <div className="rounded-lg bg-[#faf7f0] p-2 border-[1.5px] border-[#1f1f1f]">
            <div className="text-base font-bold text-[#1f1f1f]">{design.entities.length}</div>
            <div className="text-[10px] text-stone-500 mt-0.5">实体表</div>
          </div>
          <div className="rounded-lg bg-[#faf7f0] p-2 border-[1.5px] border-[#1f1f1f]">
            <div className="text-base font-bold text-[#1f1f1f]">{design.relations.length}</div>
            <div className="text-[10px] text-stone-500 mt-0.5">关联关系</div>
          </div>
          <div className="rounded-lg bg-[#faf7f0] p-2 border-[1.5px] border-[#1f1f1f]">
            <div className="text-base font-bold text-emerald-600">{pkCoverage}%</div>
            <div className="text-[10px] text-stone-500 mt-0.5">主键覆盖</div>
          </div>
        </div>
      </div>

      {/* 错误与警告诊断 */}
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <SectionTitle>规则校验诊断</SectionTitle>

        {report.errors.length > 0 ? (
          <div className="space-y-1.5 mb-3">
            <span className="text-[10px] font-bold text-rose-700">阻止落库错误（{report.errors.length}）</span>
            {report.errors.map((err) => (
              <div key={err} className="rounded-lg border-[1.5px] border-rose-300 bg-rose-50 p-2 text-[11px] leading-relaxed text-rose-700">
                · {err}
              </div>
            ))}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-amber-700">优化建议（{warnings.length}）</span>
            {warnings.map((warn) => (
              <div key={warn} className="rounded-lg border-[1.5px] border-amber-300 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-700">
                · {warn}
              </div>
            ))}
          </div>
        ) : null}

        {report.errors.length === 0 && warnings.length === 0 ? (
          <div className="rounded-lg border-[1.5px] border-emerald-300 bg-emerald-50/80 p-3 text-center text-xs font-medium text-emerald-700">
            ✓ 结构符合数据库物理建模最佳规范
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border-[1.5px] border-dashed border-stone-400 bg-white/60 p-3 text-[11px] text-stone-600 leading-relaxed flex items-center gap-2">
        <svg className="w-4 h-4 shrink-0 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>提示：点击画布中的任意实体表节点或连线，即可在此展开专属字段编辑与即时 SQL 预览。</span>
      </div>
    </div>
  )
}

export default function Inspector() {
  const selection = useStore((state) => state.selection)
  const canvasViewMode = useStore((state) => state.canvasViewMode)
  const isChenView = canvasViewMode === 'chen'
  const inspectorOpen = useStore((state) => state.inspectorOpen)
  const setInspectorOpen = useStore((state) => state.setInspectorOpen)
  const select = useStore((state) => state.select)

  const hasConcept = useStore((state) =>
    selection?.kind === 'entity'
      ? state.conceptualDesign.concepts.some(
          (c) =>
            c.id === selection.id ||
            c.name.toLowerCase() === selection.id.toLowerCase() ||
            `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}` === selection.id,
        )
      : false,
  )
  const hasPhysicalEntity = useStore((state) =>
    selection?.kind === 'entity'
      ? state.design.entities.some((e) => e.id === selection.id)
      : false,
  )

  const hasConceptRelation = useStore((state) =>
    selection?.kind === 'relation'
      ? state.conceptualDesign.relations.some(
          (r) =>
            r.id === selection.id ||
            `rel-${r.id}` === selection.id ||
            (r.id && selection.id.includes(r.id)) ||
            (r.source_concept &&
              r.target_concept &&
              selection.id.toLowerCase().includes(r.source_concept.toLowerCase()) &&
              selection.id.toLowerCase().includes(r.target_concept.toLowerCase())),
        )
      : false,
  )
  const hasPhysicalRelation = useStore((state) =>
    selection?.kind === 'relation'
      ? state.design.relations.some((r) => r.id === selection.id)
      : false,
  )

  const handleClose = () => {
    setInspectorOpen(false)
    select(null)
  }

  const inspectorTitle = useMemo(() => {
    if (!selection) return '项目设计诊断总览'
    if (isChenView) {
      if (selection.kind === 'entity') {
        return hasConcept ? '业务概念属性检查器' : hasPhysicalEntity ? '数据实体表检查器' : '概念实体检查器'
      }
      if (selection.kind === 'relation') {
        return hasConceptRelation ? '概念联系关系配置' : '关联关系属性配置'
      }
      return '业务概念检查器'
    }
    if (selection.kind === 'entity') {
      return hasPhysicalEntity ? '物理表属性检查器' : hasConcept ? '业务概念属性检查器' : '实体属性检查器'
    }
    if (selection.kind === 'relation') {
      return hasPhysicalRelation ? '物理外键与关联配置' : '关系属性配置'
    }
    return '架构检查器'
  }, [selection, isChenView, hasConcept, hasPhysicalEntity, hasConceptRelation, hasPhysicalRelation])

  const renderEntityContent = () => {
    if (!selection || selection.kind !== 'entity') return null
    if (isChenView) {
      if (hasConcept) return <ConceptInspector conceptID={selection.id} />
      if (hasPhysicalEntity) return <EntityInspector entityID={selection.id} />
      return <ConceptInspector conceptID={selection.id} />
    }
    if (hasPhysicalEntity) return <EntityInspector entityID={selection.id} />
    if (hasConcept) return <ConceptInspector conceptID={selection.id} />
    return <EntityInspector entityID={selection.id} />
  }

  const renderRelationContent = () => {
    if (!selection || selection.kind !== 'relation') return null
    if (isChenView) {
      if (hasConceptRelation) return <ConceptRelationInspector relationID={selection.id} />
      if (hasPhysicalRelation) return <RelationInspector relationID={selection.id} />
      return <ConceptRelationInspector relationID={selection.id} />
    }
    if (hasPhysicalRelation) return <RelationInspector relationID={selection.id} />
    if (hasConceptRelation) return <ConceptRelationInspector relationID={selection.id} />
    return <RelationInspector relationID={selection.id} />
  }

  return (
    <aside
      className={`transition-all duration-200 ease-in-out flex flex-col border-l-[1.5px] border-[#1f1f1f] bg-[#faf7f0] select-none shadow-sm z-20 shrink-0 overflow-hidden ${
        inspectorOpen ? 'w-[340px] opacity-100' : 'w-0 opacity-0 border-l-0 pointer-events-none'
      }`}
    >
      <div className="w-[340px] flex h-full flex-col">
        <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-white px-4 py-3 shadow-[0px_2px_0px_#1f1f1f]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#df4e3e]" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#1f1f1f]">
              {inspectorTitle}
            </h2>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-stone-500 hover:bg-stone-100 hover:text-[#1f1f1f] transition cursor-pointer"
            title="收起检查器"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-4 no-scrollbar">
          {selection?.kind === 'entity' ? renderEntityContent() : null}
          {selection?.kind === 'relation' ? renderRelationContent() : null}
          {!selection ? <OverviewInspector /> : null}
        </div>
      </div>
    </aside>
  )
}
