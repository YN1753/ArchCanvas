import { useState } from 'react'

import { useStore } from '../store/erStore'
import ModelSelector from './ModelSelector'

const EXAMPLES = [
  '做一个校园二手交易平台，用户可以发布商品、收藏商品、购买商品，商品支持多张图片',
  '为系统设计完整的 RBAC 权限体系，包含用户、角色、权限项与菜单关联',
  '添加评价与打分模块，用户可对已完成的订单进行星级评价与文字晒单',
  '商品增加分类与标签，一个商品属于一个主分类但可拥有多个检索标签',
]

function ResultPanel() {
  const result = useStore((state) => state.aiResult)
  const aiError = useStore((state) => state.aiError)
  const dismiss = useStore((state) => state.dismissAiResult)
  const [showChanges, setShowChanges] = useState(false)

  if (aiError) {
    return (
      <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50/90 p-3 shadow-2xs">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
              <span>⚠️</span>
              <span>生成失败</span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed break-all text-rose-600 font-mono">
              {aiError}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded p-1 text-[11px] text-rose-500 hover:bg-rose-100 hover:text-rose-700 transition"
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  if (!result) {
    return null
  }

  const changes = result.changes ?? []
  const problems = result.review?.problems ?? []
  const questions = result.requirement?.questions ?? []

  return (
    <div className="mb-2 max-h-[36vh] space-y-2 overflow-y-auto no-scrollbar rounded-xl border border-slate-200/90 bg-white/95 p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                result.applied
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-100 text-amber-800 border border-amber-200'
              }`}
            >
              {result.applied ? '✓ 已同步持久化落库' : '未落库'}
            </span>
            {result.requirement?.summary ? (
              <span className="truncate text-xs font-semibold text-slate-700">
                {result.requirement.summary}
              </span>
            ) : null}
          </div>

          {result.note ? (
            <p className="text-[11px] text-amber-800 bg-amber-50/60 p-2 rounded-lg border border-amber-100">
              {result.note}
            </p>
          ) : null}

          {result.requirement?.assumptions?.length ? (
            <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
              <p className="text-[10px] font-bold text-slate-500">AI 推导的架构假设：</p>
              <ul className="mt-1 space-y-0.5">
                {result.requirement.assumptions.map((assumption) => (
                  <li key={assumption} className="text-[11px] text-slate-600">
                    · {assumption}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {questions.length > 0 ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 p-2.5">
              <p className="text-[10px] font-bold text-indigo-800">业务细节确认项：</p>
              <ul className="mt-1 space-y-0.5">
                {questions.map((question) => (
                  <li key={question} className="text-[11px] text-indigo-700">
                    ? {question}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {problems.length > 0 ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50/80 p-2.5">
              <p className="text-[10px] font-bold text-rose-800">审查发现的问题：</p>
              <ul className="mt-1 space-y-0.5">
                {problems.map((problem) => (
                  <li key={problem} className="text-[11px] leading-relaxed text-rose-700">
                    · {problem}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {changes.length > 0 ? (
            <div>
              <button
                type="button"
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition"
                onClick={() => setShowChanges((value) => !value)}
              >
                {showChanges ? '▼ 收起' : '▶ 展开'}结构变更明细（{changes.length} 项）
              </button>
              {showChanges ? (
                <ul className="mt-1.5 max-h-36 space-y-1 overflow-y-auto no-scrollbar rounded-lg border border-slate-200 bg-slate-50/70 p-2 font-mono text-[10px] text-slate-700">
                  {changes.map((change, index) => (
                    <li key={`${index}-${change}`} className="ident">
                      {change}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded p-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function ThinkingStreamPanel() {
  const aiRunning = useStore((state) => state.aiRunning)
  const aiThinking = useStore((state) => state.aiThinking)
  const aiStatus = useStore((state) => state.aiStatus)

  if (!aiRunning && !aiThinking) {
    return null
  }

  return (
    <div className="mb-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs shadow-2xs backdrop-blur-xs">
      <div className="flex items-center justify-between text-indigo-800">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex h-2.5 w-2.5 items-center justify-center">
            <span className="absolute h-2.5 w-2.5 rounded-full bg-indigo-400 opacity-75 animate-ping" />
            <span className="relative h-2 w-2 rounded-full bg-indigo-600" />
          </span>
          <span>{aiStatus || (aiRunning ? 'AI 正在推导数据模型…' : 'AI 思考推理完毕')}</span>
        </div>
        {aiRunning && (
          <span className="text-[10px] text-indigo-500 font-mono animate-pulse">Streaming</span>
        )}
      </div>

      {aiThinking ? (
        <div className="mt-2 max-h-40 overflow-y-auto no-scrollbar whitespace-pre-wrap rounded-lg bg-white/90 p-2.5 font-mono text-[11px] leading-relaxed text-slate-700 shadow-inner border border-indigo-50">
          {aiThinking}
          {aiRunning && (
            <span className="inline-block h-3.5 w-1.5 animate-pulse bg-indigo-600 ml-1 align-middle" />
          )}
        </div>
      ) : null}
    </div>
  )
}

export default function AiPanel() {
  const runAI = useStore((state) => state.runAI)
  const aiRunning = useStore((state) => state.aiRunning)
  const hasProject = useStore((state) => state.project !== null)
  const [input, setInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  async function submit() {
    const text = input.trim()
    if (!text || aiRunning) {
      return
    }
    await runAI(text)
    setInput('')
  }

  // 最小化折叠状态：悬浮胶囊
  if (collapsed) {
    return (
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-slate-200/90 bg-white/95 px-4 py-2 text-xs font-semibold text-slate-700 shadow-xl backdrop-blur-md transition hover:border-indigo-400 hover:text-indigo-600 hover:shadow-2xl"
        >
          <span className="flex h-2 w-2 rounded-full bg-indigo-600 animate-pulse" />
          <span>✨ AI 智能建模助手</span>
          {aiRunning && (
            <span className="rounded bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.2">
              思考生成中…
            </span>
          )}
          <span className="text-slate-400 text-[11px] ml-1">展开 ↗</span>
        </button>
      </div>
    )
  }

  // 展开状态：现代化悬浮卡片
  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-[min(760px,94%)]">
      <div className="pointer-events-auto rounded-2xl border border-slate-200/90 bg-white/95 p-3.5 shadow-2xl backdrop-blur-md transition-all duration-200">
        <ThinkingStreamPanel />
        <ResultPanel />

        {/* 顶部助手工具条 */}
        <div className="mb-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
              <span className="text-indigo-600">✨</span>
              <span>AI 智能建模助手</span>
            </span>

            <span className="text-slate-300">|</span>

            <ModelSelector compact />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="rounded-md p-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              title="最小化收起 AI 面板"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* 需求输入区 */}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            rows={2}
            disabled={!hasProject || aiRunning}
            placeholder="描述业务需求，如：做一个校园二手交易平台，用户可发布/收藏/购买商品，支持多张图片与分类…"
            className="flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs leading-relaxed outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 shadow-2xs"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submit()
              }
            }}
          />

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!hasProject || aiRunning || input.trim().length === 0}
            className="h-[54px] shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 px-5 text-xs font-bold text-white transition hover:from-indigo-500 hover:to-indigo-600 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 shadow-sm flex items-center gap-1.5"
          >
            {aiRunning ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>生成中…</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>生成 / 修改</span>
              </>
            )}
          </button>
        </div>

        {/* 快捷示例建议 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-400 font-medium">试试：</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={aiRunning}
              onClick={() => setInput(example)}
              className="max-w-[280px] truncate rounded-full border border-slate-200 bg-slate-50/80 px-2.5 py-0.5 text-[10px] text-slate-600 transition hover:border-indigo-400 hover:bg-white hover:text-indigo-600 disabled:opacity-50"
            >
              {example}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-slate-400 font-mono">⌘/Ctrl + Enter 提交</span>
        </div>
      </div>
    </div>
  )
}
