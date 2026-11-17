import { useState } from 'react'

import { executeSchemaImport, type SchemaImporter } from '../../exchange/registry'
import type { DatabaseDialect, ERDesign } from '../../types/dsl'
import DialectSegment from '../ui/DialectSegment'

const buttonClass =
  'rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-1.5 text-xs font-bold text-[#1f1f1f] transition hover:bg-stone-100 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer'

export default function SchemaImportTab({
  importer,
  initialDialect,
  onImportSuccess,
  onCancel,
}: {
  importer: SchemaImporter
  initialDialect: DatabaseDialect
  onImportSuccess: (design: ERDesign, enrichWithAi: boolean) => void
  onCancel: () => void
}) {
  const [rawText, setRawText] = useState('')
  const [dialect, setDialect] = useState<DatabaseDialect>(initialDialect)
  const [autoEnrichSemantics, setAutoEnrichSemantics] = useState(true)
  const [importError, setImportError] = useState<string | null>(null)
  const [importWarnings, setImportWarnings] = useState<string[]>([])

  const handleSubmit = () => {
    try {
      const { design, warnings } = executeSchemaImport(importer, rawText, { dialect })
      if (warnings.length > 0) {
        setImportWarnings(warnings)
      }
      onImportSuccess(design, importer.supportsAiEnrich && autoEnrichSemantics)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-stone-600 flex-1 min-w-[240px]">{importer.description}</p>
        <div className="flex items-center gap-2 shrink-0">
          {importer.supportsDialect && importer.getSample ? (
            <DialectSegment
              value={dialect}
              onChange={setDialect}
              variant="compact"
              ariaLabel="示例脚本数据库方言"
            />
          ) : null}
          {importer.getSample ? (
            <button
              type="button"
              onClick={() => {
                setRawText(importer.getSample!(dialect))
                setImportError(null)
                setImportWarnings([])
              }}
              className="shrink-0 rounded-lg border border-[#df4e3e]/40 bg-[#fdf0ee] px-2.5 py-1 text-xs font-bold text-[#df4e3e] hover:bg-[#fbdad5] transition active:scale-95 cursor-pointer"
            >
              {importer.sampleButtonLabel || `填入示例 ${importer.label}`}
            </button>
          ) : null}
        </div>
      </div>

      <textarea
        value={rawText}
        aria-label={`${importer.label} 导入源码`}
        spellCheck={false}
        placeholder={importer.placeholder}
        className="ident min-h-0 flex-1 resize-none rounded-xl border-[1.5px] border-[#1f1f1f] p-3.5 text-xs leading-relaxed outline-none focus:border-[#df4e3e] focus:ring-2 focus:ring-[#df4e3e]/20 font-mono shadow-[2px_2px_0px_#1f1f1f]"
        onChange={(event) => {
          setRawText(event.target.value)
          setImportError(null)
          setImportWarnings([])
        }}
      />

      {importError ? (
        <p className="rounded-lg border-[1.5px] border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 font-mono">
          {importError}
        </p>
      ) : null}

      {importWarnings.length > 0 ? (
        <div className="rounded-lg border-[1.5px] border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="font-bold mb-0.5">解析提示：</div>
          <ul className="list-disc list-inside space-y-0.5">
            {importWarnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2.5 pt-2">
        {importer.supportsAiEnrich ? (
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-stone-700 font-medium">
            <input
              type="checkbox"
              checked={autoEnrichSemantics}
              onChange={(e) => setAutoEnrichSemantics(e.target.checked)}
              className="rounded border-[#1f1f1f] text-[#df4e3e] focus:ring-[#df4e3e]"
            />
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-[#df4e3e]">✨ AI 智能推导概念层语义</span>
              <span className="text-[11px] text-stone-400">
                （通过轻量 LLM 自动补全实体与字段中文业务概念）
              </span>
            </span>
          </label>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2.5">
          <button type="button" className={buttonClass} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            disabled={rawText.trim().length === 0}
            onClick={handleSubmit}
            className="rounded-lg bg-[#df4e3e] border-[1.5px] border-[#1f1f1f] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#d04232] disabled:cursor-not-allowed disabled:opacity-40 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
          >
            {importer.submitLabel}
          </button>
        </div>
      </div>
    </>
  )
}
