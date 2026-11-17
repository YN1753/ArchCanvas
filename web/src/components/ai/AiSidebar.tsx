import { useEffect, useRef, useState } from 'react'

import { useStore } from '../../store/erStore'
import MessageList from './MessageList'
import PromptComposer from './PromptComposer'

const RE_DERIVE_COMMAND_RE =
  /^(重新推导|重新生成|重新弄|重新推导物理表|重新推导物理模型|重新推导模型|重新生成物理表|再推导一次|重新推导一下|重新来|重新来过)$/i

export default function AiSidebar() {
  const project = useStore((state) => state.project)
  const messageCount = useStore((state) => state.messages.length)
  const aiSidebarOpen = useStore((state) => state.aiSidebarOpen)
  const setAiSidebarOpen = useStore((state) => state.setAiSidebarOpen)
  const clearProjectMessages = useStore((state) => state.clearProjectMessages)
  const aiRunning = useStore((state) => state.aiRunning)
  const proposeConcepts = useStore((state) => state.proposeConcepts)
  const setAgentPhase = useStore((state) => state.setAgentPhase)
  const conceptualCount = useStore((state) => state.conceptualDesign?.concepts?.length ?? 0)

  const [input, setInput] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollTriggerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setConfirmingClear(false)
  }, [project?.id])

  const submit = async () => {
    const text = input.trim()
    if (!text || !project || aiRunning) return

    const normalized = text.replace(/[\s，。！!,.?？]+/g, '')
    if (RE_DERIVE_COMMAND_RE.test(normalized) && conceptualCount > 0) {
      setInput('')
      setAgentPhase('concept_ready')
      return
    }

    setInput('')
    scrollTriggerRef.current?.()
    await proposeConcepts(text)
  }

  return (
    <aside
      aria-label="AI 架构师侧边栏"
      className={`transition-all duration-200 ease-in-out flex flex-col border-r-[1.5px] border-[#1f1f1f] bg-[#faf7f0] select-none z-30 shrink-0 overflow-hidden ${
        aiSidebarOpen
          ? 'fixed inset-y-0 left-0 w-[360px] max-w-[92vw] lg:static opacity-100 shadow-[4px_0_16px_rgba(0,0,0,0.08)] lg:shadow-sm'
          : 'w-0 opacity-0 border-r-0 pointer-events-none'
      }`}
    >
      <div className="w-[360px] max-w-[92vw] flex h-full flex-col">
        <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-2.5 shadow-[0px_2px_0px_#1f1f1f]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-2 w-2 rounded-full bg-[#df4e3e] shrink-0" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#1f1f1f] whitespace-nowrap">
              AI 架构师
            </h2>
            {messageCount > 0 && (
              <span className="rounded-full bg-stone-100 px-1.5 py-0.2 text-[10px] font-mono text-stone-500 shrink-0">
                {messageCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {messageCount > 0 &&
              (confirmingClear ? (
                <div className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[11px]">
                  <span className="font-semibold text-rose-700">确认清空?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    className="rounded px-1.5 py-0.2 font-semibold text-stone-600 hover:bg-white transition cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingClear(false)
                      void clearProjectMessages()
                    }}
                    className="rounded bg-[#df4e3e] px-1.5 py-0.2 font-bold text-white hover:bg-[#c84031] transition cursor-pointer"
                  >
                    清空
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label="清空当前项目的对话历史"
                  onClick={() => setConfirmingClear(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition cursor-pointer"
                  title="清空当前项目的对话历史"
                >
                  <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              ))}

            <button
              type="button"
              aria-label="收起 AI 侧栏"
              onClick={() => setAiSidebarOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 hover:text-[#1f1f1f] hover:bg-stone-100 transition cursor-pointer"
              title="收起 AI 侧栏 (⌘L)"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        <MessageList
          scrollTriggerRef={scrollTriggerRef}
          onSelectQuickPrompt={(p) => {
            setInput(p)
            textareaRef.current?.focus()
          }}
        />

        <PromptComposer
          input={input}
          setInput={setInput}
          textareaRef={textareaRef}
          onSubmitPrompt={submit}
        />
      </div>
    </aside>
  )
}
