import { useEffect, type RefObject } from 'react'

import { useStore } from '../../store/erStore'
import { isImeComposing } from '../../utils/keyboard'
import ModelSelector from '../ModelSelector'

export default function PromptComposer({
  input,
  setInput,
  textareaRef,
  onSubmitPrompt,
}: {
  input: string
  setInput: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onSubmitPrompt: () => Promise<void>
}) {
  const hasProject = useStore((state) => Boolean(state.project))
  const aiRunning = useStore((state) => state.aiRunning)
  const stopAI = useStore((state) => state.stopAI)
  const showcase = useStore((state) => state.showcase)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }, [input, textareaRef])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmitPrompt()
      }}
      className="border-t-[1.5px] border-[#1f1f1f] bg-white p-3 shadow-[0px_-2px_0px_#1f1f1f]"
    >
      {showcase?.enabled ? (
        <div className="mb-2 flex items-center justify-between rounded-lg border border-stone-200 bg-[#faf7f0] px-2.5 py-1 text-[10px] font-medium text-stone-600">
          <span>演示沙盒（草稿隔离 · {showcase.visitor_ttl_hours ?? 24}h 自动清扫）</span>
          <span
            className={`font-mono font-bold ${
              (showcase.ip_remaining ?? 20) <= 0
                ? 'text-rose-600'
                : (showcase.ip_remaining ?? 20) <= 5
                  ? 'text-amber-700'
                  : 'text-emerald-700'
            }`}
          >
            今日剩余 AI {showcase.ip_remaining ?? 20}/{showcase.ip_daily_limit ?? 20} 次
          </span>
        </div>
      ) : null}

      <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] p-2.5 shadow-[2px_2px_0px_#1f1f1f] focus-within:border-[#df4e3e] transition">
        <label htmlFor="ai-sidebar-textarea" className="sr-only">
          向 AI 架构师描述您的业务需求或增量修改
        </label>
        <textarea
          id="ai-sidebar-textarea"
          name="prompt"
          ref={textareaRef}
          value={input}
          rows={2}
          disabled={!hasProject || aiRunning}
          placeholder="描述您的需求或增量修改，Enter 发送…"
          className="w-full resize-none bg-transparent px-1 text-xs leading-relaxed text-[#1f1f1f] placeholder-stone-400 outline-none max-h-28 font-sans font-medium"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              if (isImeComposing(e)) {
                if (!e.nativeEvent.isComposing) {
                  e.preventDefault()
                }
                return
              }
              e.preventDefault()
              void onSubmitPrompt()
            }
          }}
        />

        <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-stone-200/60">
          <span className="text-[10px] text-stone-400 font-mono select-none pl-1">
            Shift + Enter 换行
          </span>

          <div className="flex items-center gap-1.5">
            <ModelSelector />

            {aiRunning ? (
              <button
                type="button"
                aria-label="停止生成"
                onClick={() => stopAI()}
                className="flex h-7 w-7 items-center justify-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-[#1f1f1f] text-white shadow-[1px_1px_0px_#df4e3e] hover:bg-[#df4e3e] active:translate-x-0.5 active:translate-y-0.5 transition shrink-0 cursor-pointer"
                title="停止生成"
              >
                <span className="h-2.5 w-2.5 rounded-[2px] bg-white" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="发送需求"
                disabled={!hasProject || input.trim().length === 0}
                className="flex h-7 w-7 items-center justify-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] text-white shadow-[1px_1px_0px_#1f1f1f] hover:bg-[#c84031] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-0.5 active:translate-y-0.5 transition shrink-0 cursor-pointer"
                title="发送需求 (Enter)"
              >
                <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
