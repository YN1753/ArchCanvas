import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'

import AiPanel from './components/AiPanel'
import Canvas from './components/Canvas'
import DataDialog from './components/DataDialog'
import Inspector from './components/Inspector'
import Toast from './components/Toast'
import Toolbar from './components/Toolbar'
import { useStore } from './store/erStore'

export default function App() {
  const bootstrap = useStore((state) => state.bootstrap)
  const ready = useStore((state) => state.ready)
  const bootError = useStore((state) => state.bootError)
  const [dataOpen, setDataOpen] = useState(false)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // ⌘/Ctrl + S 立即保存
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void useStore.getState().saveNow()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-900 text-white">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-sm font-bold shadow-lg animate-pulse">
          AC
        </div>
        <p className="text-xs text-slate-400 font-mono tracking-wide">ArchCanvas Studio 正在连接后端…</p>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="grid h-full place-items-center bg-slate-100 p-8">
        <div className="max-w-lg rounded-2xl border border-rose-200 bg-white p-6 shadow-xl">
          <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
            <span>⚠️</span>
            <span>服务连接失败</span>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed break-all text-rose-600 font-mono bg-rose-50 p-3 rounded-lg border border-rose-100">
            {bootError}
          </p>
          <p className="mt-3.5 text-xs leading-relaxed text-slate-500">
            请确认后端服务已启动：<code className="ident text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded">cd server && go run ./cmd/server</code>
            （默认监听 127.0.0.1:8080）。
          </p>
        </div>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col bg-slate-100/50">
        <Toolbar onOpenData={() => setDataOpen(true)} />

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

      {dataOpen ? <DataDialog onClose={() => setDataOpen(false)} /> : null}
      <Toast />
    </ReactFlowProvider>
  )
}
