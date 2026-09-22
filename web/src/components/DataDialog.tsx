import { useMemo, useState } from 'react'

import { toMermaid } from '../export/mermaid'
import { designToSQL, parseSQLToDesign, SAMPLE_SQL } from '../export/sql'
import { useStore, type DataDialogTab } from '../store/erStore'
import { parseDesignJSON, validateDesign } from '../validate/dsl'

export type Tab = DataDialogTab

const buttonClass =
  'rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-1.5 text-xs font-bold text-[#1f1f1f] transition hover:bg-stone-100 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px]'

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
  const defaultTab = useStore((state) => state.dataDialogTab)

  const [tab, setTab] = useState<Tab>(defaultTab ?? 'export-sql')
  const [importJsonText, setImportJsonText] = useState('')
  const [importSqlText, setImportSqlText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importWarnings, setImportWarnings] = useState<string[]>([])
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

  function submitImportJSON() {
    try {
      const parsed = parseDesignJSON(importJsonText)
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

  function submitImportSQL() {
    try {
      const { design: parsedDesign, warnings } = parseSQLToDesign(importSqlText)
      const report = validateDesign(parsedDesign)
      if (report.errors.length > 0) {
        setImportError(`校验未通过：${report.errors.slice(0, 3).join('；')}`)
        return
      }
      if (warnings.length > 0) {
        setImportWarnings(warnings)
      }
      importDesign(parsedDesign)
      onClose()
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  const tabs: Array<{ key: Tab; label: string; icon: string }> = [
    { key: 'export-sql', label: '导出 SQL DDL', icon: '🗄️' },
    { key: 'export-json', label: '导出 JSON', icon: '📦' },
    { key: 'export-mermaid', label: '导出 Mermaid', icon: '📐' },
    { key: 'import-sql', label: '导入 SQL DDL', icon: '⚡' },
    { key: 'import-json', label: '导入 JSON', icon: '📥' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(680px,92vh)] w-[min(920px,94vw)] flex-col rounded-2xl bg-white shadow-[6px_6px_0px_#1f1f1f] overflow-hidden border-[1.5px] border-[#1f1f1f] animate-in fade-in zoom-in-95 duration-150"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header Tabs */}
        <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-[#faf7f0] px-5">
          <div className="flex items-center gap-5">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setTab(item.key)
                  setImportError(null)
                  setImportWarnings([])
                }}
                className={`flex items-center gap-1.5 border-b-2 py-3.5 text-xs font-bold transition ${
                  tab === item.key
                    ? 'border-[#df4e3e] text-[#df4e3e]'
                    : 'border-transparent text-stone-500 hover:text-[#1f1f1f]'
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
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-200/60 hover:text-[#1f1f1f] transition font-bold"
          >
            ✕
          </button>
        </div>

        {/* Content Area */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
          {tab === 'import-sql' ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-stone-600">
                  粘贴已有 SQL 建表脚本（支持 MySQL、PostgreSQL、SQLite 的 CREATE TABLE 语法）。将自动解析表结构、主键与外键关联，并在画板中自动排版。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setImportSqlText(SAMPLE_SQL)
                    setImportError(null)
                    setImportWarnings([])
                  }}
                  className="shrink-0 rounded-lg border border-[#df4e3e]/40 bg-[#fdf0ee] px-2.5 py-1 text-xs font-bold text-[#df4e3e] hover:bg-[#fbdad5] transition active:scale-95"
                >
                  填入电商示例 SQL
                </button>
              </div>

              <textarea
                value={importSqlText}
                spellCheck={false}
                placeholder="-- 粘贴你的 CREATE TABLE 建表语句，例如：&#10;CREATE TABLE users (&#10;  id BIGINT PRIMARY KEY AUTO_INCREMENT,&#10;  username VARCHAR(64) NOT NULL UNIQUE&#10;);&#10;&#10;CREATE TABLE orders (&#10;  id BIGINT PRIMARY KEY AUTO_INCREMENT,&#10;  user_id BIGINT NOT NULL,&#10;  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users (id)&#10;);"
                className="ident min-h-0 flex-1 resize-none rounded-xl border-[1.5px] border-[#1f1f1f] p-3.5 text-xs leading-relaxed outline-none focus:border-[#df4e3e] focus:ring-2 focus:ring-[#df4e3e]/20 font-mono shadow-[2px_2px_0px_#1f1f1f]"
                onChange={(event) => {
                  setImportSqlText(event.target.value)
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

              <div className="flex justify-end gap-2.5 pt-2">
                <button type="button" className={buttonClass} onClick={onClose}>
                  取消
                </button>
                <button
                  type="button"
                  disabled={importSqlText.trim().length === 0}
                  onClick={submitImportSQL}
                  className="rounded-lg bg-[#df4e3e] border-[1.5px] border-[#1f1f1f] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#d04232] disabled:cursor-not-allowed disabled:opacity-40 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px]"
                >
                  逆向解析并载入画板
                </button>
              </div>
            </>
          ) : tab === 'import-json' ? (
            <>
              <p className="text-xs text-stone-600">
                粘贴 ER 设计规范 JSON（可直接粘贴「导出 JSON」的内容）。导入将应用至画布并自动持久化保存到服务端。
              </p>
              <textarea
                value={importJsonText}
                spellCheck={false}
                placeholder='{"entities": [], "relations": []}'
                className="ident min-h-0 flex-1 resize-none rounded-xl border-[1.5px] border-[#1f1f1f] p-3.5 text-xs leading-relaxed outline-none focus:border-[#df4e3e] focus:ring-2 focus:ring-[#df4e3e]/20 font-mono shadow-[2px_2px_0px_#1f1f1f]"
                onChange={(event) => {
                  setImportJsonText(event.target.value)
                  setImportError(null)
                }}
              />
              {importError ? (
                <p className="rounded-lg border-[1.5px] border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 font-mono">
                  {importError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2.5 pt-2">
                <button type="button" className={buttonClass} onClick={onClose}>
                  取消
                </button>
                <button
                  type="button"
                  disabled={importJsonText.trim().length === 0}
                  onClick={submitImportJSON}
                  className="rounded-lg bg-[#df4e3e] border-[1.5px] border-[#1f1f1f] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#d04232] disabled:cursor-not-allowed disabled:opacity-40 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px]"
                >
                  解析并载入
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-stone-600">
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
                className="ident min-h-0 flex-1 resize-none rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] p-3.5 text-xs leading-relaxed outline-none font-mono text-[#1f1f1f] shadow-[2px_2px_0px_#1f1f1f]"
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
