import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 剪贴板复制短暂成功反馈 Hook（自动在组件卸载或重复复制时清理定时器）。
 */
export function useCopyFeedback(durationMs = 1500): {
  copied: boolean
  triggerCopied: () => void
  copyText: (text: string) => Promise<boolean>
} {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const triggerCopied = useCallback(() => {
    clearTimer()
    setCopied(true)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setCopied(false)
    }, durationMs)
  }, [clearTimer, durationMs])

  const copyText = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text)
        triggerCopied()
        return true
      } catch {
        clearTimer()
        setCopied(false)
        return false
      }
    },
    [clearTimer, triggerCopied],
  )

  return { copied, triggerCopied, copyText }
}
