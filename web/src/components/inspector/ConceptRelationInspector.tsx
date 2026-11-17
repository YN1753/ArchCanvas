import { useStore } from '../../store/erStore'
import { inputBase, inputClass, SectionTitle } from './shared'

export default function ConceptRelationInspector({ relationID }: { relationID: string }) {
  const rel = useStore((state) =>
    (state.conceptualDesign.relations || []).find(
      (r) => r.id === relationID || `rel-${r.id}` === relationID,
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
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">
              联系谓词动作 (Verb)
            </span>
            <input
              className={inputClass}
              value={rel.name || ''}
              placeholder="动作谓词（如：发布、包含、选修）"
              spellCheck={false}
              onChange={(e) => updateConceptRelation(relId, { name: e.target.value })}
            />
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-semibold text-stone-600">
              对应基数 (Cardinality)
            </span>
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
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>删除此条概念联系</span>
        </button>
      </div>
    </div>
  )
}
