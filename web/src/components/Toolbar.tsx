import { useEffect, useRef, useState } from 'react'

import { api } from '../api/client'
import { useStore } from '../store/erStore'
import ModelSelector from './ModelSelector'
import Select from './Select'

function SaveIndicator() {
  const saveState = useStore((state) => state.saveState)
  const saveError = useStore((state) => state.saveError)

  const text =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'saved'
        ? '已同步云端'
        : saveState === 'error'
          ? '保存失败'
          : '无未保存改动'

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
      title={saveError ? `错误原因: ${saveError}` : '按 ⌘/Ctrl + S 可立即手动落库保存'}
    >
      {saveState === 'saving' ? (
        <span className="h-2 w-2 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
      ) : saveState === 'saved' ? (
        <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-400" />
      ) : saveState === 'error' ? (
        <span className="h-2 w-2 rounded-full bg-rose-500 shadow-sm shadow-rose-400" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-slate-300" />
      )}
      <span
        className={`text-[11px] ${
          saveState === 'error'
            ? 'text-rose-600 font-semibold'
            : saveState === 'saved'
              ? 'text-emerald-700 font-medium'
              : 'text-slate-500'
        }`}
      >
        {text}
      </span>
    </div>
  )
}

function ProjectSelector() {
  const projects = useStore((state) => state.projects)
  const project = useStore((state) => state.project)
  const selectProject = useStore((state) => state.selectProject)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (creating) {
      inputRef.current?.focus()
    }
  }, [creating])

  async function submit() {
    const name = draft.trim()
    setCreating(false)
    setDraft('')
    if (!name) {
      return
    }
    const created = await api.createProject(name)
    useStore.setState((state) => ({ projects: [...state.projects, created] }))
    await selectProject(created.id)
  }

  if (creating) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={draft}
          placeholder="输入新项目名称"
          className="w-36 rounded-lg border border-indigo-400 bg-white px-2.5 py-1 text-xs outline-none ring-2 ring-indigo-100 shadow-sm"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void submit()
            }
            if (event.key === 'Escape') {
              setCreating(false)
              setDraft('')
            }
          }}
        />
        <button
          type="button"
          className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 transition shadow-sm"
          onClick={() => void submit()}
        >
          确定
        </button>
      </div>
    )
  }

  const options = projects.map((item) => ({
    value: item.id,
    label: item.name,
    sublabel: item.description || undefined,
  }))

  return (
    <div className="flex items-center gap-1.5">
      <Select
        className="w-[170px]"
        value={project?.id ?? ''}
        onChange={(val) => void selectProject(val)}
        options={options}
        placeholder="选择当前项目..."
      />
      <button
        type="button"
        title="新建一个独立的 ER 数据模型项目"
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 hover:bg-slate-50 shadow-2xs"
        onClick={() => setCreating(true)}
      >
        + 新建
      </button>
    </div>
  )
}

export default function Toolbar({ onOpenData }: { onOpenData: () => void }) {
  const addEntity = useStore((state) => state.addEntity)
  const autoLayout = useStore((state) => state.autoLayout)
  const saveNow = useStore((state) => state.saveNow)
  const reload = useStore((state) => state.reload)
  const dslView = useStore((state) => state.dslView)
  const setDslView = useStore((state) => state.setDslView)

  return (
    <header className="flex items-center gap-3 border-b border-slate-200/90 bg-white px-4 py-2.5 shadow-2xs select-none">
      {/* Brand & Project Breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-slate-900 text-xs font-black text-white shadow-sm">
            AC
          </div>
          <span className="text-sm font-bold tracking-tight text-slate-800">
            ArchCanvas <span className="text-[10px] text-indigo-600 font-semibold uppercase tracking-wider bg-indigo-50 border border-indigo-100 rounded px-1 py-0.2 ml-0.5">Studio</span>
          </span>
        </div>

        <span className="text-slate-300 text-sm font-light">/</span>

        <ProjectSelector />
      </div>

      <div className="h-4 w-px bg-slate-200" />

      {/* Model & BaseURL Selector */}
      <ModelSelector />

      <div className="h-4 w-px bg-slate-200" />

      {/* 画布 / 源码 切换分段器 */}
      <div className="flex items-center rounded-lg bg-slate-100 p-0.5 border border-slate-200/80">
        <button
          type="button"
          onClick={() => setDslView('canvas')}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition ${
            dslView === 'canvas'
              ? 'bg-white text-indigo-700 font-semibold shadow-xs'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <span>📊</span>
          <span>画布</span>
        </button>
        <button
          type="button"
          onClick={() => setDslView('code')}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition ${
            dslView === 'code'
              ? 'bg-white text-indigo-700 font-semibold shadow-xs'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <span>💻</span>
          <span>DSL 源码</span>
        </button>
      </div>

      {/* 右侧核心动作条 */}
      <div className="ml-auto flex items-center gap-2">
        <SaveIndicator />

        <div className="h-4 w-px bg-slate-200" />

        {/* 主按钮：新建实体 */}
        <button
          type="button"
          onClick={() => addEntity()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 shadow-sm"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span>新建实体</span>
        </button>

        {/* 次级操作组 */}
        <button
          type="button"
          onClick={autoLayout}
          className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 shadow-2xs"
          title="自动对齐所有实体表节点"
        >
          <span>自动布局</span>
        </button>

        <button
          type="button"
          onClick={onOpenData}
          className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 shadow-2xs"
          title="导出或导入 JSON/Mermaid 结构"
        >
          <span>导入 / 导出</span>
        </button>

        <button
          type="button"
          onClick={() => void saveNow()}
          className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 shadow-2xs"
          title="快捷键: ⌘/Ctrl + S"
        >
          <span>立即保存</span>
          <span className="text-[10px] text-slate-400 font-mono">⌘S</span>
        </button>

        <button
          type="button"
          onClick={() => void reload()}
          className="p-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:border-slate-400 hover:text-slate-800 hover:bg-slate-50 shadow-2xs"
          title="从服务端重新拉取最新数据"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </header>
  )
}
