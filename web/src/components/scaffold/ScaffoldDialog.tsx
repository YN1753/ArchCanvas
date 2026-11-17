import { useMemo, useState } from 'react'

import { api, type GeneratedFile } from '../../api/client'
import { useStore } from '../../store/erStore'
import type { DatabaseDialect } from '../../types/dsl'
import ModalDialog from '../ui/ModalDialog'
import ScaffoldCodePreview from './ScaffoldCodePreview'
import ScaffoldConfigForm from './ScaffoldConfigForm'

export default function ScaffoldDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((state) => state.project)
  const design = useStore((state) => state.design)
  const targetDialect = useStore((state) => state.targetDialect)

  const defaultModuleName = useMemo(() => {
    if (!project?.name) return 'archcanvas-app'
    const clean = project.name
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    return clean || 'archcanvas-app'
  }, [project?.name])

  const [mode, setMode] = useState<'config' | 'preview'>('config')
  const [moduleName, setModuleName] = useState(defaultModuleName)
  const [port, setPort] = useState(':8080')
  const [dbDriver, setDbDriver] = useState<DatabaseDialect>(targetDialect || 'mysql')
  const [enableRedis, setEnableRedis] = useState(true)
  const [enableDocker, setEnableDocker] = useState(true)
  const [enableSoftDelete, setEnableSoftDelete] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<GeneratedFile[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState('')

  const hasEntities = design.entities.length > 0

  const requestPayload = useMemo(
    () => ({
      project_id: project?.id || '',
      module_name: moduleName.trim() || 'archcanvas-app',
      port: port.trim() || ':8080',
      db_driver: dbDriver,
      enable_redis: enableRedis,
      enable_docker: enableDocker,
      enable_soft_delete: enableSoftDelete,
    }),
    [project?.id, moduleName, port, dbDriver, enableRedis, enableDocker, enableSoftDelete],
  )

  async function handleDirectDownload() {
    if (!project || !hasEntities) return
    setLoading(true)
    setError(null)
    try {
      await api.downloadScaffold(requestPayload)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleEnterPreview() {
    if (!project || !hasEntities) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.previewScaffold(requestPayload)
      setFiles(res)
      const defaultPick = res.find((f) => f.path.includes('main.go')) || res[0]
      setSelectedFilePath(defaultPick ? defaultPick.path : '')
      setMode('preview')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalDialog
      onClose={onClose}
      titleId="scaffold-dialog-title"
      className="h-[min(750px,92vh)] w-[min(1140px,96vw)]"
    >
      <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-[#faf7f0] px-6 py-4 select-none shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#df4e3e] text-white font-extrabold text-xs border-[1.5px] border-[#1f1f1f] shadow-xs">
            GO
          </div>
          <div>
            <h2 id="scaffold-dialog-title" className="text-sm font-bold text-[#1f1f1f]">
              导出 Go 后端脚手架
            </h2>
            <p className="text-xs text-stone-500">
              基于当前画板数据模型，生成开箱即用的独立 Go Web 工程
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-label="关闭弹窗"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-xl border-[1.5px] border-[#1f1f1f] bg-white text-stone-700 hover:bg-stone-50 transition shadow-2xs font-bold cursor-pointer"
        >
          ✕
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-6 mt-3 flex items-center gap-2 rounded-xl border-[1.5px] border-rose-300 bg-rose-50 px-3.5 py-2 text-xs text-rose-700 font-medium shrink-0"
        >
          <span>{error}</span>
        </div>
      )}

      {mode === 'config' ? (
        <ScaffoldConfigForm
          entityCount={design.entities.length}
          relationCount={design.relations.length}
          moduleName={moduleName}
          setModuleName={setModuleName}
          port={port}
          setPort={setPort}
          dbDriver={dbDriver}
          setDbDriver={setDbDriver}
          enableRedis={enableRedis}
          setEnableRedis={setEnableRedis}
          enableSoftDelete={enableSoftDelete}
          setEnableSoftDelete={setEnableSoftDelete}
          enableDocker={enableDocker}
          setEnableDocker={setEnableDocker}
          loading={loading}
          onPreview={() => void handleEnterPreview()}
          onDownload={() => void handleDirectDownload()}
        />
      ) : (
        <ScaffoldCodePreview
          files={files}
          selectedFilePath={selectedFilePath}
          onSelectFile={setSelectedFilePath}
          loading={loading}
          onBackToConfig={() => setMode('config')}
          onDownload={() => void handleDirectDownload()}
        />
      )}
    </ModalDialog>
  )
}
