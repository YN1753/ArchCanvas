import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'

import AiPanel from './components/AiPanel'
import Canvas from './components/Canvas'
import DataDialog from './components/DataDialog'
import Inspector from './components/Inspector'
import ScaffoldDialog from './components/ScaffoldDialog'
import Toast from './components/Toast'
import Toolbar from './components/Toolbar'
import { useStore } from './store/erStore'

export default function App() {
  const bootstrap = useStore((state) => state.bootstrap)
  const ready = useStore((state) => state.ready)
  const bootError = useStore((state) => state.bootError)
  const dataDialogOpen = useStore((state) => state.dataDialogOpen)
  const openDataDialog = useStore((state) => state.openDataDialog)
  const closeDataDialog = useStore((state) => state.closeDataDialog)
  const [scaffoldDialogOpen, setScaffoldDialogOpen] = useState(false)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // 全局快捷键：⌘/Ctrl + S (保存)、⌘/Ctrl + Z (撤销)、⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y (重做)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isMod = (event.metaKey || event.ctrlKey) && !event.altKey
      const key = event.key.toLowerCase()

      // ⌘/Ctrl + S 立即保存
      if (isMod && key === 's') {
        event.preventDefault()
        void useStore.getState().saveNow()
        return
      }

      // 如果当前焦点处于输入框/文本域内部，则放行原生文本编辑撤销/重做
      const target = event.target as HTMLElement | null
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      if (isInput) {
        return
      }

      // 撤销：⌘Z / Ctrl+Z
      if (isMod && !event.shiftKey && key === 'z') {
        event.preventDefault()
        useStore.getState().undo()
        return
      }

      // 重做：⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y
      const isRedo =
        (isMod && event.shiftKey && key === 'z') ||
        (event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && key === 'y')
      if (isRedo) {
        event.preventDefault()
        useStore.getState().redo()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#faf7f0] text-[#1f1f1f]">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#df4e3e] text-white border-[1.5px] border-[#1f1f1f] text-sm font-bold shadow-[2px_2px_0px_#1f1f1f] animate-pulse">
          AC
        </div>
        <p className="text-xs text-stone-600 font-mono tracking-wide">ArchCanvas Studio 正在连接后端…</p>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="grid h-full place-items-center bg-[#faf7f0] p-8">
        <div className="max-w-lg rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-6 shadow-[4px_4px_0px_#1f1f1f]">
          <div className="flex items-center gap-2 text-[#df4e3e] font-bold text-sm">
            <span>⚠️</span>
            <span>服务连接失败</span>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed break-all text-rose-700 font-mono bg-rose-50 p-3 rounded-lg border-[1.5px] border-rose-300">
            {bootError}
          </p>
          <p className="mt-3.5 text-xs leading-relaxed text-stone-600">
            请确认后端服务已启动：<code className="ident text-[#df4e3e] bg-[#fdf0ee] border border-[#df4e3e]/30 px-1 py-0.5 rounded font-bold">cd server && go run ./cmd/server</code>
            （默认监听 127.0.0.1:8080）。
          </p>
        </div>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col bg-[#faf7f0] text-[#1f1f1f]">
        <Toolbar
          onOpenData={() => openDataDialog('export-sql')}
          onOpenScaffold={() => setScaffoldDialogOpen(true)}
        />

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* 左侧主要工作区（全尺寸画布 + 底部悬浮 AI 智能胶囊） */}
          <div className="relative min-w-0 flex-1 h-full">
            <Canvas />
            <AiPanel />
          </div>

          {/* 右侧属性检查器与 DDL 预览面板 */}
          <Inspector />
        </div>
      </div>

      {dataDialogOpen ? <DataDialog onClose={closeDataDialog} /> : null}
      {scaffoldDialogOpen ? <ScaffoldDialog onClose={() => setScaffoldDialogOpen(false)} /> : null}
      <Toast />
    </ReactFlowProvider>
  )
}
