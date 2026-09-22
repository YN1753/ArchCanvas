import { useEffect } from 'react'

import { useStore } from '../store/erStore'

export default function Toast() {
  const toast = useStore((state) => state.toast)
  const dismiss = useStore((state) => state.dismissToast)

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = window.setTimeout(dismiss, 4200)
    return () => window.clearTimeout(timer)
  }, [toast, dismiss])

  if (!toast) {
    return null
  }

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2">
      <div
        className={`pointer-events-auto flex max-w-[560px] items-start gap-3 rounded-lg border-[1.5px] border-[#1f1f1f] px-4 py-2.5 shadow-[4px_4px_0px_#1f1f1f] ${
          toast.kind === 'error' ? 'bg-[#df4e3e] text-white' : 'bg-[#1f1f1f] text-white'
        }`}
      >
        <span className="text-xs leading-relaxed">{toast.text}</span>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-xs opacity-70 transition hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
