import { useStore } from '../../store/erStore'
import DialectSegment from '../ui/DialectSegment'

export default function DerivePhysicalCard() {
  const conceptualDesign = useStore((state) => state.conceptualDesign)
  const agentPhase = useStore((state) => state.agentPhase)
  const targetDialect = useStore((state) => state.targetDialect)
  const setTargetDialect = useStore((state) => state.setTargetDialect)
  const derivePhysical = useStore((state) => state.derivePhysical)
  const setCanvasViewMode = useStore((state) => state.setCanvasViewMode)
  const aiRunning = useStore((state) => state.aiRunning)

  const conceptsCount = conceptualDesign?.concepts?.length ?? 0
  const relationsCount = conceptualDesign?.relations?.length ?? 0
  const isDeriving = agentPhase === 'deriving_physical'

  if (conceptsCount === 0 || (agentPhase !== 'concept_ready' && !isDeriving)) {
    return null
  }

  return (
    <div className="w-full rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f] space-y-3">
      <div className="flex items-center justify-between border-b border-stone-100 pb-2">
        <div className="flex items-center gap-1.5">
          <svg aria-hidden="true" className="w-4 h-4 text-[#df4e3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1.5 3 3.5 3s3.5-1 3.5-3V7c0-2-1.5-3-3.5-3S4 5 4 7zm0 5c0 2 1.5 3 3.5 3s3.5-1 3.5-3m-7-5c0 2 1.5 3 3.5 3s3.5-1 3.5-3m10 0v10c0 2 1.5 3 3.5 3s3.5-1 3.5-3V7c0-2-1.5-3-3.5-3s-3.5 1-3.5 3zm0 5c0 2 1.5 3 3.5 3s3.5-1 3.5-3m-7-5c0 2 1.5 3 3.5 3s3.5-1 3.5-3" />
          </svg>
          <span className="text-xs font-bold text-[#1f1f1f]">概念模型就绪 · 物理推导</span>
        </div>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            isDeriving ? 'bg-amber-100 text-amber-800 animate-pulse' : 'bg-sky-100 text-sky-800'
          }`}
        >
          {isDeriving ? '正在推导中' : '待推导物理表'}
        </span>
      </div>

      <p className="text-[11.5px] leading-relaxed text-stone-600">
        已提炼 {conceptsCount} 个业务概念、{relationsCount} 组关联关系。选择目标数据库方言后，可一键推导物理建表规范与索引。
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-stone-400">
            目标数据库方言
          </span>
          <span className="text-[10px] text-stone-400 font-mono">
            {targetDialect.toUpperCase()}
          </span>
        </div>
        <DialectSegment
          value={targetDialect}
          onChange={setTargetDialect}
          disabled={aiRunning}
          variant="block"
          ariaLabel="目标数据库方言"
        />
      </div>

      <div className="space-y-2 pt-1">
        <button
          type="button"
          disabled={aiRunning}
          onClick={() => void derivePhysical(targetDialect)}
          className="w-full py-2 px-3 rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] text-white text-xs font-bold shadow-[2px_2px_0px_#1f1f1f] hover:bg-[#c84031] active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 cursor-pointer"
        >
          {isDeriving ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>正在推导物理表与索引…</span>
            </>
          ) : (
            <>
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <span>推导物理表与索引</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => setCanvasViewMode('chen')}
          className="w-full py-1.5 px-2.5 rounded-lg border border-stone-300 bg-white text-[11px] font-bold text-stone-700 hover:border-[#1f1f1f] hover:bg-stone-50 transition flex items-center justify-center gap-1 cursor-pointer"
        >
          <svg aria-hidden="true" className="w-3 h-3 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          <span>陈氏白板审阅</span>
        </button>
      </div>
    </div>
  )
}
