import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { useDismissibleLayer } from '../hooks/useDismissibleLayer'
import { useListboxNavigation } from '../hooks/useListboxNavigation'

interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  suggestions: readonly string[] | string[]
  placeholder?: string
  className?: string
  inputClassName?: string
}

export default function Combobox({
  value,
  onChange,
  suggestions,
  placeholder,
  className = '',
  inputClassName = '',
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const listboxId = useId()
  const containerRef = useRef<HTMLDivElement>(null)

  const filteredSuggestions = useMemo(() => {
    const query = value.trim().toLowerCase()
    if (!query) return suggestions
    const exactHit = suggestions.some((s) => s.toLowerCase() === query)
    if (exactHit) return suggestions
    const matches = suggestions.filter((s) => s.toLowerCase().includes(query))
    return matches.length > 0 ? matches : suggestions
  }, [suggestions, value])

  const closeMenu = useCallback(() => {
    setOpen(false)
  }, [])

  useDismissibleLayer(containerRef, open, closeMenu, { closeOnEscape: false })

  const selectedIndex = useMemo(
    () => filteredSuggestions.findIndex((s) => s.toLowerCase() === value.toLowerCase()),
    [filteredSuggestions, value],
  )

  const { activeIndex, setActiveIndex, listboxRef, handleKeyDown } = useListboxNavigation({
    open,
    itemCount: filteredSuggestions.length,
    selectedIndex,
    onOpen: () => setOpen(true),
    onClose: closeMenu,
    onSelectIndex: (index) => {
      const picked = filteredSuggestions[index]
      if (picked) {
        onChange(picked)
        closeMenu()
      }
    },
  })

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onBlur={(event) => {
        if (open && containerRef.current && !containerRef.current.contains(event.relatedTarget as Node | null)) {
          closeMenu()
        }
      }}
    >
      <div className="relative flex items-center">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-label={placeholder || '数据库字段类型'}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className={`w-full pr-5 ${inputClassName}`}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="展开常用类型建议"
          onClick={() => setOpen((prev) => !prev)}
          className="absolute right-1 text-stone-400 hover:text-[#1f1f1f] p-0.5 rounded transition cursor-pointer"
        >
          <svg
            aria-hidden="true"
            className={`w-3 h-3 transition-transform ${open ? 'rotate-180 text-[#df4e3e]' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 max-h-80 w-44 overflow-y-auto no-scrollbar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-lg border-[1.5px] border-[#1f1f1f] bg-white p-1 shadow-[3px_3px_0px_#1f1f1f] animate-in fade-in duration-100"
        >
          <div className="px-2 py-1 text-[10px] font-bold text-stone-500 border-b border-stone-200 mb-0.5">
            常用数据库类型
          </div>
          {filteredSuggestions.map((suggestion, idx) => {
            const isSelected = suggestion.toLowerCase() === value.toLowerCase()
            const isHighlighted = idx === activeIndex
            return (
              <button
                key={suggestion}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault()
                }}
                onClick={() => {
                  onChange(suggestion)
                  closeMenu()
                }}
                className={`w-full flex items-center justify-between rounded px-2 py-1 text-left text-xs font-mono cursor-pointer transition ${
                  isSelected
                    ? 'bg-[#fdf0ee] font-bold text-[#df4e3e]'
                    : isHighlighted
                      ? 'bg-stone-100 text-[#1f1f1f]'
                      : 'text-[#1f1f1f] hover:bg-stone-100'
                }`}
              >
                <span>{suggestion}</span>
                {isSelected && (
                  <svg
                    aria-hidden="true"
                    className="w-3 h-3 text-[#df4e3e] shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
