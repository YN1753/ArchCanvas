import { useCallback, useEffect, useMemo, useState } from 'react'
import { getNodesBounds, useReactFlow } from '@xyflow/react'

import { NODE_WIDTH } from '../../flow/adapter'
import { getChenNodeSize } from '../../flow/chen/dimensions'
import { getCanvasViewAdapter } from '../../flow/views'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import type { CanvasViewMode } from '../../types/dsl'
import { downloadDataUrl } from '../../utils/download'

const PADDING = 64

export type DiagramImageFormat = 'png' | 'svg'
export type DiagramImageBackground = 'white' | 'canvas' | 'transparent'
export type DiagramImageScale = 1 | 2 | 3

export function useDiagramImageExport({
  active,
  projectName,
  canvasViewMode,
}: {
  active: boolean
  projectName: string
  canvasViewMode: CanvasViewMode
}) {
  const { getNodes, getEdges } = useReactFlow()
  const viewAdapter = useMemo(() => getCanvasViewAdapter(canvasViewMode), [canvasViewMode])

  const [imageFormat, setImageFormat] = useState<DiagramImageFormat>('png')
  const [imageBackground, setImageBackground] = useState<DiagramImageBackground>('white')
  const [imageScale, setImageScale] = useState<DiagramImageScale>(2)
  const [hideHandles, setHideHandles] = useState(true)
  const [exportingImage, setExportingImage] = useState(false)
  const [copyingImage, setCopyingImage] = useState(false)
  const { copied: imageCopied, triggerCopied: triggerImageCopied } = useCopyFeedback(2000)
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [exportImageError, setExportImageError] = useState<string | null>(null)

  const { nodeCount, edgeCount, bounds } = useMemo(() => {
    if (!active) {
      return { nodeCount: 0, edgeCount: 0, bounds: null }
    }
    const rawNodes = getNodes()
    const rawEdges = getEdges()
    if (rawNodes.length === 0) {
      return { nodeCount: 0, edgeCount: rawEdges.length, bounds: null }
    }

    const safeNodes = rawNodes.map((n) => {
      const isChenNode =
        n.type === 'chenEntity' || n.type === 'chenRelation' || n.type === 'chenAttribute'
      const fallback = isChenNode ? getChenNodeSize(n.type) : { width: NODE_WIDTH, height: 180 }
      const width = n.measured?.width ?? n.width ?? fallback.width
      const height = n.measured?.height ?? n.height ?? fallback.height
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
  }, [active, getNodes, getEdges])

  const imageWidth = bounds ? Math.max(Math.round(bounds.width + PADDING * 2), 320) : 0
  const imageHeight = bounds ? Math.max(Math.round(bounds.height + PADDING * 2), 240) : 0

  const getRenderConfig = useCallback(() => {
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
  }, [bounds, imageBackground, imageWidth, imageHeight, imageFormat, imageScale, hideHandles])

  const refreshPreview = useCallback(async () => {
    const config = getRenderConfig()
    if (!config) return
    setPreviewLoading(true)
    setExportImageError(null)
    try {
      const { toPng } = await import('html-to-image')
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
  }, [getRenderConfig])

  useEffect(() => {
    if (!active || !bounds) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const config = getRenderConfig()
      if (!config || cancelled) return
      setPreviewLoading(true)
      setExportImageError(null)
      try {
        const { toPng } = await import('html-to-image')
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
  }, [active, bounds, getRenderConfig])

  const handleDownloadImage = async () => {
    const config = getRenderConfig()
    if (!config) return
    setExportingImage(true)
    setExportImageError(null)
    try {
      const { toPng, toSvg } = await import('html-to-image')
      const { viewportEl, options } = config
      const dataUrl =
        imageFormat === 'png' ? await toPng(viewportEl, options) : await toSvg(viewportEl, options)

      const filename = `${projectName}_${viewAdapter.exportSuffix}.${imageFormat}`
      downloadDataUrl(filename, dataUrl)
    } catch (err) {
      console.error('Failed to download image:', err)
      setExportImageError('导出图片失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setExportingImage(false)
    }
  }

  const handleCopyImage = async () => {
    const config = getRenderConfig()
    if (!config) return
    setCopyingImage(true)
    setExportImageError(null)
    try {
      const { toBlob } = await import('html-to-image')
      const { viewportEl, options } = config
      const blob = await toBlob(viewportEl, {
        ...options,
        pixelRatio: imageScale,
      })
      if (!blob) throw new Error('无法生成图片二进制数据')
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        throw new Error('当前浏览器环境不支持直接复制图片到剪贴板，请使用下载按钮')
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      triggerImageCopied()
    } catch (err) {
      console.error('Failed to copy image:', err)
      setExportImageError('复制到剪贴板失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCopyingImage(false)
    }
  }

  return {
    viewBadgeLabel: viewAdapter.badgeLabel,
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
    clearExportImageError: () => setExportImageError(null),
    refreshPreview,
    handleDownloadImage,
    handleCopyImage,
  }
}
