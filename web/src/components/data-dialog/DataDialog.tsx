import { useMemo, useState } from 'react'

import {
  getSchemaExporter,
  getSchemaImporter,
  listSchemaExporters,
  listSchemaImporters,
} from '../../exchange/registry'
import { useStore } from '../../store/erStore'
import type { DataDialogTab } from '../../store/types'
import ModalDialog from '../ui/ModalDialog'
import ImageExportTab from './ImageExportTab'
import SchemaImportTab from './SchemaImportTab'
import TextExportTab from './TextExportTab'

export type Tab = DataDialogTab

function TabIcon({ tabKey }: { tabKey: string }) {
  if (tabKey === 'export-sql') {
    return (
      <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
      </svg>
    )
  }
  if (tabKey === 'export-image') {
    return (
      <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    )
  }
  if (tabKey === 'export-mermaid') {
    return (
      <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    )
  }
  if (tabKey.startsWith('import-')) {
    return (
      <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  )
}

export default function DataDialog({ onClose }: { onClose: () => void }) {
  const design = useStore((state) => state.design)
  const project = useStore((state) => state.project)
  const importDesign = useStore((state) => state.importDesign)
  const enrichSemantics = useStore((state) => state.enrichSemantics)
  const defaultTab = useStore((state) => state.dataDialogTab)
  const targetDialect = useStore((state) => state.targetDialect)
  const canvasViewMode = useStore((state) => state.canvasViewMode)

  const [tab, setTab] = useState<Tab>(defaultTab ?? 'export-sql')

  const tabs = useMemo(() => {
    const exporters = listSchemaExporters()
    const importers = listSchemaImporters()
    const items: Array<{ key: Tab; label: string }> = []

    const [firstExporter, ...restExporters] = exporters
    if (firstExporter) {
      items.push({ key: `export-${firstExporter.id}`, label: firstExporter.tabLabel })
    }
    items.push({ key: 'export-image', label: '导出架构图 (图片)' })
    for (const exp of restExporters) {
      items.push({ key: `export-${exp.id}`, label: exp.tabLabel })
    }
    for (const imp of importers) {
      items.push({ key: `import-${imp.id}`, label: imp.tabLabel })
    }
    return items
  }, [])

  const activeExporter = tab.startsWith('export-')
    ? getSchemaExporter(tab.slice('export-'.length))
    : undefined
  const activeImporter = tab.startsWith('import-')
    ? getSchemaImporter(tab.slice('import-'.length))
    : undefined

  const projectBaseName = project?.name ?? 'archcanvas'
  const initialDialect = targetDialect || 'mysql'

  return (
    <ModalDialog
      onClose={onClose}
      ariaLabel="数据模型导入与导出"
      className="h-[min(720px,94vh)] w-[min(960px,96vw)]"
    >
      <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-[#faf7f0] px-5 overflow-x-auto no-scrollbar shrink-0">
        <div role="tablist" aria-label="导入导出模式" className="flex items-center gap-4 shrink-0">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`flex items-center gap-1.5 border-b-2 py-3.5 text-xs font-bold transition cursor-pointer select-none ${
                tab === item.key
                  ? 'border-[#df4e3e] text-[#df4e3e]'
                  : 'border-transparent text-stone-500 hover:text-[#1f1f1f]'
              }`}
            >
              <TabIcon tabKey={item.key} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-label="关闭弹窗"
          onClick={onClose}
          className="rounded-lg p-1 text-stone-500 hover:bg-stone-200/60 hover:text-[#1f1f1f] transition cursor-pointer"
          title="关闭"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
        {tab === 'export-image' ? (
          <ImageExportTab projectName={projectBaseName} canvasViewMode={canvasViewMode} />
        ) : activeImporter ? (
          <SchemaImportTab
            key={activeImporter.id}
            importer={activeImporter}
            initialDialect={initialDialect}
            onCancel={onClose}
            onImportSuccess={(parsedDesign, shouldEnrich) => {
              importDesign(parsedDesign)
              onClose()
              if (shouldEnrich) {
                void enrichSemantics({ design: parsedDesign })
              }
            }}
          />
        ) : activeExporter ? (
          <TextExportTab
            key={activeExporter.id}
            exporter={activeExporter}
            design={design}
            projectName={projectBaseName}
            initialDialect={initialDialect}
          />
        ) : null}
      </div>
    </ModalDialog>
  )
}
