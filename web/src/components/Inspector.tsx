import { useMemo, useState } from 'react'

import { entityToSQL } from '../export/sql'
import { useStore } from '../store/erStore'
import {
  CARDINALITIES,
  CARDINALITY_LABEL,
  DB_TYPE_SUGGESTIONS,
  isLocalID,
  type Attribute,
} from '../types/dsl'
import {
  CARDINALITY_CHINESE,
  getAttributeChineseName,
  getEntityChineseName,
} from '../utils/chinese'
import Combobox from './Combobox'
import Select from './Select'

const inputBase =
  'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-2xs'
const inputClass = `w-full ${inputBase}`

function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const replaced = trimmed.replace(/[^a-zA-Z0-9_]/g, '_')
  return replaced.replace(/^_+/, '').toLowerCase()
}

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
      ? 'border-amber-400 bg-amber-100 font-bold text-amber-900 shadow-2xs'
      : tone === 'indigo'
        ? 'border-indigo-400 bg-indigo-100 font-semibold text-indigo-900 shadow-2xs'
        : 'border-slate-400 bg-slate-200 font-semibold text-slate-800 shadow-2xs'

  const idleClass = 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-slate-600'

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-md border px-1.5 py-0.5 text-[10px] transition ${
        active ? activeClass : idleClass
      }`}
    >
      {children}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
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
    <div className="group rounded-xl border border-slate-200/90 bg-white p-2.5 shadow-2xs hover:border-slate-300 transition">
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
            className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 truncate max-w-[80px]"
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

function EntityInspector({ entityID }: { entityID: string }) {
  const entity = useStore((state) => state.design.entities.find((item) => item.id === entityID))
  const renameEntity = useStore((state) => state.renameEntity)
  const deleteEntity = useStore((state) => state.deleteEntity)
  const addAttribute = useStore((state) => state.addAttribute)
  const [tab, setTab] = useState<'fields' | 'sql'>('fields')
  const [copied, setCopied] = useState(false)

  if (!entity) {
    return null
  }

  const entityChinese = getEntityChineseName(entity.name)
  const sqlString = entityToSQL(entity)

  return (
    <div className="space-y-4">
      {/* 实体基础信息卡片 */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>数据实体表</SectionTitle>
          <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
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
          <p className="mt-1.5 text-[10px] text-amber-600">本地草稿：尚未保存至服务器数据库</p>
        ) : null}

        {/* 标签切换分段器 */}
        <div className="mt-3 flex items-center rounded-lg bg-slate-100 p-0.5 border border-slate-200">
          <button
            type="button"
            onClick={() => setTab('fields')}
            className={`flex-1 text-center py-1 text-xs rounded-md transition font-medium ${
              tab === 'fields'
                ? 'bg-white text-indigo-700 font-semibold shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            结构字段 ({entity.attributes.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('sql')}
            className={`flex-1 text-center py-1 text-xs rounded-md transition font-medium ${
              tab === 'sql'
                ? 'bg-white text-indigo-700 font-semibold shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
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
              className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
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
              <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-xs text-slate-400">
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
            <SectionTitle>CREATE TABLE 语句</SectionTitle>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sqlString)
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1500)
                } catch {}
              }}
              className="flex items-center gap-1 rounded bg-slate-800 text-white px-2 py-0.5 text-[11px] font-medium hover:bg-slate-700 transition"
            >
              {copied ? '✓ 已复制' : '复制 DDL'}
            </button>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] font-mono leading-relaxed text-emerald-300 overflow-x-auto shadow-inner">
            <pre className="whitespace-pre">{sqlString}</pre>
          </div>
        </div>
      )}

      {/* 删除实体危险区域 */}
      <div className="pt-2 border-t border-slate-200">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/60 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-100 hover:text-rose-700"
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

function RelationInspector({ relationID }: { relationID: string }) {
  const relation = useStore((state) =>
    state.design.relations.find((item) => item.id === relationID),
  )
  const entities = useStore((state) => state.design.entities)
  const updateRelation = useStore((state) => state.updateRelation)
  const deleteRelation = useStore((state) => state.deleteRelation)

  if (!relation) {
    return null
  }

  const entityOptions = entities.map((entity) => ({
    value: entity.id,
    label: entity.name,
    sublabel: getEntityChineseName(entity.name),
  }))

  const relLabel = CARDINALITY_CHINESE[relation.cardinality]?.label ?? '关联'

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
        <SectionTitle>关系配置（{relLabel}）</SectionTitle>
        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">源实体（「一」端）</span>
            <Select
              className="w-full"
              value={relation.source_entity_id}
              onChange={(val) => updateRelation(relation.id, { source_entity_id: val })}
              options={entityOptions}
              placeholder="选择源实体..."
            />
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">目标实体</span>
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

      <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
        <SectionTitle>对应基数 (Cardinality)</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {CARDINALITIES.map((cardinality) => (
            <button
              key={cardinality}
              type="button"
              onClick={() => updateRelation(relation.id, { cardinality })}
              className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                relation.cardinality === cardinality
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-2xs ring-2 ring-indigo-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {CARDINALITY_LABEL[cardinality]}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-200">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/60 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-100 hover:text-rose-700"
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
      <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
        <SectionTitle>设计健康度看板</SectionTitle>
        <div className="grid grid-cols-3 gap-2 text-center mt-2">
          <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
            <div className="text-base font-bold text-slate-800">{design.entities.length}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">实体表</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
            <div className="text-base font-bold text-slate-800">{design.relations.length}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">关联关系</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
            <div className="text-base font-bold text-emerald-600">{pkCoverage}%</div>
            <div className="text-[10px] text-slate-400 mt-0.5">主键覆盖</div>
          </div>
        </div>
      </div>

      {/* 错误与警告诊断 */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
        <SectionTitle>规则校验诊断</SectionTitle>

        {report.errors.length > 0 ? (
          <div className="space-y-1.5 mb-3">
            <span className="text-[10px] font-bold text-rose-700">阻止落库错误（{report.errors.length}）</span>
            {report.errors.map((err) => (
              <div key={err} className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] leading-relaxed text-rose-700">
                · {err}
              </div>
            ))}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-amber-700">优化建议（{warnings.length}）</span>
            {warnings.map((warn) => (
              <div key={warn} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-700">
                · {warn}
              </div>
            ))}
          </div>
        ) : null}

        {report.errors.length === 0 && warnings.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 text-center text-xs font-medium text-emerald-700">
            ✓ 结构符合数据库物理建模最佳规范
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200/60 bg-slate-100/50 p-3 text-[11px] text-slate-400 leading-relaxed">
        💡 提示：点击画布中的任意实体表节点或连线，即可在此展开专属字段编辑与即时 SQL 预览。
      </div>
    </div>
  )
}

export default function Inspector() {
  const selection = useStore((state) => state.selection)

  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-slate-200/90 bg-slate-50/90 select-none shadow-sm">
      <div className="border-b border-slate-200 bg-white px-4 py-3 shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-indigo-600" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {selection?.kind === 'entity'
              ? '实体属性检查器'
              : selection?.kind === 'relation'
                ? '关系属性配置'
                : '项目设计诊断总览'}
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 no-scrollbar">
        {selection?.kind === 'entity' ? <EntityInspector entityID={selection.id} /> : null}
        {selection?.kind === 'relation' ? <RelationInspector relationID={selection.id} /> : null}
        {!selection ? <OverviewInspector /> : null}
      </div>
    </aside>
  )
}
