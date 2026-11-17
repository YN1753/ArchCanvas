import { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface SelectOption<T = string> {
  value: T
  label: string
  sublabel?: string
  badge?: string
  disabled?: boolean
}

export interface SelectProps<T = string> {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  className?: string
  dropdownClassName?: string
  size?: 'sm' | 'md'
  title?: string
  searchable?: boolean
  placement?: 'bottom' | 'top'
}

export default function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = '请选择...',
  disabled = false,
  className = '',
  dropdownClassName = '',
  size = 'md',
  title,
  searchable,
  placement = 'bottom',
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const enableSearch = searchable ?? options.length > 8

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value],
  )

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options
    const query = search.toLowerCase().trim()
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(query)) ||
        (opt.badge && opt.badge.toLowerCase().includes(query)),
    )
  }, [options, search])

  useEffect(() => {
    if (!open) return

    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }

    window.addEventListener('mousedown', handleOutsideClick)
    return () => window.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  useEffect(() => {
    if (open) {
      const idx = filteredOptions.findIndex((opt) => opt.value === value && !opt.disabled)
      setActiveIndex(idx >= 0 ? idx : filteredOptions.findIndex((opt) => !opt.disabled))
      if (enableSearch) {
        const timer = window.setTimeout(() => {
          searchInputRef.current?.focus()
        }, 40)
        return () => window.clearTimeout(timer)
      }
    }
  }, [open, enableSearch, filteredOptions, value])

  const moveHighlight = (delta: 1 | -1) => {
    if (filteredOptions.length === 0) return
    let idx = activeIndex
    for (let step = 0; step < filteredOptions.length; step++) {
      idx = (idx + delta + filteredOptions.length) % filteredOptions.length
      if (!filteredOptions[idx]?.disabled) {
        setActiveIndex(idx)
        return
      }
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return

    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        setSearch('')
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
      } else {
        moveHighlight(1)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
      } else {
        moveHighlight(-1)
      }
      return
    }

    if (event.key === 'Enter' && open) {
      event.preventDefault()
      const picked = filteredOptions[activeIndex]
      if (picked && !picked.disabled) {
        onChange(picked.value)
        setOpen(false)
        setSearch('')
      }
    }
  }

  const isSmall = size === 'sm'

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      title={title}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (open && containerRef.current && !containerRef.current.contains(event.relatedTarget as Node | null)) {
          setOpen(false)
          setSearch('')
        }
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          if (!disabled) {
            setOpen((prev) => !prev)
            if (open) setSearch('')
          }
        }}
        className={`w-full flex items-center justify-between gap-1.5 rounded border-[1.5px] bg-white transition select-none outline-none focus-visible:ring-2 focus-visible:ring-[#df4e3e]/30 shadow-[1px_1px_0px_#1f1f1f] ${
          isSmall ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
        } ${
          open
            ? 'border-[#1f1f1f] ring-2 ring-[#df4e3e]/20 text-[#1f1f1f]'
            : 'border-[#1f1f1f] text-[#1f1f1f] hover:bg-stone-50'
        } ${disabled ? 'cursor-not-allowed opacity-50 bg-stone-100' : 'cursor-pointer'}`}
      >
        <span className="truncate text-left flex-1">
          {selectedOption ? (
            <span className="flex items-center gap-1.5 truncate">
              <span className="truncate font-medium">{selectedOption.label}</span>
              {selectedOption.badge && (
                <span className="rounded bg-[#fdf0ee] border border-[#df4e3e]/30 px-1 py-0.2 text-[9px] font-bold text-[#df4e3e] shrink-0">
                  {selectedOption.badge}
                </span>
              )}
            </span>
          ) : (
            <span className="text-stone-400">{placeholder}</span>
          )}
        </span>

        <svg
          aria-hidden="true"
          className={`shrink-0 w-3 h-3 text-stone-400 transition-transform duration-150 ${
            open ? 'rotate-180 text-[#df4e3e]' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute left-0 z-50 min-w-full overflow-hidden rounded-lg border-[1.5px] border-[#1f1f1f] bg-white shadow-[3px_3px_0px_#1f1f1f] ${
            placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
          } ${dropdownClassName}`}
        >
          {enableSearch && (
            <div className="border-b border-stone-200 p-1.5 bg-[#faf7f0]">
              <input
                ref={searchInputRef}
                type="text"
                aria-label="搜索下拉选项"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索选项..."
                className="w-full rounded border-[1.5px] border-[#1f1f1f] bg-white px-2 py-1 text-xs outline-none focus:border-[#df4e3e] focus:ring-1 focus:ring-[#df4e3e]/20"
              />
            </div>
          )}

          <div
            id={listboxId}
            role="listbox"
            className="max-h-80 overflow-y-auto no-scrollbar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden p-1 space-y-0.5"
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-stone-400">
                未找到匹配项
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.value === value
                const isHighlighted = idx === activeIndex
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    onMouseEnter={() => {
                      if (!opt.disabled) setActiveIndex(idx)
                    }}
                    onClick={() => {
                      if (!opt.disabled) {
                        onChange(opt.value)
                        setOpen(false)
                        setSearch('')
                      }
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left transition select-none text-xs ${
                      opt.disabled
                        ? 'cursor-not-allowed opacity-40 text-stone-400'
                        : isSelected
                          ? 'bg-[#fdf0ee] font-bold text-[#df4e3e] cursor-pointer'
                          : isHighlighted
                            ? 'bg-stone-100 text-[#1f1f1f] cursor-pointer'
                            : 'text-[#1f1f1f] hover:bg-stone-100 cursor-pointer'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{opt.label}</span>
                        {opt.badge && (
                          <span className="rounded bg-[#fdf0ee] border border-[#df4e3e]/30 px-1 py-0.2 text-[9px] font-bold text-[#df4e3e] shrink-0">
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      {opt.sublabel && (
                        <div className="text-[10px] text-stone-400 truncate mt-0.5">
                          {opt.sublabel}
                        </div>
                      )}
                    </div>

                    {isSelected && (
                      <svg
                        aria-hidden="true"
                        className="w-3.5 h-3.5 text-[#df4e3e] shrink-0"
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
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
