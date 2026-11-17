import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import type { ERDesign } from '../../types/dsl'

export default function DslCodeView({
  design,
  onExitCodeView,
}: {
  design: ERDesign
  onExitCodeView: () => void
}) {
  const { copied, copyText } = useCopyFeedback(1500)
  const jsonString = JSON.stringify(design, null, 2)
  const lineCount = jsonString.split('\n').length

  return (
    <div className="relative flex h-full w-full flex-col bg-[#1f1f1f] text-stone-100">
      <div className="flex items-center justify-between border-b border-stone-800 bg-[#18181b] px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-2 w-2 rounded-full bg-[#df4e3e]" />
          <span className="text-xs font-bold text-stone-200">ER DSL 规范源码</span>
          <div className="flex items-center gap-2 text-[11px] text-stone-400 font-mono">
            <span>·</span>
            <span>{design.entities.length} 个实体表</span>
            <span>·</span>
            <span>{design.relations.length} 条关联关系</span>
            <span>·</span>
            <span>{lineCount} 行</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copyText(jsonString)}
            className="flex items-center gap-1.5 rounded-xl border border-stone-700 bg-stone-800 px-3 py-1.5 text-xs font-semibold text-stone-300 hover:bg-stone-700 hover:text-white transition cursor-pointer"
          >
            {copied ? '✓ 已复制' : '复制 JSON'}
          </button>

          <button
            type="button"
            onClick={onExitCodeView}
            className="flex items-center gap-1.5 rounded-xl border border-[#1f1f1f] bg-[#df4e3e] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#c84031] transition cursor-pointer"
          >
            <span>切回画布</span>
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-amber-200/90 selection:bg-[#df4e3e] selection:text-white">
        <textarea
          readOnly
          aria-label="ER DSL JSON 源码"
          value={jsonString}
          spellCheck={false}
          className="ident h-full w-full resize-none bg-transparent outline-none select-text"
        />
      </div>
    </div>
  )
}
