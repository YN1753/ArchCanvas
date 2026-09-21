import { useMemo, useState } from 'react'

import { toMermaid } from '../export/mermaid'
import { designToSQL } from '../export/sql'
import { useStore } from '../store/erStore'
import { parseDesignJSON, validateDesign } from '../validate/dsl'

type Tab = 'export-sql' | 'export-json' | 'export-mermaid' | 'import'

const buttonClass =
  'rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 shadow-2xs'

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function DataDialog({ onClose }: { onClose: () => void }) {
  const design = useStore((state) => state.design)
  const project = useStore((state) => state.project)
  const importDesign = useStore((state) => state.importDesign)

  const [tab, setTab] = useState<Tab>('export-sql')
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const jsonText = useMemo(() => JSON.stringify(design, null, 2), [design])
  const sqlText = useMemo(() => designToSQL(design), [design])
  const mermaidText = useMemo(() => toMermaid(design), [design])

  const activeText =
    tab === 'export-sql' ? sqlText : tab === 'export-mermaid' ? mermaidText : jsonText

  const activeFilename = `${project?.name ?? 'archcanvas'}.${
    tab === 'export-sql' ? 'sql' : tab === 'export-mermaid' ? 'mmd' : 'json'
  }`

  async function copy() {
    try {
      await navigator.clipboard.writeText(activeText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  function submitImport() {
    try {
      const parsed = parseDesignJSON(importText)
      const report = validateDesign(parsed)
      if (report.errors.length > 0) {
        setImportError(`校验未通过：${report.errors.slice(0, 3).join('；')}`)
        return
      }
      importDesign(parsed)
      onClose()
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  const tabs: Array<{ key: Tab; label: string; icon: string }> = [
    { key: 'export-sql', label: '导出 SQL DDL', icon: '🗄️' },
    { key: 'export-json', label: '导出 JSON', icon: '📦' },
    { key: 'export-mermaid', label: '导出 Mermaid', icon: '📐' },
    { key: 'import', label: '导入 JSON', icon: '📥' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(660px,90vh)] w-[min(900px,92vw)] flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header Tabs */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5">
          <div className="flex items-center gap-6">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setTab(item.key)
                  setImportError(null)
                }}
                className={`flex items-center gap-1.5 border-b-2 py-3.5 text-xs font-semibold transition ${
                  tab === item.key
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
          >
            ✕
          </button>
        </div>

        {/* Content Area */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
          {tab === 'import' ? (
            <>
              <p className="text-xs text-slate-500">
                粘贴 ER 设计规范 JSON（可直接粘贴「导出 JSON」的内容）。导入将应用至画布并自动持久化保存到服务端。
              </p>
              <textarea
                value={importText}
                spellCheck={false}
                placeholder='{"entities": [], "relations": []}'
                className="ident min-h-0 flex-1 resize-none rounded-xl border border-slate-300 p-3.5 text-xs leading-relaxed outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-mono"
                onChange={(event) => {
                  setImportText(event.target.value)
                  setImportError(null)
                }}
              />
              {importError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 font-mono">
                  {importError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2.5 pt-2">
                <button type="button" className={buttonClass} onClick={onClose}>
                  取消
                </button>
                <button
                  type="button"
                  disabled={importText.trim().length === 0}
                  onClick={submitImport}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 shadow-sm"
                >
                  解析并载入
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                {tab === 'export-sql'
                  ? '生成的 MySQL / MariaDB 标准建表语句，可直接在 Navicat、DBeaver 或终端执行。'
                  : tab === 'export-mermaid'
                    ? 'Mermaid erDiagram 源码，可直接贴入 Markdown、Notion 或 GitHub 评审。'
                    : '标准的 ER DSL JSON 结构规范，用于版本备份或在其他 ArchCanvas 实例中导入。'}
              </p>
              <textarea
                readOnly
                value={activeText}
                spellCheck={false}
                className="ident min-h-0 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs leading-relaxed outline-none font-mono text-slate-800"
              />
              <div className="flex justify-end gap-2.5 pt-2">
                <button type="button" className={buttonClass} onClick={() => void copy()}>
                  {copied ? '✓ 已复制' : '复制内容'}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => download(activeFilename, activeText)}
                >
                  下载 {tab === 'export-sql' ? '.sql' : tab === 'export-mermaid' ? '.mmd' : '.json'} 文件
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
