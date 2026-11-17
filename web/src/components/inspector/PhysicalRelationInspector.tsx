import { useStore } from '../../store/erStore'
import { CARDINALITIES, CARDINALITY_LABEL, type Cardinality } from '../../types/dsl'
import { CARDINALITY_CHINESE, getEntityChineseName } from '../../utils/chinese'
import Select from '../Select'
import { SectionTitle } from './shared'

export default function PhysicalRelationInspector({ relationID }: { relationID: string }) {
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
    sublabel: entity.comment?.trim() || getEntityChineseName(entity.name, entity.comment),
  }))

  const currentCard: Cardinality =
    relation.cardinality || (relation.relation_type_id as Cardinality | undefined) || 'one_to_many'
  const relLabel = CARDINALITY_CHINESE[currentCard]?.label ?? '关联'

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
        <SectionTitle>关系配置（{relLabel}）</SectionTitle>
        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">
              源实体（「一」端）
            </span>
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
              onClick={() =>
                updateRelation(relation.id, { cardinality, relation_type_id: cardinality })
              }
              className={`rounded-lg border-[1.5px] px-2 py-2 text-xs font-bold transition cursor-pointer ${
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
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-rose-300 bg-rose-50/80 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-400 shadow-[1px_1px_0px_#1f1f1f] cursor-pointer"
          onClick={() => deleteRelation(relation.id)}
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>删除此条关联关系</span>
        </button>
      </div>
    </div>
  )
}
