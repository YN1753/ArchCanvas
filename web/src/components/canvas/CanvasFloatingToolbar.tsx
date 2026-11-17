export interface CanvasFloatingToolbarProps {
  toolMode: 'select' | 'pan'
  zoomLevel: number
  onSelectMode: (mode: 'select' | 'pan') => void
  onAutoLayout: () => void
  onFitView: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}

export default function CanvasFloatingToolbar({
  toolMode,
  zoomLevel,
  onSelectMode,
  onAutoLayout,
  onFitView,
  onZoomIn,
  onZoomOut,
}: CanvasFloatingToolbarProps) {
  return (
    <div className="absolute left-6 top-28 z-20 select-none">
      <div
        role="toolbar"
        aria-label="画布视图控制工具栏"
        className="flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-1.5 shadow-[2px_2px_0px_#1f1f1f]"
      >
        <button
          type="button"
          aria-label="选择与拖拽模式"
          aria-pressed={toolMode === 'select'}
          onClick={() => onSelectMode('select')}
          className={`rounded-xl p-2 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e] ${
            toolMode === 'select'
              ? 'bg-[#fdf0ee] border border-[#df4e3e] text-[#df4e3e] shadow-2xs'
              : 'text-stone-600 hover:bg-stone-50'
          }`}
          title="选择与拖拽模式"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
          </svg>
        </button>

        <button
          type="button"
          aria-label="平移画布模式"
          aria-pressed={toolMode === 'pan'}
          onClick={() => onSelectMode(toolMode === 'pan' ? 'select' : 'pan')}
          className={`rounded-xl p-2 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e] ${
            toolMode === 'pan'
              ? 'bg-[#fdf0ee] border border-[#df4e3e] text-[#df4e3e] shadow-2xs'
              : 'text-stone-600 hover:bg-stone-50'
          }`}
          title="平移画布模式 (在画布内支持按住 Space 临时平移，或鼠标中键拖拽)"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
          </svg>
        </button>

        <div className="w-full border-t border-dashed border-stone-200 my-0.5" />

        <button
          type="button"
          aria-label="整理排版布局"
          onClick={onAutoLayout}
          className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 hover:text-[#df4e3e] active:scale-95 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
          title="整理排版布局 (自动紧凑对齐)"
        >
          <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="7" height="6" rx="1.5" />
            <rect x="14" y="3" width="7" height="6" rx="1.5" />
            <rect x="8.5" y="15" width="7" height="6" rx="1.5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 9v3h11V9M12 12v3" />
          </svg>
        </button>

        <button
          type="button"
          aria-label="适应视口"
          onClick={onFitView}
          className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 hover:text-[#df4e3e] active:scale-95 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
          title="适应视口"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>

        <div className="w-full border-t border-dashed border-stone-200 my-0.5" />

        <button
          type="button"
          aria-label="放大画布"
          onClick={onZoomIn}
          className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
          title="放大画布"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>

        <button
          type="button"
          aria-label="缩小画布"
          onClick={onZoomOut}
          className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
          title="缩小画布"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
          </svg>
        </button>

        <div className="w-full border-t border-dashed border-stone-300 my-0.5" />

        <span className="font-mono text-[10px] font-bold text-stone-500 py-1">{zoomLevel}%</span>
      </div>
    </div>
  )
}
