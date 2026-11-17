import { useEffect, useRef, useState } from 'react'

import { useStore } from '../../store/erStore'
import ClarificationDeck from '../ClarificationDeck'
import DerivePhysicalCard from './DerivePhysicalCard'
import { AssistantCard, ThinkingBlock, UserBubble } from './MessageBubbles'

const QUICK_PROMPTS = [
  '设计一个在线教育选课与成绩系统',
  '设计电商秒杀库存与订单履约流程',
  '设计企业多租户 RBAC 权限与部门架构',
] as const

export default function MessageList({
  onSelectQuickPrompt,
  scrollTriggerRef,
}: {
  onSelectQuickPrompt: (prompt: string) => void
  scrollTriggerRef: React.MutableRefObject<(() => void) | null>
}) {
  const messages = useStore((state) => state.messages)
  const messagesLoading = useStore((state) => state.messagesLoading)
  const aiRunning = useStore((state) => state.aiRunning)
  const aiThinking = useStore((state) => state.aiThinking)
  const aiStatus = useStore((state) => state.aiStatus)
  const aiError = useStore((state) => state.aiError)
  const aiResult = useStore((state) => state.aiResult)
  const proposeConcepts = useStore((state) => state.proposeConcepts)
  const stopAI = useStore((state) => state.stopAI)
  const dismissAiResult = useStore((state) => state.dismissAiResult)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const scrollRafRef = useRef<number | null>(null)

  const scrollToBottom = (smooth = true) => {
    if (!scrollContainerRef.current) return
    scrollContainerRef.current.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    })
  }

  scrollTriggerRef.current = () => {
    isNearBottomRef.current = true
    setShowScrollBottom(false)
    scrollToBottom(true)
  }

  useEffect(() => {
    if (!isNearBottomRef.current) return
    if (scrollRafRef.current) {
      window.cancelAnimationFrame(scrollRafRef.current)
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollToBottom(!aiRunning)
    })
    return () => {
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current)
      }
    }
  }, [messages, aiRunning, aiThinking, aiResult, aiError])

  const clarificationCards = aiResult?.requirement?.clarification_cards ?? []
  const clarificationQuestions = aiResult?.requirement?.questions ?? []
  const hasClarificationDeck = Boolean(
    aiResult?.requirement?.need_clarification &&
      (clarificationCards.length > 0 || clarificationQuestions.length > 0),
  )

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={() => {
          if (!scrollContainerRef.current) return
          const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
          const isNear = scrollHeight - scrollTop - clientHeight < 80
          isNearBottomRef.current = isNear
          setShowScrollBottom(!isNear && (aiRunning || messages.length > 2))
        }}
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
              <svg aria-hidden="true" className="w-6 h-6 text-[#df4e3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
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
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onSelectQuickPrompt(p)}
                  className="w-full text-left rounded-xl border border-stone-200 bg-white p-2.5 text-xs text-stone-700 hover:border-[#1f1f1f] hover:shadow-[2px_2px_0px_#1f1f1f] transition cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} msg={m} />
              ) : (
                <AssistantCard key={m.id} msg={m} />
              ),
            )}
            <DerivePhysicalCard />
          </>
        )}

        {aiRunning && (
          <div className="rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#df4e3e] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#df4e3e]" />
                </span>
                <span className="text-xs font-bold text-stone-800 truncate">
                  {aiStatus || 'AI 架构师正在分析需求并落盘设计…'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => stopAI()}
                className="shrink-0 rounded-lg border border-stone-300 bg-stone-50 px-2 py-0.5 text-[10px] font-bold text-stone-600 hover:border-[#df4e3e] hover:bg-[#fdf0ee] hover:text-[#df4e3e] transition cursor-pointer"
              >
                停止
              </button>
            </div>
            {aiThinking && <ThinkingBlock thinking={aiThinking} defaultOpen={false} isStreaming />}
          </div>
        )}

        {aiError && (
          <div
            role="alert"
            className="rounded-2xl border-[1.5px] border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 font-medium flex items-start justify-between gap-2 shadow-[2px_2px_0px_#1f1f1f]"
          >
            <div className="flex items-start gap-2 min-w-0">
              <svg aria-hidden="true" className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="break-words select-text leading-relaxed">{aiError}</span>
            </div>
            <button
              type="button"
              aria-label="关闭错误提示"
              onClick={dismissAiResult}
              className="shrink-0 rounded p-0.5 text-rose-500 hover:bg-rose-100 hover:text-rose-800 transition cursor-pointer"
              title="关闭错误提示"
            >
              ✕
            </button>
          </div>
        )}

        {hasClarificationDeck && aiResult?.requirement && (
          <div className="pt-1">
            <ClarificationDeck
              cards={clarificationCards}
              questions={clarificationQuestions}
              loading={aiRunning}
              onDismiss={dismissAiResult}
              onConfirm={async (decisionPrompt) => {
                dismissAiResult()
                await proposeConcepts(decisionPrompt)
              }}
            />
          </div>
        )}
      </div>

      {showScrollBottom && (
        <button
          type="button"
          onClick={() => scrollTriggerRef.current?.()}
          className="absolute bottom-3 right-4 z-20 flex items-center gap-1.5 rounded-full border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1 text-[11px] font-bold text-stone-700 shadow-[2px_2px_0px_#1f1f1f] hover:bg-[#faf7f0] hover:text-[#df4e3e] active:translate-x-0.5 active:translate-y-0.5 transition select-none animate-in fade-in slide-in-from-bottom-2 duration-150 cursor-pointer"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5 text-[#df4e3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          <span>回到最新</span>
          {aiRunning && <span className="h-1.5 w-1.5 rounded-full bg-[#df4e3e] animate-ping" />}
        </button>
      )}
    </div>
  )
}
