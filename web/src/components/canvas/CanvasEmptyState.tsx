import type { CanvasEmptyStateCopy } from '../../flow/views'

export default function CanvasEmptyState({
  copy,
  onCreatePrimary,
  onOpenImportSql,
  onOpenAiArchitect,
}: {
  copy: CanvasEmptyStateCopy
  onCreatePrimary: () => void
  onOpenImportSql: () => void
  onOpenAiArchitect: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6 select-none overflow-y-auto no-scrollbar pb-32">
      <div className="pointer-events-auto flex flex-col items-center max-w-xl w-full text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white text-blue-500 shadow-[2px_2px_0px_#1f1f1f] mb-2">
          <svg aria-hidden="true" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="7" height="6" rx="1" />
            <rect x="14" y="3" width="7" height="6" rx="1" />
            <rect x="8.5" y="15" width="7" height="6" rx="1" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 9v3h11V9M12 12v3" />
          </svg>
        </div>

        <h2 className="text-2xl font-black text-[#1f1f1f] tracking-tight">{copy.title}</h2>
        <p className="mt-1 text-xs text-stone-500 font-medium">{copy.subtitle}</p>

        <div className="w-full space-y-2.5 mt-5">
          <button
            type="button"
            onClick={onCreatePrimary}
            className="group w-full rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] hover:translate-x-0.5 hover:-translate-y-0.5 transition cursor-pointer flex items-center gap-3.5 text-left active:translate-x-1 active:translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#df4e3e]/40 bg-[#fdf0ee] text-[#df4e3e] font-bold text-lg group-hover:scale-105 transition">
              +
            </div>
            <div>
              <div className="text-sm font-bold text-[#1f1f1f]">{copy.createTitle}</div>
              <div className="text-xs text-stone-500 mt-0.5">{copy.createSubtitle}</div>
            </div>
          </button>

          <button
            type="button"
            onClick={onOpenImportSql}
            className="group w-full rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] hover:translate-x-0.5 hover:-translate-y-0.5 transition cursor-pointer flex items-center gap-3.5 text-left active:translate-x-1 active:translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#df4e3e]/40 bg-[#fdf0ee] text-[#df4e3e] group-hover:scale-105 transition">
              <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold text-[#1f1f1f]">导入已有 SQL / DDL</div>
              <div className="text-xs text-stone-500 mt-0.5">
                粘贴建表脚本，瞬间逆向生成架构画板
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onOpenAiArchitect}
            className="group w-full rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] hover:translate-x-0.5 hover:-translate-y-0.5 transition cursor-pointer flex items-center gap-3.5 text-left active:translate-x-1 active:translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#df4e3e]/40 bg-[#fdf0ee] text-[#df4e3e] group-hover:scale-105 transition">
              <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold text-[#1f1f1f]">AI 起草架构</div>
              <div className="text-xs text-stone-500 mt-0.5">打开左侧 AI 架构师，自动铺开实体</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
