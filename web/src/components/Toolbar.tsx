import { getChenBackingMode } from '../flow/chenAdapter'
import { useStore } from '../store/erStore'
import ProjectMenu from './ProjectMenu'

function SavePill() {
  const saveState = useStore((state) => state.saveState)
  const saveError = useStore((state) => state.saveError)
  const saveNow = useStore((state) => state.saveNow)

  const statusDot =
    saveState === 'saving'
      ? 'bg-[#df4e3e] animate-ping'
      : saveState === 'saved'
        ? 'bg-emerald-600'
        : saveState === 'error'
          ? 'bg-rose-600'
          : 'bg-stone-400'

  const label =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'saved'
        ? '已保存'
        : saveState === 'error'
          ? '保存失败'
          : '未保存'

  return (
    <button
      type="button"
      onClick={() => void saveNow()}
      className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-[#b3a898] bg-[#f4ede2]/90 px-2.5 xl:px-3 py-1.5 text-xs font-mono text-[#574c43] hover:bg-[#ede3d5] transition shadow-2xs active:scale-98 shrink-0"
      title={saveError ? `错误原因: ${saveError}` : '按 ⌘/Ctrl + S 可立即手动落库保存'}
    >
      <span className={`h-2 w-2 rounded-full ${statusDot}`} />
      <span className="font-semibold text-[11px]">{label}</span>
      <span className="hidden 2xl:inline text-[10px] text-stone-400 font-mono">⌘S</span>
    </button>
  )
}

export default function Toolbar({
  onOpenData,
  onOpenScaffold,
}: {
  onOpenData: () => void
  onOpenScaffold: () => void
}) {
  const addEntity = useStore((state) => state.addEntity)
  const addConcept = useStore((state) => state.addConcept)
  const design = useStore((state) => state.design)
  const conceptualDesign = useStore((state) => state.conceptualDesign)
  const agentPhase = useStore((state) => state.agentPhase)
  const dslView = useStore((state) => state.dslView)
  const setDslView = useStore((state) => state.setDslView)
  const canvasViewMode = useStore((state) => state.canvasViewMode)
  const setCanvasViewMode = useStore((state) => state.setCanvasViewMode)
  const toggleInspector = useStore((state) => state.toggleInspector)
  const aiSidebarOpen = useStore((state) => state.aiSidebarOpen)
  const toggleAiSidebar = useStore((state) => state.toggleAiSidebar)
  const canUndo = useStore((state) => state.canUndo)
  const canRedo = useStore((state) => state.canRedo)
  const undo = useStore((state) => state.undo)
  const redo = useStore((state) => state.redo)
  const reviewReport = useStore((state) => state.reviewReport)
  const setReviewDrawerOpen = useStore((state) => state.setReviewDrawerOpen)
  const reviewSchema = useStore((state) => state.reviewSchema)
  const targetDialect = useStore((state) => state.targetDialect)
  const enrichSemantics = useStore((state) => state.enrichSemantics)
  const aiRunning = useStore((state) => state.aiRunning)
  const project = useStore((state) => state.project)
  const forkProject = useStore((state) => state.forkProject)
  const forkingProject = useStore((state) => state.forkingProject)

  const chenBackingMode = getChenBackingMode({ conceptualDesign, design, agentPhase })
  const isConceptualDraftMode = canvasViewMode === 'chen' && chenBackingMode === 'conceptual'

  return (
    <header className="relative z-40 flex items-center justify-between gap-1.5 xl:gap-2 border-b border-[#e5ded0] bg-[#faf7f0] px-2.5 xl:px-4 py-2.5 select-none shadow-2xs max-lg:overflow-x-auto lg:overflow-visible no-scrollbar">
      {/* 左侧：Logo、分段开关、项目选择、AI 架构师侧栏开关 */}
      <div className="flex items-center gap-1.5 xl:gap-2.5 shrink-0">
        {/* AC 红色圆形 Logo */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#df4e3e] text-white font-extrabold text-xs border-[1.5px] border-[#1f1f1f] shadow-xs shrink-0">
          AC
        </div>

        {/* 黑色双线圆角分段开关：概念(陈氏 ER) / 物理(关系表) / 源码(DSL) */}
        <div
          role="group"
          aria-label="视图模式切换"
          className="flex items-center rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-0.5 shadow-2xs"
        >
          {/* 概念 (陈氏 ER) */}
          <button
            type="button"
            aria-pressed={dslView === 'canvas' && canvasViewMode === 'chen'}
            onClick={() => {
              setDslView('canvas')
              setCanvasViewMode('chen')
            }}
            title="概念视图：以标准陈氏 ER 模型展示实体（矩形）、联系（菱形）、属性（椭圆）与基数"
            className={`flex items-center gap-1.5 px-2 xl:px-2.5 py-1 text-xs font-bold rounded-lg transition ${
              dslView === 'canvas' && canvasViewMode === 'chen'
                ? 'border-[1.5px] border-[#df4e3e] bg-white text-[#df4e3e] shadow-2xs'
                : 'text-stone-700 hover:text-[#df4e3e] font-semibold border-[1.5px] border-transparent'
            }`}
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="6" width="7" height="6" rx="1" />
              <polygon points="18,3 22,9 18,15 14,9" />
              <ellipse cx="6" cy="18" rx="4" ry="2.5" />
            </svg>
            <span className="hidden sm:inline">
              概念<span className="hidden xl:inline"> (陈氏)</span>
            </span>
          </button>

          {/* 物理 (数据表) */}
          <button
            type="button"
            aria-pressed={dslView === 'canvas' && canvasViewMode === 'relational'}
            onClick={() => {
              setDslView('canvas')
              setCanvasViewMode('relational')
            }}
            title="物理视图：以真实数据库物理表展示字段类型、主外键约束与中间表"
            className={`flex items-center gap-1.5 px-2 xl:px-2.5 py-1 text-xs font-bold rounded-lg transition ${
              dslView === 'canvas' && canvasViewMode === 'relational'
                ? 'border-[1.5px] border-[#df4e3e] bg-white text-[#df4e3e] shadow-2xs'
                : 'text-stone-700 hover:text-[#df4e3e] font-semibold border-[1.5px] border-transparent'
            }`}
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M3 15h18M9 9v12" />
            </svg>
            <span className="hidden sm:inline">
              物理<span className="hidden xl:inline"> (数据表)</span>
            </span>
          </button>

          {/* 源码 (DSL) */}
          <button
            type="button"
            aria-pressed={dslView === 'code'}
            onClick={() => setDslView('code')}
            title="源码视图：查看或导出底层的 JSON 领域模型规范"
            className={`flex items-center gap-1.5 px-2 xl:px-2.5 py-1 text-xs font-bold rounded-lg transition ${
              dslView === 'code'
                ? 'border-[1.5px] border-[#df4e3e] bg-white text-[#df4e3e] shadow-2xs'
                : 'text-stone-700 hover:text-[#df4e3e] font-semibold border-[1.5px] border-transparent'
            }`}
          >
            <span className="font-mono text-xs font-black">‹›</span>
            <span className="hidden sm:inline">
              DSL<span className="hidden xl:inline"> 源码</span>
            </span>
          </button>
        </div>

        <span className="hidden md:inline text-stone-300 text-sm font-light">/</span>

        {/* 项目管理器 */}
        <ProjectMenu />

        {project?.is_template ? (
          <button
            type="button"
            disabled={forkingProject}
            onClick={() => void forkProject(project.id)}
            className="hidden md:flex items-center gap-1 rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#fdf0ee] px-2 xl:px-2.5 py-1 text-xs font-bold text-[#df4e3e] shadow-[1.5px_1.5px_0px_#1f1f1f] hover:bg-[#fbe3df] active:translate-x-0.5 active:translate-y-0.5 transition select-none shrink-0 cursor-pointer disabled:opacity-50"
            title="当前为只读官方样板工程；点击克隆到您的专属浏览器沙盒自由编辑（直接拖拽或发送 AI 指令也会自动为您克隆副本）"
          >
            <span className="hidden 2xl:inline">{forkingProject ? '克隆中…' : '克隆到我的沙盒'}</span>
            <span className="2xl:hidden">{forkingProject ? '克隆中…' : '克隆沙盒'}</span>
          </button>
        ) : null}

        {/* AI 架构师侧栏开关 */}
        <button
          type="button"
          aria-pressed={aiSidebarOpen}
          onClick={toggleAiSidebar}
          className={`flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] px-2 xl:px-2.5 py-1 text-xs font-bold transition select-none shrink-0 ${
            aiSidebarOpen
              ? 'bg-white text-[#df4e3e] shadow-[2px_2px_0px_#1f1f1f]'
              : 'bg-[#faf7f0] text-stone-600 hover:bg-white hover:text-stone-900'
          }`}
          title="展开 / 折叠 AI 架构师侧栏 (⌘L)"
        >
          <span className="flex h-2 w-2 rounded-full bg-[#df4e3e]" />
          <span>AI 架构师</span>
          <span className="hidden 2xl:inline rounded bg-stone-100 px-1 py-0.2 font-mono text-[10px] text-stone-400">
            ⌘L
          </span>
        </button>
      </div>

      {/* 右侧：撤销/重做、未保存虚线胶囊、导出Go脚手架、红色新建主按钮、检查器开关 */}
      <div className="flex items-center gap-1.5 xl:gap-2 shrink-0">
        {/* 撤销 / 重做 */}
        <div className="flex items-center rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-0.5 shadow-2xs">
          <button
            type="button"
            aria-label="撤销"
            onClick={undo}
            disabled={!canUndo}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-700 hover:bg-stone-100 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition"
            title="撤销 (⌘Z / Ctrl+Z)"
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
          <div className="h-3.5 w-px bg-stone-200" />
          <button
            type="button"
            aria-label="重做"
            onClick={redo}
            disabled={!canRedo}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-700 hover:bg-stone-100 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition"
            title="重做 (⇧⌘Z / Ctrl+Y)"
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" />
            </svg>
          </button>
        </div>

        <SavePill />

        {/* 导入 / 导出结构 */}
        <button
          type="button"
          aria-label="导入或导出结构"
          onClick={onOpenData}
          className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-2.5 xl:px-3 py-1.5 text-xs font-bold text-stone-700 shadow-[2px_2px_0px_#1f1f1f] hover:bg-stone-50 active:translate-x-0.5 active:translate-y-0.5 transition select-none"
          title="导入或导出 SQL DDL、Mermaid、JSON 结构"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5 text-stone-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
          </svg>
          <span className="hidden 2xl:inline">导入/导出</span>
        </button>

        {/* 架构体检按钮 */}
        <button
          type="button"
          aria-label="架构体检"
          onClick={() => {
            setReviewDrawerOpen(true)
            if (!reviewReport && design.entities.length > 0) {
              void reviewSchema(targetDialect)
            }
          }}
          className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-2.5 xl:px-3 py-1.5 text-xs font-bold text-stone-800 shadow-[2px_2px_0px_#1f1f1f] hover:bg-stone-50 active:translate-x-0.5 active:translate-y-0.5 transition select-none cursor-pointer"
          title="对当前数据模型执行全方位质量、索引与性能体检"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5 text-stone-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="hidden xl:inline">架构体检</span>
          {reviewReport && (
            <span
              className={`rounded px-1.5 py-0.2 text-[10px] font-mono font-bold ${
                reviewReport.score >= 90
                  ? 'bg-emerald-100 text-emerald-800'
                  : reviewReport.score >= 70
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-rose-100 text-rose-800'
              }`}
            >
              {reviewReport.score}分
            </span>
          )}
        </button>

        {/* 一键 AI 语义推导按钮 */}
        <button
          type="button"
          aria-label="AI 语义推导"
          onClick={() => void enrichSemantics()}
          disabled={aiRunning}
          className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-2.5 xl:px-3 py-1.5 text-xs font-bold text-stone-800 shadow-[2px_2px_0px_#1f1f1f] hover:bg-stone-50 active:translate-x-0.5 active:translate-y-0.5 transition select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="一键调用轻量 LLM 分析全图上下文，推导并补全所有实体与字段的纯正业务概念名"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5 text-[#df4e3e] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.286L13 21l-2.286-6.857L5 12l5.714-2.286L13 3z" />
          </svg>
          <span className="hidden 2xl:inline">{aiRunning ? '推导中…' : 'AI 语义推导'}</span>
        </button>

        {/* 导出 Go 脚手架按钮 */}
        <button
          type="button"
          aria-label="导出 Go 脚手架"
          onClick={onOpenScaffold}
          className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-2.5 xl:px-3 py-1.5 text-xs font-bold text-stone-800 shadow-[2px_2px_0px_#1f1f1f] hover:bg-stone-50 active:translate-x-0.5 active:translate-y-0.5 transition select-none cursor-pointer"
          title="将当前 ER 模型一键导出为完整可运行的 Go Web 工程脚手架"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5 text-stone-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="hidden 2xl:inline">导出 Go 脚手架</span>
          <span className="hidden xl:inline 2xl:hidden">脚手架</span>
        </button>

        {/* 红色新建主按钮：智能对齐陈氏视图底层数据源，确保新建项立即呈现在当前画布上 */}
        <button
          type="button"
          onClick={() => {
            if (isConceptualDraftMode) {
              addConcept()
            } else {
              addEntity()
            }
          }}
          className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-2.5 xl:px-3.5 py-1.5 text-xs font-bold text-white shadow-[2px_2px_0px_#1f1f1f] hover:bg-[#c84031] active:translate-x-0.5 active:translate-y-0.5 transition select-none cursor-pointer shrink-0"
        >
          <span className="text-sm font-bold leading-none">+</span>
          <span className="hidden 2xl:inline">{isConceptualDraftMode ? '新建业务概念' : '新建实体'}</span>
          <span className="2xl:hidden">{isConceptualDraftMode ? '新建概念' : '新建实体'}</span>
        </button>

        {/* 帮助 / 诊断按钮 */}
        <button
          type="button"
          aria-label="设计诊断与属性检查器"
          onClick={toggleInspector}
          className="flex h-8 w-8 items-center justify-center rounded-xl border-[1.5px] border-[#1f1f1f] bg-white text-stone-700 font-mono text-xs font-bold shadow-2xs hover:bg-stone-50 transition active:scale-95 shrink-0"
          title="设计诊断与属性检查器"
        >
          ?
        </button>
      </div>
    </header>
  )
}
