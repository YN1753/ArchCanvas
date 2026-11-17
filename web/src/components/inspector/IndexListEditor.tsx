import type { Entity, IndexDefinition } from '../../types/dsl'
import { Chip, inputBase, normalizeIdentifier, SectionTitle } from './shared'

function IndexItemCard({
  entity,
  indexDef,
  onUpdate,
  onDelete,
}: {
  entity: Entity
  indexDef: IndexDefinition
  onUpdate: (newDef: IndexDefinition) => void
  onDelete: () => void
}) {
  const toggleColumn = (colName: string) => {
    const currentCols = indexDef.columns || []
    if (currentCols.includes(colName)) {
      if (currentCols.length <= 1) {
        return
      }
      onUpdate({ ...indexDef, columns: currentCols.filter((c) => c !== colName) })
    } else {
      onUpdate({ ...indexDef, columns: [...currentCols, colName] })
    }
  }

  return (
    <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3 shadow-[2px_2px_0px_#1f1f1f] space-y-2.5">
      <div className="flex items-center gap-1.5">
        <input
          className={`${inputBase} ident min-w-0 flex-1 font-mono text-xs font-bold`}
          value={indexDef.name}
          placeholder="索引名称（如 idx_user_email）"
          spellCheck={false}
          onChange={(e) => onUpdate({ ...indexDef, name: e.target.value })}
          onBlur={(e) => onUpdate({ ...indexDef, name: normalizeIdentifier(e.target.value) })}
        />

        <Chip
          tone="amber"
          active={Boolean(indexDef.is_unique)}
          title="切换是否为唯一索引 (Unique Index)"
          onClick={() => onUpdate({ ...indexDef, is_unique: !indexDef.is_unique })}
        >
          {indexDef.is_unique ? 'UNIQUE' : '普通索引'}
        </Chip>

        <button
          type="button"
          title="删除索引"
          aria-label="删除索引"
          onClick={onDelete}
          className="p-1 rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div>
        <div className="mb-1 text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
          涵盖列 ({indexDef.columns.length})
        </div>
        <div className="flex flex-wrap gap-1">
          {entity.attributes.map((attr) => {
            const selectedIdx = indexDef.columns.indexOf(attr.name)
            const isSelected = selectedIdx !== -1
            return (
              <button
                key={attr.id}
                type="button"
                onClick={() => toggleColumn(attr.name)}
                className={`rounded border-[1.5px] px-2 py-0.5 text-[10px] font-mono transition cursor-pointer ${
                  isSelected
                    ? 'border-[#1f1f1f] bg-[#fdf0ee] font-bold text-[#df4e3e] shadow-[1px_1px_0px_#1f1f1f]'
                    : 'border-stone-300 bg-white text-stone-600 hover:border-[#1f1f1f] hover:text-[#1f1f1f]'
                }`}
                title={
                  isSelected ? `第 ${selectedIdx + 1} 索引覆盖列（点击取消）` : '点击加入索引覆盖列'
                }
              >
                {attr.name}
                {isSelected && indexDef.columns.length > 1 ? (
                  <span className="ml-1 text-[9px] opacity-75 font-sans">({selectedIdx + 1})</span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <input
          className={`${inputBase} w-full text-xs`}
          value={indexDef.comment || ''}
          placeholder="索引用途说明（如：登录邮箱加速查询）"
          spellCheck={false}
          onChange={(e) => onUpdate({ ...indexDef, comment: e.target.value })}
        />
      </div>
    </div>
  )
}

export default function IndexListEditor({
  entity,
  onUpdateIndexes,
}: {
  entity: Entity
  onUpdateIndexes: (indexes: IndexDefinition[]) => void
}) {
  const indexes = entity.indexes || []

  const handleAddIndex = () => {
    const firstCol =
      entity.attributes.find((a) => !a.is_primary_key)?.name || entity.attributes[0]?.name || 'id'
    const baseName = `idx_${entity.name}_${firstCol}`
    let finalName = baseName
    let counter = 1
    while (indexes.some((i) => i.name.toLowerCase() === finalName.toLowerCase())) {
      counter += 1
      finalName = `${baseName}_${counter}`
    }
    onUpdateIndexes([
      ...indexes,
      {
        name: finalName,
        columns: [firstCol],
        is_unique: false,
        comment: '',
      },
    ])
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <SectionTitle>索引清单 (Indexes)</SectionTitle>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-bold text-[#df4e3e] hover:underline cursor-pointer"
          onClick={handleAddIndex}
        >
          <span>+ 添加新索引</span>
        </button>
      </div>

      <div className="space-y-2.5">
        {indexes.map((idx, indexNum) => (
          <IndexItemCard
            key={`${idx.name}_${indexNum}`}
            entity={entity}
            indexDef={idx}
            onUpdate={(newDef) =>
              onUpdateIndexes(indexes.map((item, i) => (i === indexNum ? newDef : item)))
            }
            onDelete={() => onUpdateIndexes(indexes.filter((_, i) => i !== indexNum))}
          />
        ))}

        {indexes.length === 0 ? (
          <div className="rounded-xl border-[1.5px] border-dashed border-stone-300 p-5 text-center text-xs text-stone-400">
            暂无物理索引配置，点击右上角「+ 添加新索引」为高频查询列创建加速或唯一约束索引
          </div>
        ) : null}
      </div>
    </div>
  )
}
