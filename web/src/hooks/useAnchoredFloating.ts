import {
  useCallback,
  useId,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'

export interface UseAnchoredFloatingOptions {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  preferredPlacement?: 'bottom' | 'top'
  align?: 'start' | 'end'
  /**
   * 浮层宽度策略：
   * - `'match'`: 精确等于触发器宽度（受视口边距约束）
   * - `'min-match'`: 最小宽度等于触发器宽度
   * - `number`: 固定期望宽度（若超过视口可用宽度则自动夹紧）
   */
  widthMode?: 'match' | 'min-match' | number
  /** 用于空间不足时自动上下翻转判断的预估高度（px） */
  estimatedHeight?: number
  /** 触发器与浮层间距（px） */
  offset?: number
  /** 与视口边缘保持的最小安全距离（px） */
  viewportGutter?: number
}

export interface AnchoredFloatingState {
  floatingId: string
  portalTarget: HTMLElement | null
  placement: 'bottom' | 'top'
  floatingStyle: CSSProperties | null
  floatingAttrs: {
    'data-floating-id': string
    'data-floating-parent'?: string
  }
  isInsideFloatingTree: (target: Node | null) => boolean
}

function escapeAttrValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

/**
 * 判断 DOM 节点是否归属指定浮层 ID 或其任意嵌套子浮层（例如 ModelSelector 内的 Select 列表）。
 */
export function isNodeInFloatingSubtree(
  target: Node | null,
  rootFloatingId: string,
): boolean {
  if (!target || typeof document === 'undefined') return false
  const element = target instanceof Element ? target : target.parentElement
  let cursor = element?.closest<HTMLElement>('[data-floating-id]') ?? null

  const visited = new Set<string>()
  while (cursor) {
    const id = cursor.dataset.floatingId
    if (!id || visited.has(id)) break
    if (id === rootFloatingId) return true
    visited.add(id)
    const parentId = cursor.dataset.floatingParent
    cursor = parentId
      ? document.querySelector<HTMLElement>(`[data-floating-id="${escapeAttrValue(parentId)}"]`)
      : null
  }
  return false
}

/**
 * 统一浮层 Portal 定位引擎：
 * - 自动避开父容器 `overflow-hidden` / `overflow-x-auto` / `overflow-y-auto` 裁切；
 * - 若触发器位于原生 `<dialog>` Top Layer 内，则挂载至该 `<dialog>` 内部以免被 ::backdrop 遮挡；
 * - 根据视口剩余空间自动上下翻转（`bottom` ⇄ `top`），夹紧水平位置与最大高度，防止越出视口边缘。
 */
export function useAnchoredFloating({
  open,
  anchorRef,
  preferredPlacement = 'bottom',
  align = 'start',
  widthMode = 'min-match',
  estimatedHeight = 260,
  offset = 4,
  viewportGutter = 8,
}: UseAnchoredFloatingOptions): AnchoredFloatingState {
  const floatingId = useId()
  const [layout, setLayout] = useState<{
    portalTarget: HTMLElement | null
    parentFloatingId?: string
    placement: 'bottom' | 'top'
    style: CSSProperties
  } | null>(null)

  const syncLayout = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor || typeof window === 'undefined' || typeof document === 'undefined') return

    const rect = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    const availBelow = Math.max(80, vh - rect.bottom - offset - viewportGutter)
    const availAbove = Math.max(80, rect.top - offset - viewportGutter)

    let placement: 'bottom' | 'top' = preferredPlacement
    if (preferredPlacement === 'bottom') {
      if (availBelow < estimatedHeight && availAbove > availBelow + 24) {
        placement = 'top'
      }
    } else if (availAbove < estimatedHeight && availBelow > availAbove + 24) {
      placement = 'bottom'
    }

    const maxAllowedWidth = Math.max(120, vw - viewportGutter * 2)
    let resolvedWidth = rect.width
    const widthStyles: CSSProperties = {}
    if (widthMode === 'match') {
      resolvedWidth = Math.min(rect.width, maxAllowedWidth)
      widthStyles.width = resolvedWidth
    } else if (widthMode === 'min-match') {
      resolvedWidth = Math.min(Math.max(rect.width, 160), maxAllowedWidth)
      widthStyles.minWidth = Math.min(rect.width, maxAllowedWidth)
      widthStyles.maxWidth = maxAllowedWidth
    } else {
      resolvedWidth = Math.min(widthMode, maxAllowedWidth)
      widthStyles.width = resolvedWidth
    }

    const rawLeft = align === 'end' ? rect.right - resolvedWidth : rect.left
    const maxLeft = Math.max(viewportGutter, vw - resolvedWidth - viewportGutter)
    const left = Math.min(Math.max(viewportGutter, rawLeft), maxLeft)

    const maxHeight = Math.max(120, placement === 'bottom' ? availBelow : availAbove)
    const verticalStyle: CSSProperties =
      placement === 'bottom'
        ? { top: rect.bottom + offset, maxHeight }
        : { bottom: Math.max(viewportGutter, vh - rect.top + offset), maxHeight }

    const portalTarget = anchor.closest<HTMLElement>('dialog') ?? document.body
    const parentFloatingId = anchor.closest<HTMLElement>('[data-floating-id]')?.dataset.floatingId

    setLayout({
      portalTarget,
      parentFloatingId,
      placement,
      style: {
        position: 'fixed',
        left,
        zIndex: 60,
        ...verticalStyle,
        ...widthStyles,
      },
    })
  }, [anchorRef, preferredPlacement, align, widthMode, estimatedHeight, offset, viewportGutter])

  useLayoutEffect(() => {
    if (!open) {
      setLayout(null)
      return
    }
    syncLayout()
    window.addEventListener('resize', syncLayout)
    window.addEventListener('scroll', syncLayout, true)
    return () => {
      window.removeEventListener('resize', syncLayout)
      window.removeEventListener('scroll', syncLayout, true)
    }
  }, [open, syncLayout])

  const isInsideFloatingTree = useCallback(
    (target: Node | null): boolean => {
      if (!target) return false
      if (anchorRef.current?.contains(target)) return true
      return isNodeInFloatingSubtree(target, floatingId)
    },
    [anchorRef, floatingId],
  )

  return {
    floatingId,
    portalTarget: layout?.portalTarget ?? null,
    placement: layout?.placement ?? preferredPlacement,
    floatingStyle: layout?.style ?? null,
    floatingAttrs: {
      'data-floating-id': floatingId,
      ...(layout?.parentFloatingId ? { 'data-floating-parent': layout.parentFloatingId } : {}),
    },
    isInsideFloatingTree,
  }
}
