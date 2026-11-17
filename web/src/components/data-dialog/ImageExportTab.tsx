import type { CanvasViewMode } from '../../types/dsl'
import { useDiagramImageExport } from './useDiagramImageExport'

const buttonClass =
  'rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-1.5 text-xs font-bold text-[#1f1f1f] transition hover:bg-stone-100 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'

export default function ImageExportTab({
  projectName,
  canvasViewMode,
}: {
  projectName: string
  canvasViewMode: CanvasViewMode
}) {
  const {
    viewBadgeLabel,
    nodeCount,
    edgeCount,
    imageWidth,
    imageHeight,
    imageFormat,
    setImageFormat,
    imageBackground,
    setImageBackground,
    imageScale,
    setImageScale,
    hideHandles,
    setHideHandles,
    previewDataUrl,
    previewLoading,
    exportingImage,
    copyingImage,
    imageCopied,
    exportImageError,
    refreshPreview,
    handleDownloadImage,
    handleCopyImage,
  } = useDiagramImageExport({
    active: true,
    projectName,
    canvasViewMode,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] p-3 shadow-[2px_2px_0px_#1f1f1f]">
        <div className="flex flex-wrap items-center gap-4 text-xs">
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

        <div className="flex items-center gap-2">
          <span
            className={`rounded-lg px-2 py-0.5 text-[11px] font-bold border border-[#1f1f1f] ${
              canvasViewMode === 'chen' ? 'bg-[#df4e3e] text-white' : 'bg-stone-200 text-[#1f1f1f]'
            }`}
          >
            {viewBadgeLabel}
          </span>
          <span className="text-[11px] font-mono text-stone-500">
            {nodeCount} 节点 · {edgeCount} 连线 ·{' '}
            {imageFormat === 'png'
              ? `${imageWidth * imageScale} × ${imageHeight * imageScale} px`
              : `${imageWidth} × ${imageHeight} px (矢量)`}
          </span>
        </div>
      </div>

      {exportImageError && (
        <p className="rounded-lg border-[1.5px] border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 font-mono">
          {exportImageError}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#f2ede4] p-4 shadow-[2px_2px_0px_#1f1f1f] overflow-hidden">
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
            <svg aria-hidden="true" className="w-8 h-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-xs font-semibold">
              画板中暂无图元节点，请先在画布中添加实体或概念后再导出图片
            </p>
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
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-lg border border-[#1f1f1f] bg-white/90 px-2 py-1 text-[11px] font-semibold text-stone-700 shadow-xs backdrop-blur-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-[#df4e3e] animate-ping" />
            <span>更新预览中…</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 pt-1">
        <p className="text-[11px] text-stone-500">
          提示：PNG 适合插入技术方案文档与幻灯片汇报；SVG 矢量格式可在 Figma、Illustrator 中无损二次排版。
        </p>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void refreshPreview()}
            disabled={previewLoading || nodeCount === 0}
            className={buttonClass}
            title="重新计算并生成预览"
          >
            刷新预览
          </button>

          <button
            type="button"
            disabled={copyingImage || exportingImage || nodeCount === 0}
            onClick={() => void handleCopyImage()}
            className={buttonClass}
            title="将高清 PNG 图片直接复制到系统剪贴板，可直接粘贴到微信/飞书/文档中"
          >
            {imageCopied ? '✓ 已复制到剪贴板' : copyingImage ? '复制中…' : '复制 PNG'}
          </button>

          <button
            type="button"
            disabled={exportingImage || copyingImage || nodeCount === 0}
            onClick={() => void handleDownloadImage()}
            className="flex items-center gap-1.5 rounded-lg bg-[#df4e3e] border-[1.5px] border-[#1f1f1f] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#d04232] disabled:cursor-not-allowed disabled:opacity-40 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>{exportingImage ? '正在导出…' : `下载 ${imageFormat.toUpperCase()} 图片`}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
