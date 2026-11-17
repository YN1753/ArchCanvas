import type { DatabaseDialect } from '../../types/dsl'
import DialectSegment from '../ui/DialectSegment'

const buttonClass =
  'rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-4 py-2 text-xs font-bold text-[#1f1f1f] transition hover:bg-stone-50 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white select-none cursor-pointer'

const primaryButtonClass =
  'rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#c84031] shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#df4e3e] select-none cursor-pointer'

export interface ScaffoldConfigFormProps {
  entityCount: number
  relationCount: number
  moduleName: string
  setModuleName: (value: string) => void
  port: string
  setPort: (value: string) => void
  dbDriver: DatabaseDialect
  setDbDriver: (dialect: DatabaseDialect) => void
  enableRedis: boolean
  setEnableRedis: (value: boolean) => void
  enableSoftDelete: boolean
  setEnableSoftDelete: (value: boolean) => void
  enableDocker: boolean
  setEnableDocker: (value: boolean) => void
  loading: boolean
  onPreview: () => void
  onDownload: () => void
}

export default function ScaffoldConfigForm({
  entityCount,
  relationCount,
  moduleName,
  setModuleName,
  port,
  setPort,
  dbDriver,
  setDbDriver,
  enableRedis,
  setEnableRedis,
  enableSoftDelete,
  setEnableSoftDelete,
  enableDocker,
  setEnableDocker,
  loading,
  onPreview,
  onDownload,
}: ScaffoldConfigFormProps) {
  const hasEntities = entityCount > 0

  return (
    <div className="flex flex-1 flex-col justify-between overflow-hidden p-6 bg-[#faf7f0]/40">
      <div className="space-y-4 overflow-y-auto pr-2">
        <div className="flex items-center justify-between rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
          <div className="text-xs text-stone-700">
            <span className="font-bold text-[#1f1f1f]">识别模型：</span>
            <span className="font-mono text-stone-600 ml-1">
              {entityCount} 个实体表，{relationCount} 条关联关系
            </span>
          </div>
          {!hasEntities && (
            <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              画板暂无实体，请先在画布中添加数据表
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="scaffold-module-name" className="block text-xs font-bold text-stone-800 mb-1.5">
              Go 模块名 (Module Path)
            </label>
            <input
              id="scaffold-module-name"
              type="text"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              placeholder="例如: myapp 或 github.com/user/myapp"
              className="w-full rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-2 text-xs font-mono text-stone-800 shadow-[2px_2px_0px_#1f1f1f] focus:border-[#df4e3e] focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-stone-500">将写入 go.mod 并作为包引用的根路径</p>
          </div>

          <div>
            <label htmlFor="scaffold-port" className="block text-xs font-bold text-stone-800 mb-1.5">
              服务监听端口
            </label>
            <input
              id="scaffold-port"
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder=":8080"
              className="w-full rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-2 text-xs font-mono text-stone-800 shadow-[2px_2px_0px_#1f1f1f] focus:border-[#df4e3e] focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-stone-500">启动时 HTTP 服务绑定的端口</p>
          </div>
        </div>

        <div>
          <span className="block text-xs font-bold text-stone-800 mb-1.5">数据库驱动</span>
          <DialectSegment
            value={dbDriver}
            onChange={setDbDriver}
            variant="cards"
            ariaLabel="数据库驱动"
          />
        </div>

        <div className="rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] space-y-2.5">
          <span className="block text-xs font-bold text-stone-800">可选工程组件</span>

          <div className="grid grid-cols-3 gap-4 pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableRedis}
                onChange={(e) => setEnableRedis(e.target.checked)}
                className="h-4 w-4 rounded border-[#1f1f1f] text-[#df4e3e] focus:ring-0 cursor-pointer accent-[#df4e3e]"
              />
              <div>
                <div className="text-xs font-bold text-stone-800">Redis 客户端</div>
                <div className="text-[10px] text-stone-400">引入 go-redis 连接池与配置</div>
              </div>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableSoftDelete}
                onChange={(e) => setEnableSoftDelete(e.target.checked)}
                className="h-4 w-4 rounded border-[#1f1f1f] text-[#df4e3e] focus:ring-0 cursor-pointer accent-[#df4e3e]"
              />
              <div>
                <div className="text-xs font-bold text-stone-800">软删除 (DeletedAt)</div>
                <div className="text-[10px] text-stone-400">GORM 逻辑删除字段</div>
              </div>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableDocker}
                onChange={(e) => setEnableDocker(e.target.checked)}
                className="h-4 w-4 rounded border-[#1f1f1f] text-[#df4e3e] focus:ring-0 cursor-pointer accent-[#df4e3e]"
              />
              <div>
                <div className="text-xs font-bold text-stone-800">Dockerfile & Makefile</div>
                <div className="text-[10px] text-stone-400">容器构建与便捷脚本</div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[#e5ded0] pt-4 mt-2">
        <div className="text-xs text-stone-500 font-mono">
          排版标准：<span className="text-stone-700 font-semibold">gofmt / 构造器依赖注入</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onPreview}
            disabled={loading || !hasEntities}
            className={buttonClass}
          >
            {loading ? '正在解析…' : '展开代码预览 ➔'}
          </button>

          <button
            type="button"
            onClick={onDownload}
            disabled={loading || !hasEntities}
            className={primaryButtonClass}
          >
            {loading ? '正在打包…' : '下载工程 ZIP'}
          </button>
        </div>
      </div>
    </div>
  )
}
