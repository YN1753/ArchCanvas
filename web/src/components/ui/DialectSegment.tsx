import { listDialects } from '../../dialects'
import type { DatabaseDialect } from '../../types/dsl'

export type DialectSegmentVariant = 'segmented' | 'compact' | 'block' | 'subtle' | 'cards'

export interface DialectSegmentProps {
  value: DatabaseDialect
  onChange: (dialect: DatabaseDialect) => void
  disabled?: boolean
  variant?: DialectSegmentVariant
  ariaLabel?: string
}

export default function DialectSegment({
  value,
  onChange,
  disabled = false,
  variant = 'segmented',
  ariaLabel = '数据库方言选择',
}: DialectSegmentProps) {
  const dialects = listDialects()

  if (variant === 'cards') {
    return (
      <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-3 gap-3">
        {dialects.map((item) => {
          const selected = value === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(item.id)}
              className={`flex flex-col items-start rounded-xl border-[1.5px] p-3 text-left transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                selected
                  ? 'border-[#1f1f1f] bg-white shadow-[2px_2px_0px_#1f1f1f] ring-2 ring-[#df4e3e]/20'
                  : 'border-stone-300 bg-white/70 hover:bg-white'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className={`font-bold text-xs ${selected ? 'text-[#df4e3e]' : 'text-stone-800'}`}>
                  {item.label}
                </span>
                {selected && <span className="text-xs text-[#df4e3e] font-bold">✓</span>}
              </div>
              <span className="mt-1 text-[11px] text-stone-400">{item.driverDescription}</span>
            </button>
          )
        })}
      </div>
    )
  }

  if (variant === 'block') {
    return (
      <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-3 gap-1.5">
        {dialects.map((d) => {
          const active = value === d.id
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(d.id)}
              className={`py-1.5 px-2 text-[11px] font-mono font-bold rounded-lg border-[1.5px] transition text-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                active
                  ? 'border-[#1f1f1f] bg-[#1f1f1f] text-white shadow-[1px_1px_0px_#1f1f1f]'
                  : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-400 hover:bg-white'
              }`}
            >
              {d.versionLabel}
            </button>
          )
        })}
      </div>
    )
  }

  if (variant === 'subtle') {
    return (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="flex items-center rounded-lg border border-stone-300 bg-white p-0.5 shadow-2xs"
      >
        {dialects.map((d) => {
          const active = value === d.id
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(d.id)}
              className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                active
                  ? 'border border-[#1f1f1f] bg-[#1f1f1f] text-white shadow-2xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {d.versionLabel}
            </button>
          )
        })}
      </div>
    )
  }

  if (variant === 'compact') {
    return (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-[10px] font-bold shadow-2xs"
      >
        {dialects.map((d) => {
          const active = value === d.id
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(d.id)}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                active
                  ? 'bg-[#df4e3e] text-white'
                  : 'text-stone-600 hover:text-[#1f1f1f]'
              }`}
            >
              {d.shortLabel}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex items-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-white p-0.5 shadow-2xs shrink-0"
    >
      {dialects.map((d) => {
        const active = value === d.id
        return (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(d.id)}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? 'bg-[#df4e3e] text-white shadow-2xs'
                : 'text-stone-700 hover:text-[#df4e3e]'
            }`}
          >
            {d.label}
          </button>
        )
      })}
    </div>
  )
}
