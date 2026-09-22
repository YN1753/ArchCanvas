import { useState } from 'react'
import type { ClarificationCard } from '../api/client'

interface ClarificationDeckProps {
  cards: ClarificationCard[]
  questions?: string[]
  onConfirm: (decisionPrompt: string) => void
  onDismiss: () => void
  loading?: boolean
}

/**
 * MiMo Desktop 风格的渐进式澄清选项卡组件。
 * 特点：
 * 1. 逐题展示（1 / N 分页），选完当前题自动切入下一题；
 * 2. 纵向带数字编号与副标题说明的卡片列表；
 * 3. 底部固定支持「✎ 或自定义输入...」；
 * 4. 支持 < 和 > 前后自由翻页，右上角快捷关闭。
 */
export default function ClarificationDeck({
  cards,
  onConfirm,
  onDismiss,
  loading = false,
}: ClarificationDeckProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isCollapsed, setIsCollapsed] = useState(false)

  // 记录每个 cardId 选中的 optionId。如果是自定义，optionId 为 '__custom__'
  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const card of cards) {
      const defOpt = card.options.find((opt) => opt.is_default) ?? card.options[0]
      if (defOpt) {
        init[card.id] = defOpt.id
      }
    }
    return init
  })

  // 记录每个 cardId 自定义填写的文本
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({})

  if (!cards || cards.length === 0) {
    return null
  }

  const currentCard = cards[currentIndex] || cards[0]
  const currentSelectedId = selections[currentCard.id]
  const isLastQuestion = currentIndex === cards.length - 1

  // 折叠微条形态（防误触与无遮挡浏览画布）
  if (isCollapsed) {
    return (
      <div
        onClick={() => setIsCollapsed(false)}
        className="group mb-2.5 flex items-center justify-between rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white px-4 py-2.5 shadow-[3px_3px_0px_#1f1f1f] hover:bg-[#faf7f0] cursor-pointer transition-all animate-in fade-in select-none"
        title="点击展开架构决策选项卡"
      >
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#1f1f1f] text-[9px] font-bold bg-[#df4e3e] text-white">
            ?
          </span>
          <span className="font-bold text-[#1f1f1f] shrink-0">
            待确认架构决策
          </span>
          <span className="text-[11px] font-mono text-stone-500 tabular-nums shrink-0">
            (第 {currentIndex + 1}/{cards.length} 题)
          </span>
          <span className="text-stone-300 shrink-0">·</span>
          <span className="truncate max-w-[280px] text-stone-700 font-medium">
            {currentCard.title}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className="inline-flex items-center gap-1 rounded-lg border border-[#1f1f1f] bg-[#faf7f0] px-2 py-0.5 text-[11px] font-bold text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f] group-hover:bg-white transition">
            <span>展开卡片</span>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </span>
        </div>
      </div>
    )
  }

  // 组装最终答案并提交
  const doSubmit = (overrideSelections?: Record<string, string>, overrideCustom?: Record<string, string>) => {
    const activeSelections = overrideSelections ?? selections
    const activeCustom = overrideCustom ?? customTexts

    const decisionList: string[] = []
    cards.forEach((card, idx) => {
      const selectedId = activeSelections[card.id]
      if (selectedId === '__custom__') {
        const text = (activeCustom[card.id] || '').trim() || '按个性化自定义处理'
        decisionList.push(`${idx + 1}. 【${card.title}】：用户指定要求：${text}`)
      } else {
        const opt = card.options.find((o) => o.id === selectedId)
        const label = opt ? opt.label : '采用通用标准'
        decisionList.push(`${idx + 1}. 【${card.title}】：${label}`)
      }
    })

    const fullPrompt = `已确认业务架构决策如下，请基于这些明确决策生成物理数据模型设计：\n${decisionList.join('\n')}`
    onConfirm(fullPrompt)
  }

  // 点击某个选项：记录选择，并自动翻到下一题（如果是最后一题则提交）
  const handleSelectOption = (optionId: string) => {
    const nextSelections = { ...selections, [currentCard.id]: optionId }
    setSelections(nextSelections)

    if (!isLastQuestion) {
      setTimeout(() => {
        setCurrentIndex((prev) => Math.min(cards.length - 1, prev + 1))
      }, 150)
    } else {
      doSubmit(nextSelections)
    }
  }

  // 点击“跳过”或“下一题”
  const handleNextOrSkip = () => {
    if (!isLastQuestion) {
      setCurrentIndex((prev) => Math.min(cards.length - 1, prev + 1))
    } else {
      doSubmit()
    }
  }

  // 处理自定义文本输入回车
  const handleCustomKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const text = customTexts[currentCard.id]?.trim()
      if (text) {
        const nextSelections = { ...selections, [currentCard.id]: '__custom__' }
        setSelections(nextSelections)
        if (!isLastQuestion) {
          setCurrentIndex((prev) => Math.min(cards.length - 1, prev + 1))
        } else {
          doSubmit(nextSelections)
        }
      } else {
        handleNextOrSkip()
      }
    }
  }

  return (
    <div className="mb-2.5 rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[4px_4px_0px_#1f1f1f] transition-all duration-200 animate-in fade-in select-none">
      {/* 顶部标题与翻页导航 (完全对照 MiMo 布局) */}
      <div className="flex items-center justify-between pb-2.5">
        <div className="flex items-center gap-1.5 text-xs text-stone-600 font-medium">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-[#1f1f1f] text-[9px] font-bold bg-[#df4e3e] text-white">
            ?
          </span>
          <span className="font-bold text-[#1f1f1f]">
            第 {currentIndex + 1} 题（单选）
          </span>
          <span className="text-stone-300">·</span>
          <span className="truncate max-w-[340px] text-stone-700 font-medium">
            {currentCard.title}
          </span>
        </div>

        {/* 翻页组件与关闭按钮 */}
        <div className="flex items-center gap-2 text-xs text-stone-400">
          <div className="flex items-center gap-1.5 font-mono">
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
              className="p-0.5 rounded hover:text-[#1f1f1f] hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
              title="上一题"
            >
              〈
            </button>
            <span className="text-[11px] tabular-nums text-stone-600 font-sans font-semibold">
              {currentIndex + 1} / {cards.length}
            </span>
            <button
              type="button"
              disabled={isLastQuestion}
              onClick={() => setCurrentIndex((prev) => Math.min(cards.length - 1, prev + 1))}
              className="p-0.5 rounded hover:text-[#1f1f1f] hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
              title="下一题"
            >
              〉
            </button>
          </div>

          {/* 收起折叠按钮 (安全操作，保留全部选择与输入) */}
          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="flex items-center gap-1 rounded-lg border border-stone-300 bg-stone-50 px-2 py-0.5 text-[11px] font-semibold text-stone-700 hover:border-[#1f1f1f] hover:text-[#1f1f1f] hover:bg-white active:translate-x-0.5 active:translate-y-0.5 transition"
            title="收起卡片（随时可展开，保留当前选择与输入）"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            <span>收起</span>
          </button>

          {/* 放弃本次决策 (带防误触确认) */}
          {onDismiss && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('确定放弃本次架构决策吗？已勾选的选项将被清空。')) {
                  onDismiss()
                }
              }}
              className="p-1 rounded text-stone-400 hover:bg-red-50 hover:text-[#df4e3e] transition"
              title="放弃本次决策"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 题目说明 / 描述 */}
      <div className="mb-2.5 text-xs text-stone-700 leading-relaxed">
        {currentCard.description || '这次业务设计的架构形态是哪一种？请确认以下核心设定：'}
      </div>

      {/* 纵向选项列表 (MiMo 编号风格) */}
      <div className="space-y-1.5 border-t border-stone-200 pt-2.5">
        {currentCard.options.map((opt, optIdx) => {
          const isSelected = currentSelectedId === opt.id

          return (
            <div
              key={opt.id}
              onClick={() => handleSelectOption(opt.id)}
              className={`group flex items-start gap-3 py-2 px-2.5 rounded-xl cursor-pointer transition-all ${
                isSelected
                  ? 'bg-[#fdf0ee] border-[1.5px] border-[#1f1f1f] shadow-[2px_2px_0px_#1f1f1f]'
                  : 'hover:bg-stone-50 border-[1.5px] border-transparent'
              }`}
            >
              {/* 数字序号徽章 */}
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-mono font-bold transition-colors ${
                  isSelected
                    ? 'bg-[#df4e3e] text-white border border-[#1f1f1f]'
                    : 'bg-stone-100 text-stone-600 border border-stone-300 group-hover:bg-stone-200'
                }`}
              >
                {optIdx + 1}
              </span>

              {/* 选项主标题与副标题说明 */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <span
                    className={`font-semibold ${
                      isSelected ? 'text-[#df4e3e]' : 'text-[#1f1f1f]'
                    }`}
                  >
                    {opt.label}
                  </span>
                  {opt.is_default && (
                    <span className="text-[10px] text-[#df4e3e] font-semibold bg-[#fdf0ee] border border-[#df4e3e]/30 px-1.5 py-0.2 rounded">
                      (Recommended)
                    </span>
                  )}
                </div>

                {opt.description && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 line-clamp-2">
                    {opt.description}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部自定义输入条与「跳过/完成」按钮 (完全对照 MiMo 布局) */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-200 pt-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-0 px-1">
          {/* 铅笔小图标 */}
          <span className="text-stone-400 text-xs">✎</span>
          <input
            type="text"
            value={customTexts[currentCard.id] || ''}
            onChange={(e) => {
              const text = e.target.value
              setCustomTexts((prev) => ({ ...prev, [currentCard.id]: text }))
              if (text.trim()) {
                setSelections((prev) => ({ ...prev, [currentCard.id]: '__custom__' }))
              }
            }}
            onKeyDown={handleCustomKeyDown}
            placeholder="或自定义输入..."
            className="w-full text-xs text-[#1f1f1f] placeholder-stone-400 bg-transparent outline-none font-normal"
          />
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={handleNextOrSkip}
          className="shrink-0 rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-1 text-xs font-bold text-[#1f1f1f] shadow-[2px_2px_0px_#1f1f1f] hover:bg-stone-100 active:translate-x-[1px] active:translate-y-[1px] transition"
        >
          {isLastQuestion ? '完成' : '跳过'}
        </button>
      </div>
    </div>
  )
}
