import { memo, useMemo, useState } from 'react'

import type { ClarificationCard, ProjectMessage } from '../../api/client'
import { useStore } from '../../store/erStore'
import type { ConceptualDesign, SchemaReviewReport } from '../../types/dsl'

interface AssistantPayload {
  summary?: string
  thinking?: string
  status?: string
  need_clarification?: boolean
  clarification_cards?: ClarificationCard[]
  questions?: string[]
  applied_entities_count?: number
  applied_relations_count?: number
  applied_entities?: string[]
  conceptual_design?: ConceptualDesign
  review_report?: SchemaReviewReport
  error?: string
}

function parseAssistantContent(raw: string): AssistantPayload {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') {
      return parsed as AssistantPayload
    }
  } catch {
    // plain text fallback
  }
  return { summary: raw }
}

function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function ThinkingBlock({
  thinking,
  defaultOpen = false,
  isStreaming = false,
}: {
  thinking: string
  defaultOpen?: boolean
  isStreaming?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const cleaned = thinking
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .trim()
  if (!cleaned) return null

  return (
    <div className="py-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-sans text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition select-none cursor-pointer"
      >
        <svg
          aria-hidden="true"
          className={`w-3 h-3 text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">
          {isStreaming ? (open ? '收起思考细节' : '思考中…') : open ? '收起思考过程' : '思考过程'}
        </span>
      </button>

      {open && (
        <div className="mt-1 border-l-2 border-stone-200 pl-3 py-1 font-sans text-[11.5px] leading-relaxed text-stone-500 italic select-text max-h-48 overflow-y-auto no-scrollbar whitespace-pre-wrap">
          {cleaned}
        </div>
      )}
    </div>
  )
}

export const UserBubble = memo(function UserBubble({ msg }: { msg: ProjectMessage }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[88%] rounded-2xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-3.5 py-2.5 text-white shadow-[2px_2px_0px_#1f1f1f]">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed font-sans font-medium select-text">
          {msg.content}
        </p>
      </div>
      <span className="text-[10px] text-stone-400 font-mono pr-1">{formatTime(msg.created_at)}</span>
    </div>
  )
})

export const AssistantCard = memo(function AssistantCard({ msg }: { msg: ProjectMessage }) {
  const payload = useMemo(() => parseAssistantContent(msg.content), [msg.content])
  const focusEntity = useStore((state) => state.focusEntity)
  const needsFallbackLookup =
    (!payload.applied_entities || payload.applied_entities.length === 0) &&
    Boolean(payload.applied_entities_count && payload.applied_entities_count > 0 && payload.summary)

  const fallbackEntityNamesKey = useStore((state) =>
    needsFallbackLookup ? state.design.entities.map((e) => e.name).join('\u0001') : '',
  )

  const entityNames = useMemo(() => {
    if (payload.applied_entities && payload.applied_entities.length > 0) {
      return payload.applied_entities
    }
    if (needsFallbackLookup && payload.summary && fallbackEntityNamesKey) {
      const summaryLower = payload.summary.toLowerCase()
      return fallbackEntityNamesKey
        .split('\u0001')
        .filter((name) => name && summaryLower.includes(name.toLowerCase()))
    }
    return []
  }, [payload.applied_entities, payload.summary, needsFallbackLookup, fallbackEntityNamesKey])

  const statusBadge =
    payload.status === 'error'
      ? { cls: 'bg-red-100 text-red-700', text: '异常' }
      : payload.need_clarification
        ? { cls: 'bg-amber-100 text-amber-800', text: '需要澄清' }
        : payload.status === 'concept_ready' || payload.conceptual_design
          ? { cls: 'bg-sky-100 text-sky-800', text: '概念已推导' }
          : payload.status === 'review_ready' || payload.review_report
            ? { cls: 'bg-indigo-100 text-indigo-800', text: '架构体检报告' }
            : { cls: 'bg-emerald-100 text-emerald-800', text: '物理架构已生成' }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="w-full rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f] space-y-2.5">
        <div className="flex items-center justify-between border-b border-stone-100 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-[#df4e3e] text-white text-[11px] font-bold">
              AI
            </span>
            <span className="text-xs font-bold text-[#1f1f1f]">AI 架构师</span>
          </div>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusBadge.cls}`}>
            {statusBadge.text}
          </span>
        </div>

        {payload.thinking && <ThinkingBlock thinking={payload.thinking} />}

        {payload.summary && (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#1f1f1f] font-sans font-medium select-text">
            {payload.summary}
          </p>
        )}

        {payload.review_report && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-2.5">
            <div className="flex items-center gap-2">
              <span
                className={`text-base font-black font-mono ${
                  (payload.review_report.score ?? 0) >= 80
                    ? 'text-emerald-700'
                    : (payload.review_report.score ?? 0) >= 60
                      ? 'text-amber-700'
                      : 'text-rose-700'
                }`}
              >
                {payload.review_report.score ?? 0} 分
              </span>
              <span className="text-[11px] text-indigo-900 font-medium">
                检查项: {payload.review_report.total_count ?? 0}，风险: {payload.review_report.issues?.length ?? 0} 项
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                useStore.getState().setReviewReport(payload.review_report ?? null)
                useStore.getState().setReviewDrawerOpen(true)
              }}
              className="rounded-lg border border-[#1f1f1f] bg-white px-2.5 py-1 text-[11px] font-bold text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f] hover:bg-[#faf7f0] active:translate-x-0.5 active:translate-y-0.5 transition cursor-pointer"
            >
              查看体检报告
            </button>
          </div>
        )}

        {payload.conceptual_design?.concepts && payload.conceptual_design.concepts.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1">
            <svg aria-hidden="true" className="w-3.5 h-3.5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span>
              已提炼 {payload.conceptual_design.concepts.length} 个核心概念与 {payload.conceptual_design.relations?.length ?? 0} 组业务关联
            </span>
          </div>
        )}

        {payload.error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-600">
            {payload.error}
          </div>
        )}

        {payload.applied_entities_count !== undefined && payload.applied_entities_count > 0 && (
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50/70 border border-emerald-200 rounded-lg px-2.5 py-1">
              <svg aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>
                已将数据模型同步至画布（实体表: {payload.applied_entities_count}，关系: {payload.applied_relations_count ?? 0}）
              </span>
            </div>

            {entityNames.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5 pl-0.5">
                <span className="text-[10px] text-stone-400 font-mono select-none">点击定位:</span>
                {entityNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => focusEntity(name)}
                    className="group/tag inline-flex items-center gap-1 rounded-md border border-[#1f1f1f] bg-[#faf7f0] px-2 py-0.5 text-[11px] font-mono font-bold text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f] hover:bg-white hover:text-[#df4e3e] hover:border-[#df4e3e] hover:shadow-[1.5px_1.5px_0px_#df4e3e] active:translate-x-0.5 active:translate-y-0.5 transition cursor-pointer"
                    title={`在画布中居中定位并查看「${name}」表`}
                  >
                    <svg aria-hidden="true" className="w-3 h-3 text-stone-400 group-hover/tag:text-[#df4e3e] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>{name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <span className="text-[10px] text-stone-400 font-mono pl-1">{formatTime(msg.created_at)}</span>
    </div>
  )
})
