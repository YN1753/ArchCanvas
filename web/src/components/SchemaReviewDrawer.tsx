import { useEffect, useMemo, useRef, useState } from 'react'

import { useStore } from '../store/erStore'
import type { DatabaseDialect, SchemaIssue, SchemaIssueCategory, SchemaIssueSeverity } from '../types/dsl'

const CATEGORY_LABELS: Record<SchemaIssueCategory, string> = {
  index: '索引覆盖',
  normalization: '范式规范',
  naming: '命名规范',
  performance: '性能风险',
  type_safety: '类型安全',
}

const SEVERITY_CONFIG: Record<
  SchemaIssueSeverity,
  { label: string; badge: string; border: string; bg: string }
> = {
  critical: {
    label: '严重',
    badge: 'bg-rose-100 text-rose-800 border-rose-300',
    border: 'border-rose-400',
    bg: 'bg-rose-50/40',
  },
  warning: {
    label: '警告',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    border: 'border-amber-400',
    bg: 'bg-amber-50/30',
  },
  info: {
    label: '建议',
    badge: 'bg-blue-100 text-blue-800 border-blue-300',
    border: 'border-blue-400',
    bg: 'bg-blue-50/20',
  },
}

export default function SchemaReviewDrawer({ onClose }: { onClose: () => void }) {
  const reviewReport = useStore((state) => state.reviewReport)
  const designEntityCount = useStore((state) => state.design.entities.length)
  const targetDialect = useStore((state) => state.targetDialect)
  const setTargetDialect = useStore((state) => state.setTargetDialect)
  const reviewSchema = useStore((state) => state.reviewSchema)
  const aiRunning = useStore((state) => state.aiRunning)
  const aiError = useStore((state) => state.aiError)
  const aiStatus = useStore((state) => state.aiStatus)
  const agentPhase = useStore((state) => state.agentPhase)
  const focusEntity = useStore((state) => state.focusEntity)
  const setCanvasViewMode = useStore((state) => state.setCanvasViewMode)
  const setDslView = useStore((state) => state.setDslView)

  const [severityFilter, setSeverityFilter] = useState<'all' | SchemaIssueSeverity>('all')
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const isReviewing = aiRunning && agentPhase === 'reviewing'
  const isCanvasEmpty = designEntityCount === 0

  useEffect(() => {
    closeButtonRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const dialects: Array<{ id: DatabaseDialect; label: string }> = [
    { id: 'mysql', label: 'MySQL 8.0' },
    { id: 'postgres', label: 'PostgreSQL' },
    { id: 'sqlite', label: 'SQLite' },
  ]

  const issues = reviewReport?.issues ?? []

  const counts = useMemo(() => {
    let critical = 0
    let warning = 0
    let info = 0
    for (const issue of issues) {
      if (issue.severity === 'critical') critical += 1
      else if (issue.severity === 'warning') warning += 1
      else if (issue.severity === 'info') info += 1
    }
    return { all: issues.length, critical, warning, info }
  }, [issues])

  const filteredIssues = useMemo(() => {
    if (severityFilter === 'all') return issues
    return issues.filter((i) => i.severity === severityFilter)
  }, [issues, severityFilter])

  const score = reviewReport?.score ?? null
  const scoreConfig =
    score === null
      ? { text: 'text-stone-500', bg: 'bg-stone-100', border: 'border-stone-300', verdict: '尚未执行体检' }
      : score >= 90
        ? { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', verdict: '架构健壮 · 生产级就绪' }
        : score >= 70
          ? { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', verdict: '部分规范待优化' }
          : { text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-300', verdict: '存在高危缺陷 · 亟待修复' }

  const handleLocateEntity = (entityName: string) => {
    setDslView('canvas')
    setCanvasViewMode('relational')
    focusEntity(entityName)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-150">
      <div className="flex-1 cursor-pointer" onClick={onClose} />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="schema-review-drawer-title"
        className="relative flex h-full w-[520px] max-w-[92vw] flex-col border-l-[2px] border-[#1f1f1f] bg-[#faf7f0] shadow-[-6px_0px_0px_#1f1f1f] select-none"
      >
        {/* 1. 顶栏 */}
        <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-white px-4 py-3 shadow-[0px_2px_0px_#1f1f1f] shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] text-white shadow-[1px_1px_0px_#1f1f1f]">
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </span>
            <div>
              <h2 id="schema-review-drawer-title" className="text-xs font-bold uppercase tracking-wider text-[#1f1f1f]">
                架构审查守卫
              </h2>
              <p className="text-[10px] text-stone-500 font-sans">
                静态规则引擎 + LLM 专家批判双重体检
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            aria-label="关闭抽屉"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-white text-stone-700 shadow-[1px_1px_0px_#1f1f1f] hover:bg-[#faf7f0] active:translate-x-0.5 active:translate-y-0.5 transition cursor-pointer"
            title="关闭抽屉 (Esc)"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 2. 方言配置与重新体检条 */}
        <div className="flex items-center justify-between border-b border-stone-200/80 bg-white/60 px-4 py-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-stone-500 font-semibold">
              检测方言:
            </span>
            <div className="flex items-center rounded-lg border border-stone-300 bg-white p-0.5 shadow-2xs">
              {dialects.map((d) => {
                const active = targetDialect === d.id
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={aiRunning || isCanvasEmpty}
                    onClick={() => {
                      setTargetDialect(d.id)
                      if (!isCanvasEmpty) {
                        void reviewSchema(d.id)
                      }
                    }}
                    className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      active
                        ? 'border border-[#1f1f1f] bg-[#1f1f1f] text-white shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            disabled={aiRunning || isCanvasEmpty}
            onClick={() => void reviewSchema(targetDialect)}
            className="flex items-center gap-1 rounded-lg border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-2.5 py-1 text-[11px] font-bold text-white shadow-[1px_1px_0px_#1f1f1f] hover:bg-[#c84031] active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
          >
            {isReviewing ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>体检中…</span>
              </>
            ) : (
              <>
                <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>{reviewReport ? '重新体检' : '立即体检'}</span>
              </>
            )}
          </button>
        </div>

        {/* 3. 抽屉内容区：显式区分空画布、体检中、报错态与真实报告态 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          {isCanvasEmpty ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed border-stone-300 bg-white p-8 text-center shadow-2xs">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] text-stone-600 mb-3 shadow-[2px_2px_0px_#1f1f1f]">
                <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xs font-bold text-[#1f1f1f]">当前画布尚无物理数据表</h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-stone-500 max-w-xs">
                请先在画布中新建实体表、导入 SQL 脚本，或通过 AI 架构师完成「推导物理表与索引」后，再执行架构质量体检。
              </p>
            </div>
          ) : isReviewing && !reviewReport ? (
            <div className="rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-6 shadow-[3px_3px_0px_#1f1f1f] space-y-3 text-center">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#df4e3e] border-t-transparent" />
              <div className="text-xs font-bold text-[#1f1f1f]">
                {aiStatus || '正在对数据表、外键索引与范式规范执行深度体检…'}
              </div>
              <p className="text-[11px] text-stone-500">
                体检将结合静态确定性规则与大模型架构评审综合打分。
              </p>
            </div>
          ) : !reviewReport && aiError ? (
            <div
              role="alert"
              className="rounded-2xl border-[1.5px] border-rose-300 bg-rose-50 p-4 shadow-[3px_3px_0px_#1f1f1f] space-y-3"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-rose-800">
                <span>架构体检执行失败</span>
              </div>
              <p className="text-xs leading-relaxed text-rose-700 break-words select-text font-mono">
                {aiError}
              </p>
              <button
                type="button"
                onClick={() => void reviewSchema(targetDialect)}
                className="rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-3 py-1.5 text-xs font-bold text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f] hover:bg-stone-50 transition cursor-pointer"
              >
                重试架构体检
              </button>
            </div>
          ) : !reviewReport ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed border-stone-300 bg-white p-8 text-center">
              <p className="text-xs font-bold text-stone-700">尚未生成当前模型的架构体检报告</p>
              <button
                type="button"
                onClick={() => void reviewSchema(targetDialect)}
                className="mt-3 rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-4 py-1.5 text-xs font-bold text-white shadow-[2px_2px_0px_#1f1f1f] hover:bg-[#c84031] transition cursor-pointer"
              >
                立即开始体检
              </button>
            </div>
          ) : (
            <>
              {aiError && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
                  提示：{aiError}
                </div>
              )}

              {/* 健康评分卡片 */}
              <div className="rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[3px_3px_0px_#1f1f1f] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">
                      架构健康度综合评分
                    </span>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className={`text-4xl font-mono font-black ${scoreConfig.text}`}>
                        {reviewReport.score}
                      </span>
                      <span className="text-xs font-mono font-semibold text-stone-400">
                        / 100 分
                      </span>
                    </div>
                  </div>

                  <div className="text-right space-y-1">
                    <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-bold ${scoreConfig.bg} ${scoreConfig.text} ${scoreConfig.border}`}>
                      {scoreConfig.verdict}
                    </span>
                    <div className="text-[10px] font-mono text-stone-500">
                      规则达标率: {reviewReport.passed_count}/{reviewReport.total_count}
                    </div>
                  </div>
                </div>

                {reviewReport.summary && (
                  <p className="border-t border-stone-100 pt-2.5 text-xs leading-relaxed text-stone-600 font-sans select-text">
                    {reviewReport.summary}
                  </p>
                )}
              </div>

              {/* 严重等级过滤选项卡 */}
              <div className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-1 shadow-[2px_2px_0px_#1f1f1f]">
                <button
                  type="button"
                  onClick={() => setSeverityFilter('all')}
                  className={`flex-1 rounded-lg py-1 text-center text-xs font-bold transition cursor-pointer ${
                    severityFilter === 'all'
                      ? 'border border-[#1f1f1f] bg-[#1f1f1f] text-white shadow-2xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  全部 ({counts.all})
                </button>
                <button
                  type="button"
                  onClick={() => setSeverityFilter('critical')}
                  className={`flex-1 rounded-lg py-1 text-center text-xs font-bold transition cursor-pointer ${
                    severityFilter === 'critical'
                      ? 'border border-rose-600 bg-rose-600 text-white shadow-2xs'
                      : counts.critical > 0
                        ? 'text-rose-700 hover:bg-rose-50'
                        : 'text-stone-400'
                  }`}
                >
                  严重 ({counts.critical})
                </button>
                <button
                  type="button"
                  onClick={() => setSeverityFilter('warning')}
                  className={`flex-1 rounded-lg py-1 text-center text-xs font-bold transition cursor-pointer ${
                    severityFilter === 'warning'
                      ? 'border border-amber-500 bg-amber-500 text-white shadow-2xs'
                      : counts.warning > 0
                        ? 'text-amber-800 hover:bg-amber-50'
                        : 'text-stone-400'
                  }`}
                >
                  警告 ({counts.warning})
                </button>
                <button
                  type="button"
                  onClick={() => setSeverityFilter('info')}
                  className={`flex-1 rounded-lg py-1 text-center text-xs font-bold transition cursor-pointer ${
                    severityFilter === 'info'
                      ? 'border border-blue-600 bg-blue-600 text-white shadow-2xs'
                      : counts.info > 0
                        ? 'text-blue-800 hover:bg-blue-50'
                        : 'text-stone-400'
                  }`}
                >
                  建议 ({counts.info})
                </button>
              </div>

              {/* 问题列表 */}
              {filteredIssues.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed border-stone-300 bg-white/70 py-12 px-4 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300 mb-2">
                    <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h4 className="text-xs font-bold text-stone-800">
                    {severityFilter === 'all' ? '未检出架构违规项' : `当前无「${SEVERITY_CONFIG[severityFilter].label}」级别问题`}
                  </h4>
                  <p className="mt-1 text-[11px] text-stone-500">
                    物理表结构、主外键索引配置均符合该数据库方言的生产级标准。
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredIssues.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onLocateEntity={handleLocateEntity}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function IssueCard({
  issue,
  onLocateEntity,
}: {
  issue: SchemaIssue
  onLocateEntity: (entityName: string) => void
}) {
  const conf = SEVERITY_CONFIG[issue.severity]
  const catLabel = CATEGORY_LABELS[issue.category] ?? issue.category

  return (
    <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f] space-y-2.5 transition">
      <div className="flex items-start justify-between gap-2 border-b border-stone-100 pb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`rounded border px-1.5 py-0.2 text-[10px] font-bold ${conf.badge}`}>
            {conf.label}
          </span>
          <span className="rounded border border-stone-300 bg-stone-100 px-1.5 py-0.2 text-[10px] font-mono font-semibold text-stone-700">
            {catLabel}
          </span>
          {issue.entity_name && (
            <button
              type="button"
              onClick={() => onLocateEntity(issue.entity_name!)}
              className="inline-flex items-center gap-1 rounded border border-[#1f1f1f] bg-[#fdf0ee] px-1.5 py-0.2 text-[10px] font-mono font-bold text-[#df4e3e] shadow-[1px_1px_0px_#1f1f1f] hover:bg-white transition cursor-pointer"
              title={`在画布中居中定位「${issue.entity_name}」表`}
            >
              <svg aria-hidden="true" className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span>{issue.entity_name}</span>
              {issue.column_name && <span>.{issue.column_name}</span>}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-bold text-[#1f1f1f]">
          {issue.title}
        </h4>
        <p className="text-[11.5px] leading-relaxed text-stone-600 select-text">
          {issue.description}
        </p>
      </div>

      {issue.suggestion && (
        <div className="rounded-lg border border-stone-200 bg-[#faf7f0] p-2 text-[11px] leading-relaxed text-stone-700 space-y-1 select-text">
          <div className="flex items-center gap-1 font-bold text-[#1f1f1f]">
            <svg aria-hidden="true" className="w-3 h-3 text-[#df4e3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>修复建议</span>
          </div>
          <p className="pl-4 text-stone-600 font-sans">
            {issue.suggestion}
          </p>
        </div>
      )}
    </div>
  )
}
