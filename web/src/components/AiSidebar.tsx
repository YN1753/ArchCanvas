import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectMessage } from '../api/client'
import { useStore } from '../store/erStore'
import type { DatabaseDialect } from '../types/dsl'
import ClarificationDeck from './ClarificationDeck'
import ModelSelector from './ModelSelector'

interface AssistantPayload {
  summary?: string
  thinking?: string
  status?: string
  need_clarification?: boolean
  clarification_cards?: any[]
  questions?: string[]
  applied_entities_count?: number
  applied_relations_count?: number
  applied_entities?: string[]
  conceptual_design?: any
  review_report?: any
  error?: string
}

function parseAssistantContent(raw: string): AssistantPayload {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  } catch {
    // raw plain text fallback
  }
  return { summary: raw }
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function cleanThinking(text: string): string {
  return text
    .replace(/^#+\s*/gm, '') // remove ## markdown headers
    .replace(/\*\*(.*?)\*\*/g, '$1') // remove ** bolding
    .trim()
}

function ThinkingBlock({
  thinking,
  defaultOpen = false,
  isStreaming = false,
}: {
  thinking: string
  defaultOpen?: boolean
  isStreaming?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!thinking) return null

  const cleaned = cleanThinking(thinking)
  if (!cleaned) return null

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-sans text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition select-none"
      >
        <svg
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

function UserBubble({ msg }: { msg: ProjectMessage }) {
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
}

function AssistantCard({ msg }: { msg: ProjectMessage }) {
  const payload = parseAssistantContent(msg.content)
  const focusEntity = useStore((state) => state.focusEntity)
  const design = useStore((state) => state.design)

  const entityNames = useMemo(() => {
    if (payload.applied_entities && payload.applied_entities.length > 0) {
      return payload.applied_entities
    }
    // 降级兜底：从当前画布实体名称中提取并在 summary 中匹配
    if (payload.applied_entities_count && payload.applied_entities_count > 0 && payload.summary) {
      const summaryLower = payload.summary.toLowerCase()
      return design.entities
        .filter((e) => summaryLower.includes(e.name.toLowerCase()))
        .map((e) => e.name)
    }
    return []
  }, [payload.applied_entities, payload.applied_entities_count, payload.summary, design.entities])

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
          {payload.status === 'error' ? (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
              异常
            </span>
          ) : payload.need_clarification ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
              需要澄清
            </span>
          ) : payload.status === 'concept_ready' || payload.conceptual_design ? (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
              概念已推导
            </span>
          ) : payload.status === 'review_ready' || payload.review_report ? (
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800">
              架构体检报告
            </span>
          ) : (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
              物理架构已生成
            </span>
          )}
        </div>

        {/* 思考过程折叠条 */}
        {payload.thinking && <ThinkingBlock thinking={payload.thinking} />}

        {/* 核心业务总结 */}
        {payload.summary && (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#1f1f1f] font-sans font-medium select-text">
            {payload.summary}
          </p>
        )}

        {/* 架构体检报告摘要卡片 */}
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
                useStore.getState().setReviewReport(payload.review_report)
                useStore.getState().setReviewDrawerOpen(true)
              }}
              className="rounded-lg border border-[#1f1f1f] bg-white px-2.5 py-1 text-[11px] font-bold text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f] hover:bg-[#faf7f0] active:translate-x-0.5 active:translate-y-0.5 transition cursor-pointer"
            >
              查看体检报告
            </button>
          </div>
        )}

        {/* 概念模型提示 */}
        {payload.conceptual_design?.concepts && payload.conceptual_design.concepts.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1">
            <svg className="w-3.5 h-3.5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span>
              已提炼 {payload.conceptual_design.concepts.length} 个核心概念与 {payload.conceptual_design.relations?.length ?? 0} 组业务关联
            </span>
          </div>
        )}

        {/* 错误提示 */}
        {payload.error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-600">
            {payload.error}
          </div>
        )}

        {/* 落盘状态徽章与实体一键定位胶囊 */}
        {payload.applied_entities_count !== undefined && payload.applied_entities_count > 0 && (
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50/70 border border-emerald-200 rounded-lg px-2.5 py-1">
              <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>
                已将数据模型同步至画布（实体表: {payload.applied_entities_count}，关系: {payload.applied_relations_count ?? 0}）
              </span>
            </div>

            {entityNames.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5 pl-0.5">
                <span className="text-[10px] text-stone-400 font-mono select-none">
                  点击定位:
                </span>
                {entityNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => focusEntity(name)}
                    className="group/tag inline-flex items-center gap-1 rounded-md border border-[#1f1f1f] bg-[#faf7f0] px-2 py-0.5 text-[11px] font-mono font-bold text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f] hover:bg-white hover:text-[#df4e3e] hover:border-[#df4e3e] hover:shadow-[1.5px_1.5px_0px_#df4e3e] active:translate-x-0.5 active:translate-y-0.5 transition cursor-pointer"
                    title={`在画布中居中定位并查看「${name}」表`}
                  >
                    <svg className="w-3 h-3 text-stone-400 group-hover/tag:text-[#df4e3e] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
}

function DerivePhysicalCard() {
  const conceptualDesign = useStore((state) => state.conceptualDesign)
  const agentPhase = useStore((state) => state.agentPhase)
  const targetDialect = useStore((state) => state.targetDialect)
  const setTargetDialect = useStore((state) => state.setTargetDialect)
  const derivePhysical = useStore((state) => state.derivePhysical)
  const reviewSchema = useStore((state) => state.reviewSchema)
  const setCanvasViewMode = useStore((state) => state.setCanvasViewMode)
  const aiRunning = useStore((state) => state.aiRunning)

  const conceptsCount = conceptualDesign?.concepts?.length ?? 0
  const relationsCount = conceptualDesign?.relations?.length ?? 0

  if (conceptsCount === 0) return null

  const dialects: Array<{ id: DatabaseDialect; label: string }> = [
    { id: 'mysql', label: 'MySQL 8.0' },
    { id: 'postgres', label: 'PostgreSQL' },
    { id: 'sqlite', label: 'SQLite' },
  ]

  const isPhysicalReady = agentPhase === 'physical_ready'
  const isDeriving = agentPhase === 'deriving_physical'

  return (
    <div className="w-full rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f] space-y-3">
      <div className="flex items-center justify-between border-b border-stone-100 pb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-[#df4e3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1.5 3 3.5 3s3.5-1 3.5-3V7c0-2-1.5-3-3.5-3S4 5 4 7zm0 5c0 2 1.5 3 3.5 3s3.5-1 3.5-3m-7-5c0 2 1.5 3 3.5 3s3.5-1 3.5-3m10 0v10c0 2 1.5 3 3.5 3s3.5-1 3.5-3V7c0-2-1.5-3-3.5-3s-3.5 1-3.5 3zm0 5c0 2 1.5 3 3.5 3s3.5-1 3.5-3m-7-5c0 2 1.5 3 3.5 3s3.5-1 3.5-3" />
          </svg>
          <span className="text-xs font-bold text-[#1f1f1f]">
            {isPhysicalReady ? '物理模型与索引就绪' : '概念模型就绪 · 物理推导'}
          </span>
        </div>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            isPhysicalReady
              ? 'bg-emerald-100 text-emerald-800'
              : isDeriving
              ? 'bg-amber-100 text-amber-800 animate-pulse'
              : 'bg-sky-100 text-sky-800'
          }`}
        >
          {isPhysicalReady ? '已生成物理表' : isDeriving ? '正在推导中' : '待推导物理表'}
        </span>
      </div>

      <p className="text-[11.5px] leading-relaxed text-stone-600">
        {isPhysicalReady
          ? `已成功生成生产级数据表结构（含 M:N 中间表解耦、审计字段与智能索引配置）。`
          : `已提炼 ${conceptsCount} 个业务概念、${relationsCount} 组关联关系。选择目标数据库方言后，可一键推导物理建表规范与索引。`}
      </p>

      {/* 方言选择器 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-stone-400">
            目标数据库方言
          </span>
          <span className="text-[10px] text-stone-400 font-mono">
            {targetDialect.toUpperCase()}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {dialects.map((d) => {
            const active = targetDialect === d.id
            return (
              <button
                key={d.id}
                type="button"
                disabled={aiRunning}
                onClick={() => setTargetDialect(d.id)}
                className={`py-1.5 px-2 text-[11px] font-mono font-bold rounded-lg border-[1.5px] transition text-center cursor-pointer ${
                  active
                    ? 'border-[#1f1f1f] bg-[#1f1f1f] text-white shadow-[1px_1px_0px_#1f1f1f]'
                    : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-400 hover:bg-white'
                }`}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 操作按钮区 */}
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
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <span>{isPhysicalReady ? '重新推导物理表与索引' : '推导物理表与索引'}</span>
            </>
          )}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCanvasViewMode('chen')}
            className="flex-1 py-1.5 px-2.5 rounded-lg border border-stone-300 bg-white text-[11px] font-bold text-stone-700 hover:border-[#1f1f1f] hover:bg-stone-50 transition flex items-center justify-center gap-1 cursor-pointer"
          >
            <svg className="w-3 h-3 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            <span>陈氏白板审阅</span>
          </button>

          {isPhysicalReady && (
            <button
              type="button"
              disabled={aiRunning}
              onClick={() => void reviewSchema(targetDialect)}
              className="flex-1 py-1.5 px-2.5 rounded-lg border border-[#1f1f1f] bg-stone-900 text-[11px] font-bold text-white hover:bg-stone-800 transition flex items-center justify-center gap-1 cursor-pointer shadow-[1px_1px_0px_#1f1f1f]"
            >
              <svg className="w-3 h-3 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>架构质量体检</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AiSidebar() {
  const project = useStore((state) => state.project)
  const messages = useStore((state) => state.messages)
  const messagesLoading = useStore((state) => state.messagesLoading)
  const aiSidebarOpen = useStore((state) => state.aiSidebarOpen)
  const setAiSidebarOpen = useStore((state) => state.setAiSidebarOpen)
  const clearProjectMessages = useStore((state) => state.clearProjectMessages)

  const aiRunning = useStore((state) => state.aiRunning)
  const aiThinking = useStore((state) => state.aiThinking)
  const aiStatus = useStore((state) => state.aiStatus)
  const aiError = useStore((state) => state.aiError)
  const aiResult = useStore((state) => state.aiResult)
  const proposeConcepts = useStore((state) => state.proposeConcepts)
  const dismissAiResult = useStore((state) => state.dismissAiResult)

  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const scrollRafRef = useRef<number | null>(null)

  const hasProject = Boolean(project)

  const scrollToBottom = (smooth = true) => {
    if (!scrollContainerRef.current) return
    scrollContainerRef.current.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    })
  }

  const handleScroll = () => {
    if (!scrollContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    const isNear = scrollHeight - scrollTop - clientHeight < 80
    isNearBottomRef.current = isNear
    setShowScrollBottom(!isNear && (aiRunning || messages.length > 2))
  }

  // 自动平滑滚动到底部（仅在用户处于底部附近时吸附，防抖动）
  useEffect(() => {
    if (!isNearBottomRef.current) return

    if (scrollRafRef.current) {
      window.cancelAnimationFrame(scrollRafRef.current)
    }

    scrollRafRef.current = window.requestAnimationFrame(() => {
      // 流式输出 chunk 时使用 instant 滚动，避免平滑滚动动画频繁排队导致页面抖动
      scrollToBottom(!aiRunning)
    })

    return () => {
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current)
      }
    }
  }, [messages, aiRunning, aiThinking, aiResult])

  // 输入框自适应高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }, [input])

  const submit = async () => {
    const text = input.trim()
    if (!text || !hasProject || aiRunning) return
    setInput('')
    isNearBottomRef.current = true
    setShowScrollBottom(false)
    scrollToBottom(true)
    await proposeConcepts(text)
  }

  const clarificationCards = aiResult?.requirement?.clarification_cards ?? []
  const hasClarificationDeck = Boolean(
    aiResult && aiResult.requirement && clarificationCards.length > 0
  )

  const quickPrompts = [
    '设计一个在线教育选课与成绩系统',
    '设计电商秒杀库存与订单履约流程',
    '设计企业多租户 RBAC 权限与部门架构',
  ]

  return (
    <aside
      className={`transition-all duration-200 ease-in-out flex flex-col border-r-[1.5px] border-[#1f1f1f] bg-[#faf7f0] select-none shadow-sm z-20 shrink-0 overflow-hidden ${
        aiSidebarOpen ? 'w-[360px] opacity-100' : 'w-0 opacity-0 border-r-0 pointer-events-none'
      }`}
    >
      <div className="w-[360px] flex h-full flex-col">
        {/* 1. 顶栏：标题、消息计数、清空与收起按键 */}
        <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-2.5 shadow-[0px_2px_0px_#1f1f1f]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-2 w-2 rounded-full bg-[#df4e3e] shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#1f1f1f] whitespace-nowrap">
              AI 架构师
            </span>
            {messages.length > 0 && (
              <span className="rounded-full bg-stone-100 px-1.5 py-0.2 text-[10px] font-mono text-stone-500 shrink-0">
                {messages.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* 清空对话历史 */}
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => void clearProjectMessages()}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition"
                title="清空当前项目的对话历史"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}

            {/* 收起侧栏 */}
            <button
              type="button"
              onClick={() => setAiSidebarOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 hover:text-[#1f1f1f] hover:bg-stone-100 transition"
              title="收起 AI 侧栏 (⌘L)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* 2. 消息流区域 */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-3.5 space-y-4 no-scrollbar"
          >
            {messagesLoading && messages.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-xs text-stone-400 font-medium">
                加载历史记录中…
              </div>
            ) : messages.length === 0 && !aiRunning ? (
              <div className="flex flex-col items-center justify-center min-h-full px-2 text-center space-y-4 my-auto py-6">
                <DerivePhysicalCard />

                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white shadow-[2px_2px_0px_#1f1f1f]">
                  <svg className="w-6 h-6 text-[#df4e3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-stone-800">随时与 AI 结对架构</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                    用自然语言描述业务场景，AI 会先构建高阶业务概念模型（Chen's ER），再一键推导物理数据表与索引规范。
                  </p>
                </div>

                <div className="w-full space-y-2 pt-2">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-stone-400">
                    快速尝试
                  </span>
                  {quickPrompts.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setInput(p)
                        textareaRef.current?.focus()
                      }}
                      className="w-full text-left rounded-xl border border-stone-200 bg-white p-2.5 text-xs text-stone-700 hover:border-[#1f1f1f] hover:shadow-[2px_2px_0px_#1f1f1f] transition"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m) =>
                  m.role === 'user' ? <UserBubble key={m.id} msg={m} /> : <AssistantCard key={m.id} msg={m} />
                )}
                <DerivePhysicalCard />
              </>
            )}

            {/* 实时推理状态卡片 (当 AI 正在运行且尚未落库完成时展示) */}
            {aiRunning && (
              <div className="rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f] space-y-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#df4e3e] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#df4e3e]" />
                  </span>
                  <span className="text-xs font-bold text-stone-800">
                    {aiStatus || 'AI 架构师正在分析需求并落盘设计…'}
                  </span>
                </div>

                {aiThinking && <ThinkingBlock thinking={aiThinking} defaultOpen={false} isStreaming={true} />}

                {aiError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-600 font-medium flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>{aiError}</span>
                  </div>
                )}
              </div>
            )}

            {/* 交互式需求编排确认卡片 (需要用户决策时) */}
            {hasClarificationDeck && aiResult?.requirement && (
              <div className="pt-1">
                <ClarificationDeck
                  cards={clarificationCards}
                  questions={aiResult.requirement.questions}
                  loading={aiRunning}
                  onDismiss={dismissAiResult}
                  onConfirm={async (decisionPrompt) => {
                    dismissAiResult()
                    await proposeConcepts(decisionPrompt)
                  }}
                />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 向上回看时浮现的快速吸底按钮 */}
          {showScrollBottom && (
            <button
              type="button"
              onClick={() => {
                isNearBottomRef.current = true
                scrollToBottom(true)
                setShowScrollBottom(false)
              }}
              className="absolute bottom-3 right-4 z-20 flex items-center gap-1.5 rounded-full border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1 text-[11px] font-bold text-stone-700 shadow-[2px_2px_0px_#1f1f1f] hover:bg-[#faf7f0] hover:text-[#df4e3e] active:translate-x-0.5 active:translate-y-0.5 transition select-none animate-in fade-in slide-in-from-bottom-2 duration-150 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-[#df4e3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span>回到最新</span>
              {aiRunning && (
                <span className="h-1.5 w-1.5 rounded-full bg-[#df4e3e] animate-ping" />
              )}
            </button>
          )}
        </div>

        {/* 3. 底部固定指令输入区 */}
        <div className="border-t-[1.5px] border-[#1f1f1f] bg-white p-3 shadow-[0px_-2px_0px_#1f1f1f]">
          <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] p-2.5 shadow-[2px_2px_0px_#1f1f1f] focus-within:border-[#df4e3e] transition">
            <textarea
              id="ai-sidebar-textarea"
              ref={textareaRef}
              value={input}
              rows={2}
              disabled={!hasProject || aiRunning}
              placeholder="描述您的需求或增量修改，Enter 发送…"
              className="w-full resize-none bg-transparent px-1 text-xs leading-relaxed text-[#1f1f1f] placeholder-stone-400 outline-none max-h-28 font-sans font-medium"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submit()
                }
              }}
            />

            <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-stone-200/60">
              <span className="text-[10px] text-stone-400 font-mono select-none pl-1">
                Shift + Enter 换行
              </span>

              <div className="flex items-center gap-1.5">
                <ModelSelector compact />

                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!hasProject || aiRunning || input.trim().length === 0}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] text-white shadow-[1px_1px_0px_#1f1f1f] hover:bg-[#c84031] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-0.5 active:translate-y-0.5 transition shrink-0"
                  title="发送需求 (Enter)"
                >
                  {aiRunning ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
