import type { ReactNode } from 'react'

export const inputBase =
  'rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1.5 text-xs text-[#1f1f1f] outline-none transition focus:border-[#df4e3e] focus:ring-2 focus:ring-[#df4e3e]/20 shadow-[1px_1px_0px_#1f1f1f]'
export const inputClass = `w-full ${inputBase}`

export function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const replaced = trimmed.replace(/[^a-zA-Z0-9_]/g, '_')
  return replaced.replace(/^_+/, '').toLowerCase()
}

export function Chip({
  active,
  children,
  title,
  tone = 'slate',
  onClick,
}: {
  active: boolean
  children: ReactNode
  title: string
  tone?: 'slate' | 'amber' | 'indigo'
  onClick: () => void
}) {
  const activeClass =
    tone === 'amber'
      ? 'border-[#1f1f1f] bg-[#df4e3e] font-bold text-white shadow-[1px_1px_0px_#1f1f1f]'
      : tone === 'indigo'
        ? 'border-[#1f1f1f] bg-[#fdf0ee] font-bold text-[#df4e3e] shadow-[1px_1px_0px_#1f1f1f]'
        : 'border-[#1f1f1f] bg-stone-200 font-bold text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f]'

  const idleClass =
    'border-stone-300 bg-white text-stone-500 hover:border-[#1f1f1f] hover:text-[#1f1f1f]'

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded border-[1.5px] px-1.5 py-0.5 text-[10px] transition cursor-pointer ${
        active ? activeClass : idleClass
      }`}
    >
      {children}
    </button>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-500">
      {children}
    </h3>
  )
}
