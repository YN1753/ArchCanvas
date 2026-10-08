import { useEffect, useMemo, useState } from 'react'
import { getNodesBounds, useReactFlow } from '@xyflow/react'
import { toBlob, toPng, toSvg } from 'html-to-image'

import { toMermaid } from '../export/mermaid'
import { designToSQL, parseSQLToDesign, SAMPLE_SQL } from '../export/sql'
import { useStore, type DataDialogTab } from '../store/erStore'
import type { DatabaseDialect } from '../types/dsl'
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

function downloadDataUrl(filename: string, dataUrl: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  anchor.click()
}

export default function DataDialog({ onClose }: { onClose: () => void }) {
  const design = useStore((state) => state.design)
  const project = useStore((state) => state.project)
  const importDesign = useStore((state) => state.importDesign)
  const enrichSemantics = useStore((state) => state.enrichSemantics)
  const defaultTab = useStore((state) => state.dataDialogTab)
  const targetDialect = useStore((state) => state.targetDialect)
  const canvasViewMode = useStore((state) => state.canvasViewMode)

  const { getNodes, getEdges } = useReactFlow()

  const [tab, setTab] = useState<Tab>(defaultTab ?? 'export-sql')
  const [exportDialect, setExportDialect] = useState<DatabaseDialect>(targetDialect || 'mysql')
  const [autoEnrichSemantics, setAutoEnrichSemantics] = useState(true)
  const [importJsonText, setImportJsonText] = useState('')
  const [importSqlText, setImportSqlText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  // 图片导出相关状态
  const [imageFormat, setImageFormat] = useState<'png' | 'svg'>('png')
  const [imageBackground, setImageBackground] = useState<'white' | 'canvas' | 'transparent'>('white')
  const [imageScale, setImageScale] = useState<1 | 2 | 3>(2)
  const [hideHandles, setHideHandles] = useState(true)
  const [exportingImage, setExportingImage] = useState(false)
  const [copyingImage, setCopyingImage] = useState(false)
  const [imageCopied, setImageCopied] = useState(false)
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [exportImageError, setExportImageError] = useState<string | null>(null)

  const jsonText = useMemo(() => JSON.stringify(design, null, 2), [design])
  const sqlText = useMemo(() => designToSQL(design, exportDialect), [design, exportDialect])
  const mermaidText = useMemo(() => toMermaid(design), [design])

  const activeText =
    tab === 'export-sql' ? sqlText : tab === 'export-mermaid' ? mermaidText : jsonText

  const activeFilename = `${project?.name ?? 'archcanvas'}${
    tab === 'export-sql' ? `_${exportDialect}.sql` : tab === 'export-mermaid' ? '.mmd' : '.json'
  }`

  // 仅在图片导出标签激活时按需获取画布图元并安全计算几何包围盒
  const { nodeCount, edgeCount, bounds } = useMemo(() => {
    if (tab !== 'export-image') {
      return { nodeCount: 0, edgeCount: 0, bounds: null }
    }
    const rawNodes = getNodes()
    const rawEdges = getEdges()
    if (rawNodes.length === 0) {
      return { nodeCount: 0, edgeCount: rawEdges.length, bounds: null }
    }

    const safeNodes = rawNodes.map((n) => {
      const width =
        n.measured?.width ??
        n.width ??
        (n.type === 'chenAttribute' ? 110 : n.type === 'chenRelation' ? 100 : 272)
      const height =
        n.measured?.height ??
        n.height ??
        (n.type === 'chenAttribute' ? 44 : n.type === 'chenRelation' ? 60 : 180)
      return {
        ...n,
        width,
        height,
        measured: { width, height },
      }
    })
    return {
      nodeCount: safeNodes.length,
      edgeCount: rawEdges.length,
      bounds: getNodesBounds(safeNodes),
    }
  }, [tab, getNodes, getEdges])

  const PADDING = 64
  const imageWidth = bounds ? Math.max(Math.round(bounds.width + PADDING * 2), 320) : 0
  const imageHeight = bounds ? Math.max(Math.round(bounds.height + PADDING * 2), 240) : 0

  const getRenderConfig = () => {
    if (!bounds) return null
    const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewportEl) return null

    const transformX = -bounds.x + PADDING
    const transformY = -bounds.y + PADDING

    const bg =
      imageBackground === 'transparent'
        ? undefined
        : imageBackground === 'canvas'
          ? '#faf7f0'
          : '#ffffff'

    const options = {
      backgroundColor: bg,
      width: imageWidth,
      height: imageHeight,
      style: {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${transformX}px, ${transformY}px) scale(1)`,
      },
      pixelRatio: imageFormat === 'png' ? imageScale : 1,
      filter: (domNode: HTMLElement) => {
        if (hideHandles && domNode.classList?.contains('react-flow__handle')) {
          return false
        }
        return true
      },
    }

    return { viewportEl, options }
  }

  // 刷新高清预览图
  const refreshPreview = async () => {
    const config = getRenderConfig()
    if (!config) return
    setPreviewLoading(true)
    setExportImageError(null)
    try {
      const url = await toPng(config.viewportEl, {
        ...config.options,
        pixelRatio: 1,
      })
      setPreviewDataUrl(url)
    } catch (err) {
      console.error('Failed to generate diagram preview:', err)
      setExportImageError('生成预览失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setPreviewLoading(false)
    }
  }

  // 当切换到图片导出或配置变更时自动生成预览
  useEffect(() => {
    if (tab !== 'export-image' || !bounds) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const config = getRenderConfig()
      if (!config || cancelled) return
      setPreviewLoading(true)
      setExportImageError(null)
      try {
        const url = await toPng(config.viewportEl, {
          ...config.options,
          pixelRatio: 1,
        })
        if (!cancelled) {
          setPreviewDataUrl(url)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to generate diagram preview:', err)
          setExportImageError('生成预览失败：' + (err instanceof Error ? err.message : String(err)))
        }
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 60)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tab, bounds, imageBackground, hideHandles])

  // 下载图片
  async function handleDownloadImage() {
    const config = getRenderConfig()
    if (!config) return
    setExportingImage(true)
    setExportImageError(null)
    try {
      const { viewportEl, options } = config
      const dataUrl =
        imageFormat === 'png'
          ? await toPng(viewportEl, options)
          : await toSvg(viewportEl, options)

      const suffix = canvasViewMode === 'chen' ? 'chen_concept' : 'physical_schema'
      const filename = `${project?.name ?? 'archcanvas'}_${suffix}.${imageFormat}`
      downloadDataUrl(filename, dataUrl)
    } catch (err) {
      console.error('Failed to download image:', err)
      setExportImageError('导出图片失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setExportingImage(false)
    }
  }

  // 复制图片到剪贴板
  async function handleCopyImage() {
    const config = getRenderConfig()
    if (!config) return
    setCopyingImage(true)
    setExportImageError(null)
    try {
      const { viewportEl, options } = config
      const blob = await toBlob(viewportEl, {
        ...options,
        pixelRatio: imageScale,
      })
      if (!blob) throw new Error('无法生成图片二进制数据')
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        throw new Error('当前浏览器环境不支持直接复制图片到剪贴板，请使用下载按钮')
      }
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ])
      setImageCopied(true)
      window.setTimeout(() => setImageCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy image:', err)
      setExportImageError('复制到剪贴板失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCopyingImage(false)
    }
  }

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
      if (autoEnrichSemantics) {
        void enrichSemantics({ design: parsed })
      }
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
      if (autoEnrichSemantics) {
        void enrichSemantics({ design: parsedDesign })
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'export-sql', label: '导出 SQL DDL' },
    { key: 'export-image', label: '导出架构图 (图片)' },
    { key: 'export-json', label: '导出 JSON' },
    { key: 'export-mermaid', label: '导出 Mermaid' },
    { key: 'import-sql', label: '导入 SQL DDL' },
    { key: 'import-json', label: '导入 JSON' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(720px,94vh)] w-[min(960px,96vw)] flex-col rounded-2xl bg-white shadow-[6px_6px_0px_#1f1f1f] overflow-hidden border-[1.5px] border-[#1f1f1f] animate-in fade-in zoom-in-95 duration-150"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header Tabs */}
        <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-[#faf7f0] px-5">
          <div className="flex items-center gap-4">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setTab(item.key)
                  setImportError(null)
                  setImportWarnings([])
                  setExportImageError(null)
                }}
                className={`flex items-center gap-1.5 border-b-2 py-3.5 text-xs font-bold transition cursor-pointer select-none ${
                  tab === item.key
                    ? 'border-[#df4e3e] text-[#df4e3e]'
                    : 'border-transparent text-stone-500 hover:text-[#1f1f1f]'
                }`}
              >
                {item.key === 'export-sql' && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                )}
                {item.key === 'export-image' && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
                {item.key === 'export-json' && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                )}
                {item.key === 'export-mermaid' && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                  </svg>
                )}
                {item.key === 'import-sql' && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                )}
                {item.key === 'import-json' && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone-500 hover:bg-stone-200/60 hover:text-[#1f1f1f] transition cursor-pointer"
            title="关闭"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
          {tab === 'export-image' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {/* 控制与配置栏 */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] p-3 shadow-[2px_2px_0px_#1f1f1f]">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  {/* 格式切换 */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-stone-600">格式:</span>
                    <div className="flex items-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-white p-0.5 shadow-2xs">
                      {(['png', 'svg'] as const).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => setImageFormat(fmt)}
                          className={`px-2.5 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
                            imageFormat === fmt
                              ? 'bg-[#df4e3e] text-white shadow-2xs'
                              : 'text-stone-700 hover:text-[#df4e3e]'
                          }`}
                        >
                          {fmt.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 背景切换 */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-stone-600">底色:</span>
                    <div className="flex items-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-white p-0.5 shadow-2xs">
                      {(
                        [
                          { key: 'white', label: '纯白' },
                          { key: 'canvas', label: '米色' },
                          { key: 'transparent', label: '透明' },
                        ] as const
                      ).map((bg) => (
                        <button
                          key={bg.key}
                          type="button"
                          onClick={() => setImageBackground(bg.key)}
                          className={`px-2.5 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
                            imageBackground === bg.key
                              ? 'bg-[#df4e3e] text-white shadow-2xs'
                              : 'text-stone-700 hover:text-[#df4e3e]'
                          }`}
                        >
                          {bg.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 分辨率倍率 (仅 PNG 可选) */}
                  {imageFormat === 'png' && (
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-stone-600">清晰度:</span>
                      <div className="flex items-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-white p-0.5 shadow-2xs">
                        {([1, 2, 3] as const).map((scale) => (
                          <button
                            key={scale}
                            type="button"
                            onClick={() => setImageScale(scale)}
                            className={`px-2.5 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
                              imageScale === scale
                                ? 'bg-[#df4e3e] text-white shadow-2xs'
                                : 'text-stone-700 hover:text-[#df4e3e]'
                            }`}
                            title={
                              scale === 1
                                ? '1x 标准分辨率'
                                : scale === 2
                                  ? '2x 高清 Retina 屏推荐'
                                  : '3x 超清打印与高分屏'
                            }
                          >
                            {scale}x{scale === 2 ? ' (推荐)' : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 隐藏连线连接桩 */}
                  <label className="flex items-center gap-1.5 text-stone-700 font-semibold cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hideHandles}
                      onChange={(e) => setHideHandles(e.target.checked)}
                      className="accent-[#df4e3e] h-3.5 w-3.5 rounded border-[#1f1f1f]"
                    />
                    <span>隐藏图元连线桩</span>
                  </label>
                </div>

                {/* 视图信息与尺寸徽标 */}
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-bold border-[1px] border-[#1f1f1f] ${
                      canvasViewMode === 'chen'
                        ? 'bg-[#df4e3e] text-white'
                        : 'bg-stone-200 text-[#1f1f1f]'
                    }`}
                  >
                    {canvasViewMode === 'chen' ? '陈氏概念模型' : '物理表模型'}
                  </span>
                  <span className="text-[11px] font-mono text-stone-500">
                    {nodeCount} 节点 · {edgeCount} 连线 ·{' '}
                    {imageFormat === 'png'
                      ? `${imageWidth * imageScale} × ${imageHeight * imageScale} px`
                      : `${imageWidth} × ${imageHeight} px (矢量)`}
                  </span>
                </div>
              </div>

              {/* 错误提示 */}
              {exportImageError && (
                <p className="rounded-lg border-[1.5px] border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 font-mono">
                  {exportImageError}
                </p>
              )}

              {/* 预览舞台 (Preview Stage) */}
              <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#f2ede4] p-4 shadow-[2px_2px_0px_#1f1f1f] overflow-hidden">
                {/* 透明棋盘格底纹 */}
                <div
                  className="absolute inset-0 opacity-25 pointer-events-none"
                  style={{
                    backgroundImage:
                      'radial-gradient(#1f1f1f 0.75px, transparent 0.75px), radial-gradient(#1f1f1f 0.75px, #f2ede4 0.75px)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 8px 8px',
                  }}
                />

                {nodeCount === 0 ? (
                  <div className="relative z-10 flex flex-col items-center justify-center gap-2 text-stone-500">
                    <svg className="w-8 h-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-xs font-semibold">画板中暂无图元节点，请先在画布中添加实体或概念后再导出图片</p>
                  </div>
                ) : previewDataUrl ? (
                  <div className="relative z-10 flex h-full w-full items-center justify-center p-2">
                    <img
                      src={previewDataUrl}
                      alt="架构图导出预览"
                      className="max-h-full max-w-full rounded-lg border-[1.5px] border-[#1f1f1f] object-contain shadow-[4px_4px_0px_#1f1f1f]"
                      style={{
                        backgroundColor:
                          imageBackground === 'transparent'
                            ? 'transparent'
                            : imageBackground === 'canvas'
                              ? '#faf7f0'
                              : '#ffffff',
                      }}
                    />
                  </div>
                ) : (
                  <div className="relative z-10 flex items-center gap-2 text-xs font-semibold text-stone-600">
                    <span className="h-2 w-2 rounded-full bg-[#df4e3e] animate-ping" />
                    <span>正在生成画板预览…</span>
                  </div>
                )}

                {previewLoading && previewDataUrl && (
                  <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-lg border-[1px] border-[#1f1f1f] bg-white/90 px-2 py-1 text-[11px] font-semibold text-stone-700 shadow-xs backdrop-blur-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#df4e3e] animate-ping" />
                    <span>更新预览中…</span>
                  </div>
                )}
              </div>

              {/* 底部动作工具条 */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <p className="text-[11px] text-stone-500">
                  提示：PNG 适合插入技术方案文档与幻灯片汇报；SVG 矢量格式可在 Figma、Illustrator 中无损二次排版。
                </p>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={refreshPreview}
                    disabled={previewLoading || nodeCount === 0}
                    className={buttonClass}
                    title="重新计算并生成预览"
                  >
                    刷新预览
                  </button>

                  <button
                    type="button"
                    disabled={copyingImage || exportingImage || nodeCount === 0}
                    onClick={handleCopyImage}
                    className={buttonClass}
                    title="将高清 PNG 图片直接复制到系统剪贴板，可直接粘贴到微信/飞书/文档中"
                  >
                    {imageCopied ? '✓ 已复制到剪贴板' : copyingImage ? '复制中…' : '复制 PNG'}
                  </button>

                  <button
                    type="button"
                    disabled={exportingImage || copyingImage || nodeCount === 0}
                    onClick={handleDownloadImage}
                    className="flex items-center gap-1.5 rounded-lg bg-[#df4e3e] border-[1.5px] border-[#1f1f1f] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#d04232] disabled:cursor-not-allowed disabled:opacity-40 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>
                      {exportingImage ? '正在导出…' : `下载 ${imageFormat.toUpperCase()} 图片`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          ) : tab === 'import-sql' ? (
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
                  className="shrink-0 rounded-lg border border-[#df4e3e]/40 bg-[#fdf0ee] px-2.5 py-1 text-xs font-bold text-[#df4e3e] hover:bg-[#fbdad5] transition active:scale-95 cursor-pointer"
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

              <div className="flex items-center justify-between gap-2.5 pt-2">
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-stone-700 font-medium">
                  <input
                    type="checkbox"
                    checked={autoEnrichSemantics}
                    onChange={(e) => setAutoEnrichSemantics(e.target.checked)}
                    className="rounded border-[#1f1f1f] text-[#df4e3e] focus:ring-[#df4e3e]"
                  />
                  <span className="flex items-center gap-1.5">
                    <span className="font-bold text-[#df4e3e]">✨ AI 智能推导概念层语义</span>
                    <span className="text-[11px] text-stone-400">（通过轻量 LLM 自动补全实体与字段中文业务概念）</span>
                  </span>
                </label>
                <div className="flex items-center gap-2.5">
                  <button type="button" className={buttonClass} onClick={onClose}>
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={importSqlText.trim().length === 0}
                    onClick={submitImportSQL}
                    className="rounded-lg bg-[#df4e3e] border-[1.5px] border-[#1f1f1f] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#d04232] disabled:cursor-not-allowed disabled:opacity-40 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
                  >
                    逆向解析并载入画板
                  </button>
                </div>
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
              <div className="flex items-center justify-between gap-2.5 pt-2">
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-stone-700 font-medium">
                  <input
                    type="checkbox"
                    checked={autoEnrichSemantics}
                    onChange={(e) => setAutoEnrichSemantics(e.target.checked)}
                    className="rounded border-[#1f1f1f] text-[#df4e3e] focus:ring-[#df4e3e]"
                  />
                  <span className="flex items-center gap-1.5">
                    <span className="font-bold text-[#df4e3e]">✨ AI 智能推导概念层语义</span>
                    <span className="text-[11px] text-stone-400">（通过轻量 LLM 自动补全实体与字段中文业务概念）</span>
                  </span>
                </label>
                <div className="flex items-center gap-2.5">
                  <button type="button" className={buttonClass} onClick={onClose}>
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={importJsonText.trim().length === 0}
                    onClick={submitImportJSON}
                    className="rounded-lg bg-[#df4e3e] border-[1.5px] border-[#1f1f1f] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#d04232] disabled:cursor-not-allowed disabled:opacity-40 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
                  >
                    解析并载入
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {tab === 'export-sql' ? (
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-stone-600">
                    {exportDialect === 'postgres'
                      ? '生成的 PostgreSQL 标准 DDL 脚本，包含表/字段注释及 IF NOT EXISTS 索引定义。'
                      : exportDialect === 'sqlite'
                        ? '生成的 SQLite 标准建表脚本，包含自增主键与 IF NOT EXISTS 索引定义。'
                        : '生成的 MySQL / MariaDB 标准建表语句，包含表注释与 CREATE INDEX 索引定义。'}
                  </p>
                  <div className="flex items-center rounded-lg border-[1.5px] border-[#1f1f1f] bg-white p-0.5 shadow-2xs shrink-0">
                    {(['mysql', 'postgres', 'sqlite'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setExportDialect(d)}
                        className={`px-2.5 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
                          exportDialect === d
                            ? 'bg-[#df4e3e] text-white shadow-2xs'
                            : 'text-stone-700 hover:text-[#df4e3e]'
                        }`}
                      >
                        {d === 'postgres' ? 'PostgreSQL' : d === 'sqlite' ? 'SQLite' : 'MySQL'}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-stone-600">
                  {tab === 'export-mermaid'
                    ? 'Mermaid erDiagram 源码，可直接贴入 Markdown、Notion 或 GitHub 评审。'
                    : '标准的 ER DSL JSON 结构规范，用于版本备份或在其他 ArchCanvas 实例中导入。'}
                </p>
              )}
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
