import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { isImeComposing } from '../utils/keyboard'

export interface UseListboxNavigationOptions {
  open: boolean
  itemCount: number
  selectedIndex: number
  disabled?: boolean
  isItemDisabled?: (index: number) => boolean
  onOpen: () => void
  onClose: () => void
  onSelectIndex: (index: number) => void
}

export interface UseListboxNavigationResult {
  activeIndex: number
  setActiveIndex: (index: number) => void
  listboxRef: RefObject<HTMLDivElement | null>
  handleKeyDown: (event: ReactKeyboardEvent) => void
}

/**
 * 下拉列表（Select / Combobox）键盘上下导航、回车选中、自动滚动可视区域公共 Hook。
 */
export function useListboxNavigation({
  open,
  itemCount,
  selectedIndex,
  disabled = false,
  isItemDisabled,
  onOpen,
  onClose,
  onSelectIndex,
}: UseListboxNavigationOptions): UseListboxNavigationResult {
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxRef = useRef<HTMLDivElement>(null)
  const keyboardNavRef = useRef(false)

  const findFirstEnabled = useCallback((): number => {
    for (let i = 0; i < itemCount; i++) {
      if (!isItemDisabled?.(i)) return i
    }
    return -1
  }, [itemCount, isItemDisabled])

  useEffect(() => {
    if (!open) return
    if (selectedIndex >= 0 && selectedIndex < itemCount && !isItemDisabled?.(selectedIndex)) {
      setActiveIndex(selectedIndex)
    } else {
      setActiveIndex(findFirstEnabled())
    }
  }, [open, selectedIndex, itemCount, isItemDisabled, findFirstEnabled])

  useEffect(() => {
    if (!open || !keyboardNavRef.current || activeIndex < 0 || !listboxRef.current) return
    keyboardNavRef.current = false
    const options = listboxRef.current.querySelectorAll<HTMLElement>('[role="option"]')
    options[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  const moveHighlight = useCallback(
    (delta: 1 | -1) => {
      if (itemCount === 0) return
      let idx = activeIndex
      for (let step = 0; step < itemCount; step++) {
        idx = (idx + delta + itemCount) % itemCount
        if (!isItemDisabled?.(idx)) {
          keyboardNavRef.current = true
          setActiveIndex(idx)
          return
        }
      }
    },
    [activeIndex, itemCount, isItemDisabled],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (disabled || isImeComposing(event)) return

      if (event.key === 'Escape') {
        if (open) {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (!open) {
          onOpen()
        } else {
          moveHighlight(1)
        }
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (!open) {
          onOpen()
        } else {
          moveHighlight(-1)
        }
        return
      }

      if (event.key === 'Enter' && open) {
        event.preventDefault()
        if (activeIndex >= 0 && activeIndex < itemCount && !isItemDisabled?.(activeIndex)) {
          onSelectIndex(activeIndex)
        }
      }
    },
    [disabled, open, activeIndex, itemCount, isItemDisabled, moveHighlight, onOpen, onClose, onSelectIndex],
  )

  return {
    activeIndex,
    setActiveIndex,
    listboxRef,
    handleKeyDown,
  }
}
