import { useMemo, useState } from 'react'

import type { SchemaExporter } from '../../exchange/registry'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import type { DatabaseDialect, ERDesign } from '../../types/dsl'
import { downloadTextFile } from '../../utils/download'
import DialectSegment from '../ui/DialectSegment'

const buttonClass =
  'rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-1.5 text-xs font-bold text-[#1f1f1f] transition hover:bg-stone-100 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer'

export default function TextExportTab({
  exporter,
  design,
  projectName,
  initialDialect,
}: {
  exporter: SchemaExporter
  design: ERDesign
  projectName: string
  initialDialect: DatabaseDialect
}) {
  const [dialect, setDialect] = useState<DatabaseDialect>(initialDialect)
  const { copied, copyText } = useCopyFeedback(1500)

  const exportedText = useMemo(
    () => exporter.export(design, { dialect }),
    [exporter, design, dialect],
  )
  const filename = useMemo(
    () => exporter.buildFilename(projectName, { dialect }),
    [exporter, projectName, dialect],
  )

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-stone-600">{exporter.getDescription({ dialect })}</p>
        {exporter.supportsDialect ? (
          <DialectSegment
            value={dialect}
            onChange={setDialect}
            variant="segmented"
            ariaLabel="导出数据库方言"
          />
        ) : null}
      </div>

      <textarea
        readOnly
        aria-label={`${exporter.label} 导出内容`}
        value={exportedText}
        spellCheck={false}
        className="ident min-h-0 flex-1 resize-none rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] p-3.5 text-xs leading-relaxed outline-none font-mono text-[#1f1f1f] shadow-[2px_2px_0px_#1f1f1f]"
      />

      <div className="flex justify-end gap-2.5 pt-2">
        <button type="button" className={buttonClass} onClick={() => void copyText(exportedText)}>
          {copied ? '✓ 已复制' : '复制内容'}
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => downloadTextFile(filename, exportedText, exporter.mimeType)}
        >
          下载 {exporter.fileExtension} 文件
        </button>
      </div>
    </>
  )
}
