import { useEffect, useRef, useState } from 'react'

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
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', handleOutsideClick)
    return () => window.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          spellCheck={false}
          className={`w-full pr-5 ${inputClassName}`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((prev) => !prev)}
          className="absolute right-1 text-stone-400 hover:text-[#1f1f1f] p-0.5 rounded transition cursor-pointer"
        >
          <svg
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
        <div className="absolute right-0 top-full z-50 mt-1 max-h-80 w-44 overflow-y-auto no-scrollbar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-lg border-[1.5px] border-[#1f1f1f] bg-white p-1 shadow-[3px_3px_0px_#1f1f1f] animate-in fade-in duration-100">
          <div className="px-2 py-1 text-[10px] font-bold text-stone-500 border-b border-stone-200 mb-0.5">
            常用数据库类型
          </div>
          {suggestions.map((suggestion) => {
            const isSelected = suggestion.toLowerCase() === value.toLowerCase()
            return (
              <div
                key={suggestion}
                onClick={() => {
                  onChange(suggestion)
                  setOpen(false)
                }}
                className={`flex items-center justify-between rounded px-2 py-1 text-xs font-mono cursor-pointer transition ${
                  isSelected
                    ? 'bg-[#fdf0ee] font-bold text-[#df4e3e]'
                    : 'text-[#1f1f1f] hover:bg-stone-100'
                }`}
              >
                <span>{suggestion}</span>
                {isSelected && (
                  <svg
                    className="w-3 h-3 text-[#df4e3e] shrink-0"
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
          })}
        </div>
      )}
    </div>
  )
}
