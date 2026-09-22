import { useEffect, useRef, useState } from 'react'

import { useStore } from '../store/erStore'
import ClarificationDeck from './ClarificationDeck'
import ModelSelector from './ModelSelector'

// 思考状态微胶囊（纸感黑线风格）
function ThinkingStatusPill() {
  const aiRunning = useStore((state) => state.aiRunning)
  const aiStatus = useStore((state) => state.aiStatus)
  const aiThinking = useStore((state) => state.aiThinking)
  const [showDetails, setShowDetails] = useState(false)

  if (!aiRunning && !aiThinking) return null

  return (
    <div className="mb-2 pointer-events-auto">
      <div className="flex items-center justify-between rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white px-4 py-2.5 text-xs shadow-[2px_2px_0px_#1f1f1f] transition">
        <div className="flex items-center gap-2 text-stone-800 font-medium">
          {aiRunning ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#df4e3e] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#df4e3e]" />
            </span>
          ) : (
            <span className="text-emerald-700 font-bold text-xs">✓</span>
          )}
          <span className="text-[12px] text-stone-800 font-semibold">
            {aiStatus || (aiRunning ? '正在分析业务架构并落盘设计…' : '推理完毕')}
          </span>
        </div>

        {aiThinking && (
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="text-[11px] font-mono font-medium text-stone-500 hover:text-stone-800 transition"
          >
            {showDetails ? '收起思考' : '查看思考过程'}
          </button>
        )}
      </div>

      {showDetails && aiThinking && (
        <div className="mt-1.5 max-h-36 overflow-y-auto no-scrollbar rounded-2xl border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] p-3 font-mono text-[11px] leading-relaxed text-stone-700 shadow-inner">
          {aiThinking}
        </div>
      )}
    </div>
  )
}

// 极简结果提示条
function ResultToast() {
  const result = useStore((state) => state.aiResult)
  const aiError = useStore((state) => state.aiError)
  const dismiss = useStore((state) => state.dismissAiResult)

  if (aiError) {
    return (
      <div className="mb-2 pointer-events-auto flex items-center justify-between rounded-2xl border-[1.5px] border-[#1f1f1f] bg-red-50 px-4 py-2.5 text-xs text-[#df4e3e] shadow-[2px_2px_0px_#1f1f1f]">
        <div className="flex items-center gap-2 font-bold">
          <span>⚠️</span>
          <span>{aiError}</span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-stone-400 hover:text-stone-700 transition text-sm ml-2 font-bold"
        >
          ✕
        </button>
      </div>
    )
  }

  const summary =
    result?.execution?.summary ||
    result?.requirement?.summary ||
    (result?.applied ? '已将数据模型应用至画布' : null)

  if (!summary) return null

  return (
    <div className="mb-2 pointer-events-auto flex items-center justify-between rounded-2xl border-[1.5px] border-[#1f1f1f] bg-[#fdf0ee] px-4 py-2.5 text-xs text-[#df4e3e] shadow-[2px_2px_0px_#1f1f1f]">
      <div className="flex items-center gap-2 font-bold">
        <span>✓</span>
        <span>{summary}</span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="text-stone-400 hover:text-stone-700 transition text-sm ml-2 font-bold"
      >
        ✕
      </button>
    </div>
  )
}

export default function AiPanel() {
  const project = useStore((state) => state.project)
  const aiRunning = useStore((state) => state.aiRunning)
  const aiResult = useStore((state) => state.aiResult)
  const runAI = useStore((state) => state.runAI)
  const dismissAiResult = useStore((state) => state.dismissAiResult)

  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasProject = Boolean(project)

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
    await runAI(text)
  }

  const clarificationCards = aiResult?.requirement?.clarification_cards ?? []
  const hasClarificationDeck = Boolean(
    aiResult &&
      aiResult.requirement &&
      clarificationCards.length > 0
  )

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 mx-auto max-w-2xl px-4 select-none">
      {/* 1. 思考状态胶囊 */}
      <ThinkingStatusPill />

      {/* 2. 交互式需求编排选项卡卡组 */}
      {hasClarificationDeck && aiResult?.requirement && (
        <div className="pointer-events-auto">
          <ClarificationDeck
            cards={clarificationCards}
            questions={aiResult.requirement.questions}
            loading={aiRunning}
            onDismiss={dismissAiResult}
            onConfirm={async (decisionPrompt) => {
              dismissAiResult()
              await runAI(decisionPrompt)
            }}
          />
        </div>
      )}

      {/* 3. 结果通告 */}
      <ResultToast />

      {/* 4. 纸感黑框 Command Dock 指令坞 (1:1 复刻参考图) */}
      <div className="pointer-events-auto rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[4px_4px_0px_#1f1f1f] transition-all">
        {/* 输入区 */}
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          disabled={!hasProject || aiRunning}
          placeholder="用大白话描述业务，AI 会帮你把表和关系铺在纸上..."
          className="w-full resize-none bg-transparent px-1 pt-0.5 text-[13px] leading-relaxed text-[#1f1f1f] placeholder-stone-400 outline-none max-h-32 font-sans font-medium"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
        />

        {/* 底栏控制条 */}
        <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-stone-100">
          {/* 左侧：编排模式标记 */}
          <div className="flex items-center gap-1.5">
            <span
              className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-blue-500 bg-blue-50/80 px-2.5 py-1 text-xs font-bold text-blue-700 shadow-2xs"
              title="已启用智能需求编排模式：遇到业务分支时主动向您确认选项"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span>编排模式</span>
            </span>
          </div>

          {/* 右侧：内嵌模型选择与红色发送按钮 */}
          <div className="flex items-center gap-2">
            <ModelSelector compact />

            {/* 红色向上箭头发送按键 */}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!hasProject || aiRunning || input.trim().length === 0}
              className="flex h-8 w-8 items-center justify-center rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] text-white shadow-[2px_2px_0px_#1f1f1f] hover:bg-[#c84031] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-0.5 active:translate-y-0.5 transition"
              title="发送需求 (Enter)"
            >
              {aiRunning ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 底部热键提示 (1:1 复刻参考图) */}
      <p className="mt-2 text-center font-mono text-[11px] text-[#8c827a]">
        Enter 发送 · Shift+Enter 换行 · 双击空白新建实体 · ⌘S 保存
      </p>
    </div>
  )
}
