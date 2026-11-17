import { legacyConceptSyntheticId } from '../../domain/conceptNormalize'
import { useStore } from '../../store/erStore'
import type { AttributeCategory, ConceptAttribute } from '../../types/dsl'
import { getEntityChineseName } from '../../utils/chinese'
import Select from '../Select'
import { Chip, inputBase, inputClass, normalizeIdentifier, SectionTitle } from './shared'

const CONCEPT_CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'string', label: '文本 (string)' },
  { value: 'number', label: '数值 (number)' },
  { value: 'boolean', label: '布尔 (boolean)' },
  { value: 'datetime', label: '时间 (datetime)' },
  { value: 'enum', label: '枚举 (enum)' },
  { value: 'media', label: '媒体 (media)' },
]

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
            aria-label="上移属性"
            disabled={index === 0}
            onClick={() => moveConceptAttribute(conceptID, attrID, -1)}
            className="p-1 rounded text-slate-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
          >
            <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>

          <button
            type="button"
            title="下移属性"
            aria-label="下移属性"
            disabled={index === total - 1}
            onClick={() => moveConceptAttribute(conceptID, attrID, 1)}
            className="p-1 rounded text-slate-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
          >
            <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <button
            type="button"
            title="删除属性"
            aria-label="删除属性"
            onClick={() => deleteConceptAttribute(conceptID, attrID)}
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

export default function ConceptEntityInspector({ conceptID }: { conceptID: string }) {
  const concept = useStore((state) =>
    state.conceptualDesign.concepts.find(
      (c) =>
        c.id === conceptID ||
        c.name.toLowerCase() === conceptID.toLowerCase() ||
        legacyConceptSyntheticId(c.name) === conceptID,
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
  const entityChinese =
    concept.display_name || getEntityChineseName(concept.name, concept.description)

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>业务概念实体</SectionTitle>
          <span className="text-[11px] font-semibold text-[#df4e3e] bg-[#fdf0ee] border border-[#df4e3e]/30 px-2 py-0.5 rounded-full">
            {entityChinese}
          </span>
        </div>

        <div className="space-y-2 mt-2">
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">
              概念标识名 (English)
            </span>
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
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">
              业务中文名 (Display Name)
            </span>
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

      <div className="pt-2 border-t border-stone-300">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-rose-300 bg-rose-50/80 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-400 shadow-[1px_1px_0px_#1f1f1f] cursor-pointer"
          onClick={() => deleteConcept(cid)}
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>删除该业务概念</span>
        </button>
      </div>
    </div>
  )
}
