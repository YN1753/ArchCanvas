import { useEffect, useRef, type RefObject } from 'react'

export interface UseDismissibleLayerOptions {
  closeOnEscape?: boolean
  closeOnOutsidePointer?: boolean
}

/**
 * 弹出层外部点击（pointerdown）与 Escape 键关闭公共 Hook。
 */
export function useDismissibleLayer(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
  options?: UseDismissibleLayerOptions,
): void {
  const closeOnEscape = options?.closeOnEscape ?? true
  const closeOnOutsidePointer = options?.closeOnOutsidePointer ?? true
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!closeOnOutsidePointer) return
      const target = event.target as Node | null
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        onDismissRef.current()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!closeOnEscape) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismissRef.current()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    if (closeOnEscape) {
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      if (closeOnEscape) {
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [containerRef, open, closeOnEscape, closeOnOutsidePointer])
}
