import { useEffect, useMemo, useRef, useState } from 'react'

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
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const enableSearch = searchable ?? options.length > 8

  // 点击外部关闭
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

  // ESC 键关闭
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        setSearch('')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // 聚焦搜索输入框
  useEffect(() => {
    if (open && enableSearch) {
      const timer = window.setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
      return () => window.clearTimeout(timer)
    }
  }, [open, enableSearch])

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  )

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options
    const query = search.toLowerCase().trim()
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(query)) ||
        (opt.badge && opt.badge.toLowerCase().includes(query))
    )
  }, [options, search])

  const isSmall = size === 'sm'

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      title={title}
    >
      {/* 自定义触发器按钮 */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((prev) => !prev)
            if (open) setSearch('')
          }
        }}
        className={`w-full flex items-center justify-between gap-1.5 rounded border bg-white transition select-none outline-none ${
          isSmall ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
        } ${
          open
            ? 'border-indigo-500 ring-2 ring-indigo-100 text-slate-800'
            : 'border-slate-300 text-slate-700 hover:border-slate-400'
        } ${disabled ? 'cursor-not-allowed opacity-50 bg-slate-50' : 'cursor-pointer'}`}
      >
        <span className="truncate text-left flex-1">
          {selectedOption ? (
            <span className="flex items-center gap-1.5 truncate">
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.badge && (
                <span className="rounded bg-indigo-50 border border-indigo-100 px-1 py-0.2 text-[9px] font-semibold text-indigo-600 shrink-0">
                  {selectedOption.badge}
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </span>

        {/* 自定义指示箭头 */}
        <svg
          className={`shrink-0 w-3 h-3 text-slate-400 transition-transform duration-150 ${
            open ? 'rotate-180 text-indigo-600' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 自定义下拉菜单面板 */}
      {open && (
        <div
          className={`absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl ring-1 ring-black/5 ${dropdownClassName}`}
        >
          {/* 搜索框 */}
          {enableSearch && (
            <div className="border-b border-slate-100 p-1.5 bg-slate-50/70">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索选项..."
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
              />
            </div>
          )}

          {/* 选项清单（去除多余滚动条，保留顺畅滚动手感） */}
          <div className="max-h-80 overflow-y-auto no-scrollbar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden p-1 space-y-0.5">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-slate-400">
                未找到匹配项
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value
                return (
                  <div
                    key={String(opt.value)}
                    onClick={() => {
                      if (!opt.disabled) {
                        onChange(opt.value)
                        setOpen(false)
                        setSearch('')
                      }
                    }}
                    className={`flex items-center justify-between gap-2 rounded px-2.5 py-1.5 transition select-none text-xs ${
                      opt.disabled
                        ? 'cursor-not-allowed opacity-40 text-slate-400'
                        : isSelected
                          ? 'bg-indigo-50/80 font-semibold text-indigo-700 cursor-pointer'
                          : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 cursor-pointer'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{opt.label}</span>
                        {opt.badge && (
                          <span className="rounded bg-indigo-100/70 px-1 py-0.2 text-[9px] font-semibold text-indigo-700 shrink-0">
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      {opt.sublabel && (
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {opt.sublabel}
                        </div>
                      )}
                    </div>

                    {isSelected && (
                      <svg
                        className="w-3.5 h-3.5 text-indigo-600 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
