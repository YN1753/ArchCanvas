import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/erStore'
import type { Project } from '../api/client'

export default function ProjectMenu() {
  const projects = useStore((state) => state.projects)
  const currentProject = useStore((state) => state.project)
  const selectProject = useStore((state) => state.selectProject)
  const createProject = useStore((state) => state.createProject)
  const deleteProject = useStore((state) => state.deleteProject)
  const updateProject = useStore((state) => state.updateProject)

  const [menuOpen, setMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Project | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)

  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [renameName, setRenameName] = useState('')

  const menuRef = useRef<HTMLDivElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // 点击外部关闭下拉菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  useEffect(() => {
    if (createOpen) {
      setTimeout(() => createInputRef.current?.focus(), 50)
    }
  }, [createOpen])

  useEffect(() => {
    if (renameTarget) {
      setRenameName(renameTarget.name)
      setTimeout(() => renameInputRef.current?.focus(), 50)
    }
  }, [renameTarget])

  const handleCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    setCreateOpen(false)
    setNewName('')
    setNewDesc('')
    setMenuOpen(false)
    await createProject(trimmed, newDesc.trim())
  }

  const handleRename = async () => {
    if (!renameTarget) return
    const trimmed = renameName.trim()
    if (!trimmed) return
    const targetId = renameTarget.id
    setRenameTarget(null)
    setRenameName('')
    await updateProject(targetId, trimmed)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const targetId = deleteTarget.id
    setDeleteTarget(null)
    setMenuOpen(false)
    await deleteProject(targetId)
  }

  return (
    <div className="relative" ref={menuRef}>
      {/* 触发主按钮 */}
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3 py-1 text-xs font-bold text-[#1f1f1f] hover:bg-[#faf7f0] transition shadow-2xs active:scale-98"
        title="点击切换或管理 ER 项目"
      >
        <svg className="w-3.5 h-3.5 text-[#df4e3e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="max-w-[140px] truncate text-[#1f1f1f]">
          {currentProject?.name || '选择项目'}
        </span>
        <svg
          className={`w-3 h-3 text-stone-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 项目下拉选择与管理面板 */}
      {menuOpen ? (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-stone-100">
            <span className="text-[11px] font-bold text-stone-400 uppercase tracking-wider">
              全部项目 ({projects.length})
            </span>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setCreateOpen(true)
              }}
              className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold text-[#df4e3e] hover:bg-[#fdf0ee] transition"
            >
              <span>+ 新建项目</span>
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto py-1 space-y-0.5 no-scrollbar">
            {projects.map((p) => {
              const isSelected = p.id === currentProject?.id
              return (
                <div
                  key={p.id}
                  className={`group flex items-center justify-between rounded-xl px-2.5 py-1.5 text-xs transition cursor-pointer ${
                    isSelected
                      ? 'bg-[#fdf0ee] text-[#df4e3e] font-bold'
                      : 'text-stone-700 hover:bg-[#faf7f0]'
                  }`}
                  onClick={() => {
                    if (!isSelected) {
                      void selectProject(p.id)
                    }
                    setMenuOpen(false)
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isSelected ? (
                      <span className="text-[#df4e3e] text-xs font-bold shrink-0">✓</span>
                    ) : (
                      <span className="w-2.5 shrink-0" />
                    )}
                    <span className="truncate">{p.name}</span>
                  </div>

                  {/* 快捷操作：重命名与删除 */}
                  <div
                    className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0 ml-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      title="重命名项目"
                      onClick={() => setRenameTarget(p)}
                      className="p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-200 transition"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    {projects.length > 1 ? (
                      <button
                        type="button"
                        title="删除项目"
                        onClick={() => setDeleteTarget(p)}
                        className="p-1 rounded text-stone-400 hover:text-[#df4e3e] hover:bg-red-50 transition"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* 新建项目 Modal */}
      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl border-[2px] border-[#1f1f1f] bg-[#faf7f0] p-5 shadow-[5px_5px_0px_#1f1f1f] animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-sm font-bold text-[#1f1f1f]">新建 ER 数据模型项目</h3>
            <p className="mt-1 text-xs text-stone-500">创建后将建立独立的实体设计画布与推理上下文。</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-stone-600 mb-1">项目名称</label>
                <input
                  ref={createInputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate()
                    if (e.key === 'Escape') setCreateOpen(false)
                  }}
                  placeholder="例如：电商交易系统 / 智能工单平台"
                  className="w-full rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3 py-2 text-xs text-[#1f1f1f] outline-none focus:border-[#df4e3e] shadow-2xs transition"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-stone-600 mb-1">简要描述（可选）</label>
                <input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate()
                    if (e.key === 'Escape') setCreateOpen(false)
                  }}
                  placeholder="用于辅助 AI 理解业务背景"
                  className="w-full rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3 py-2 text-xs text-[#1f1f1f] outline-none focus:border-[#df4e3e] shadow-2xs transition"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl border-[1.5px] border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!newName.trim()}
                className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-4 py-1.5 text-xs font-bold text-white shadow-[2px_2px_0px_#1f1f1f] hover:bg-[#c84031] disabled:opacity-50 transition"
              >
                创建项目
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 重命名 Modal */}
      {renameTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs p-4">
          <div className="w-full max-w-xs rounded-2xl border-[2px] border-[#1f1f1f] bg-[#faf7f0] p-5 shadow-[5px_5px_0px_#1f1f1f] animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-sm font-bold text-[#1f1f1f]">重命名项目</h3>
            <div className="mt-3">
              <input
                ref={renameInputRef}
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRename()
                  if (e.key === 'Escape') setRenameTarget(null)
                }}
                className="w-full rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3 py-2 text-xs text-[#1f1f1f] outline-none focus:border-[#df4e3e] shadow-2xs transition"
              />
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="rounded-xl border-[1.5px] border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleRename()}
                disabled={!renameName.trim()}
                className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-3.5 py-1.5 text-xs font-bold text-white shadow-[2px_2px_0px_#1f1f1f] hover:bg-[#c84031] disabled:opacity-50 transition"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 删除确认 Modal */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs p-4">
          <div className="w-full max-w-xs rounded-2xl border-[2px] border-[#1f1f1f] bg-[#faf7f0] p-5 shadow-[5px_5px_0px_#1f1f1f] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 text-[#df4e3e] font-bold text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>确认删除项目？</span>
            </div>
            <p className="mt-2 text-xs text-stone-600 leading-relaxed">
              确定要删除项目「<span className="font-bold text-[#1f1f1f]">{deleteTarget.name}</span>」吗？其名下的所有实体表结构将一并清理，操作不可恢复。
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border-[1.5px] border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-3.5 py-1.5 text-xs font-bold text-white shadow-[2px_2px_0px_#1f1f1f] hover:bg-[#c84031] transition"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
