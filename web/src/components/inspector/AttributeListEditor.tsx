import { useStore } from '../../store/erStore'
import type { Attribute } from '../../types/dsl'
import { getAttributeChineseName } from '../../utils/chinese'
import Combobox from '../Combobox'
import { Chip, inputBase, normalizeIdentifier, SectionTitle } from './shared'

function AttributeEditor({
  entityID,
  attribute,
  index,
  total,
  typeSuggestions,
}: {
  entityID: string
  attribute: Attribute
  index: number
  total: number
  typeSuggestions: readonly string[]
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
          onChange={(event) => updateAttribute(entityID, attribute.id, { name: event.target.value })}
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
          suggestions={typeSuggestions}
          onChange={(val) => updateAttribute(entityID, attribute.id, { db_type: val })}
        />
      </div>

      <div className="mt-1.5">
        <input
          className={`${inputBase} w-full text-xs`}
          value={attribute.comment || attribute.description || ''}
          placeholder="字段业务说明（如：用户登录账号）"
          spellCheck={false}
          onChange={(event) =>
            updateAttribute(entityID, attribute.id, {
              comment: event.target.value,
              description: event.target.value,
            })
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
          onClick={() => updateAttribute(entityID, attribute.id, { is_unique: !attribute.is_unique })}
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

        <div className="flex items-center gap-0.5 ml-1">
          <button
            type="button"
            title="上移"
            aria-label="上移字段"
            disabled={index === 0}
            className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
            onClick={() => moveAttribute(entityID, attribute.id, -1)}
          >
            <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            title="下移"
            aria-label="下移字段"
            disabled={index === total - 1}
            className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
            onClick={() => moveAttribute(entityID, attribute.id, 1)}
          >
            <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            type="button"
            title="删除字段"
            aria-label="删除字段"
            onClick={() => deleteAttribute(entityID, attribute.id)}
            className="p-1 rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
          >
            <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AttributeListEditor({
  entityID,
  attributes,
  typeSuggestions,
  onAddAttribute,
}: {
  entityID: string
  attributes: Attribute[]
  typeSuggestions: readonly string[]
  onAddAttribute: () => void
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <SectionTitle>字段清单</SectionTitle>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-bold text-[#df4e3e] hover:underline cursor-pointer"
          onClick={onAddAttribute}
        >
          <span>+ 添加新字段</span>
        </button>
      </div>

      <div className="space-y-2">
        {attributes.map((attribute, idx) => (
          <AttributeEditor
            key={attribute.id}
            entityID={entityID}
            attribute={attribute}
            index={idx}
            total={attributes.length}
            typeSuggestions={typeSuggestions}
          />
        ))}

        {attributes.length === 0 ? (
          <div className="rounded-xl border-[1.5px] border-dashed border-stone-300 p-5 text-center text-xs text-stone-400">
            暂无字段，点击右上角「+ 添加新字段」开始
          </div>
        ) : null}
      </div>
    </div>
  )
}
