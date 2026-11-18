import { useEffect, useRef, type RefObject } from 'react'

export interface UseDismissibleLayerOptions {
  closeOnEscape?: boolean
  closeOnOutsidePointer?: boolean
  additionalRefs?: ReadonlyArray<RefObject<HTMLElement | null>>
  shouldIgnoreOutsideTarget?: (target: Node) => boolean
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
  const additionalRefsRef = useRef(options?.additionalRefs)
  additionalRefsRef.current = options?.additionalRefs
  const ignoreOutsideRef = useRef(options?.shouldIgnoreOutsideTarget)
  ignoreOutsideRef.current = options?.shouldIgnoreOutsideTarget

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!closeOnOutsidePointer) return
      const target = event.target as Node | null
      if (!target) return
      if (containerRef.current?.contains(target)) return
      if (additionalRefsRef.current?.some((ref) => ref.current?.contains(target))) return
      if (ignoreOutsideRef.current?.(target)) return
      onDismissRef.current()
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
