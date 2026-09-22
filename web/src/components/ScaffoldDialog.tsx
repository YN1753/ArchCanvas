import { useState, useMemo } from 'react'
import { api, type GeneratedFile } from '../api/client'
import { useStore } from '../store/erStore'

const buttonClass =
  'rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-4 py-2 text-xs font-bold text-[#1f1f1f] transition hover:bg-stone-50 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white select-none'

const primaryButtonClass =
  'rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#c84031] shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#df4e3e] select-none'

// ----------------------------------------------------
// 极简专业 SVG 矢量图标（彻底摒弃彩色 Emoji）
// ----------------------------------------------------
function IconFolder({ open }: { open?: boolean }) {
  return (
    <svg className="w-3.5 h-3.5 text-stone-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      {open ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      )}
    </svg>
  )
}

function IconFile({ path }: { path: string }) {
  if (path.endsWith('.go')) {
    return (
      <span className="font-mono text-[10px] font-extrabold text-[#df4e3e] px-1 py-0.2 rounded bg-[#fdf0ee] border border-[#df4e3e]/30 leading-none shrink-0">
        GO
      </span>
    )
  }
  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    return (
      <span className="font-mono text-[9px] font-bold text-amber-700 px-1 py-0.2 rounded bg-amber-50 border border-amber-300 leading-none shrink-0">
        YML
      </span>
    )
  }
  if (path.endsWith('.mod')) {
    return (
      <span className="font-mono text-[9px] font-bold text-sky-700 px-1 py-0.2 rounded bg-sky-50 border border-sky-300 leading-none shrink-0">
        MOD
      </span>
    )
  }
  return (
    <svg className="w-3.5 h-3.5 text-stone-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

// ----------------------------------------------------
// 暖纸工坊印刷级（Paper Print）语法高亮着色引擎
// ----------------------------------------------------
function highlightLine(line: string, path: string): string {
  const escaped = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    return highlightYaml(escaped)
  }
  return highlightGo(escaped)
}

function highlightYaml(line: string): string {
  const commentIdx = line.indexOf('#')
  if (commentIdx !== -1) {
    const before = line.slice(0, commentIdx)
    const after = line.slice(commentIdx)
    return `${highlightYaml(before)}<span style="color:#78716c;font-style:italic">${after}</span>`
  }
  return line
    .replace(/^(\s*[\w.-]+)(:)/, '<span style="color:#df4e3e;font-weight:bold">$1</span><span style="color:#1f1f1f">$2</span>')
    .replace(/"(.*?)"/g, '<span style="color:#15803d">"$1"</span>')
    .replace(/\b(true|false|yes|no)\b/gi, '<span style="color:#9a3412;font-weight:bold">$1</span>')
    .replace(/\b(\d+)\b/g, '<span style="color:#c2410c">$1</span>')
}

function highlightGo(line: string): string {
  // 1. 注释识别 (深灰微斜体)
  const commentIdx = line.indexOf('//')
  if (commentIdx !== -1) {
    const before = line.slice(0, commentIdx)
    const after = line.slice(commentIdx)
    return `${highlightGo(before)}<span style="color:#78716c;font-style:italic">${after}</span>`
  }

  // 2. 结构体标签（GORM & JSON Tags）：复古暖烟草棕
  let processed = line.replace(/`([^`]+)`/g, (_match, p1) => {
    const tagged = p1.replace(
      /(\w+)(:)(&quot;|")(.*?)(&quot;|")/g,
      '<span style="color:#9a3412;font-weight:bold">$1</span>$2<span style="color:#15803d">$3$4$5</span>',
    )
    return `<span style="color:#9a3412;background-color:#faf5ee;padding:0 2px;border-radius:2px">\`${tagged}\`</span>`
  })

  // 3. 字符串字面量（墨绿橄榄色）
  processed = processed.replace(/(&quot;.*?&quot;)/g, '<span style="color:#15803d">$1</span>')

  // 4. 关键字（ArchCanvas 品牌陶土红，加粗）
  const keywords = [
    'package',
    'import',
    'type',
    'struct',
    'interface',
    'func',
    'return',
    'var',
    'const',
    'if',
    'else',
    'switch',
    'case',
    'default',
    'for',
    'range',
    'go',
    'defer',
    'select',
    'chan',
    'make',
    'new',
    'nil',
    'true',
    'false',
  ]
  const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g')
  processed = processed.replace(kwRegex, '<span style="color:#df4e3e;font-weight:bold">$1</span>')

  // 5. 基本类型与常用框架类型（深海墨蓝）
  const types = [
    'string',
    'int',
    'int64',
    'int32',
    'int16',
    'int8',
    'uint',
    'uint64',
    'uint32',
    'uint16',
    'uint8',
    'float64',
    'float32',
    'bool',
    'byte',
    'rune',
    'any',
    'error',
    'time\\.Time',
    'gorm\\.DeletedAt',
    'context\\.Context',
    'gin\\.Context',
  ]
  const typeRegex = new RegExp(`\\b(${types.join('|')})\\b`, 'g')
  processed = processed.replace(typeRegex, '<span style="color:#1d4ed8;font-weight:600">$1</span>')

  // 6. 函数名调用（深青色）
  processed = processed.replace(/\b([A-Za-z0-9_]+)\(/g, '<span style="color:#0f766e;font-weight:600">$1</span>(')

  return processed
}

interface DirectoryGroup {
  dir: string
  label: string
  files: GeneratedFile[]
}

export default function ScaffoldDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((state) => state.project)
  const design = useStore((state) => state.design)

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
  const [dbDriver, setDbDriver] = useState<'mysql' | 'postgres' | 'sqlite'>('mysql')
  const [enableRedis, setEnableRedis] = useState(true)
  const [enableDocker, setEnableDocker] = useState(true)
  const [enableSoftDelete, setEnableSoftDelete] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<GeneratedFile[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState<string>('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [copied, setCopied] = useState(false)
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({})

  const selectedFile = useMemo(() => {
    return files.find((f) => f.path === selectedFilePath) || files[0] || null
  }, [files, selectedFilePath])

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

  // 目录层级分组计算（按真实目录整理，避免截断）
  const groupedFiles = useMemo(() => {
    const map = new Map<string, GeneratedFile[]>()
    const kw = searchKeyword.trim().toLowerCase()
    const filtered = kw ? files.filter((f) => f.path.toLowerCase().includes(kw)) : files

    for (const file of filtered) {
      const lastSlash = file.path.lastIndexOf('/')
      const dir = lastSlash === -1 ? '.' : file.path.substring(0, lastSlash)
      if (!map.has(dir)) {
        map.set(dir, [])
      }
      map.get(dir)!.push(file)
    }

    const order = [
      'cmd/server',
      'configs',
      'internal/model',
      'internal/repository',
      'internal/service',
      'internal/handler',
      'internal/router',
      'internal/config',
      'internal/database',
      'internal/cache',
      'pkg/response',
      '.',
    ]

    const groups: DirectoryGroup[] = []
    const processedDirs = new Set<string>()

    for (const knownDir of order) {
      if (map.has(knownDir)) {
        groups.push({
          dir: knownDir,
          label: knownDir === '.' ? '根目录文件' : knownDir,
          files: map.get(knownDir)!,
        })
        processedDirs.add(knownDir)
      }
    }

    for (const [dir, fList] of map.entries()) {
      if (!processedDirs.has(dir)) {
        groups.push({
          dir,
          label: dir,
          files: fList,
        })
      }
    }

    return groups
  }, [files, searchKeyword])

  const codeLines = useMemo(() => {
    if (!selectedFile) return []
    return selectedFile.content.split('\n')
  }, [selectedFile])

  const breadcrumbs = useMemo(() => {
    if (!selectedFile) return []
    return selectedFile.path.split('/')
  }, [selectedFile])

  async function handleDirectDownload() {
    if (!project || !hasEntities) return
    setLoading(true)
    setError(null)
    try {
      await api.downloadScaffold(requestPayload)
      onClose()
    } catch (err: any) {
      setError(err.message || String(err))
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
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleCopyCode() {
    if (!selectedFile) return
    try {
      await navigator.clipboard.writeText(selectedFile.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  function toggleDir(dir: string) {
    setCollapsedDirs((prev) => ({ ...prev, [dir]: !prev[dir] }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex h-[750px] w-[1140px] max-w-[96vw] max-h-[92vh] flex-col rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white shadow-[6px_6px_0px_#1f1f1f] overflow-hidden">
        {/* 顶部标题栏 (一致的 #faf7f0 暖纸底色与 1.5px 黑线) */}
        <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-[#faf7f0] px-6 py-4 select-none">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#df4e3e] text-white font-extrabold text-xs border-[1.5px] border-[#1f1f1f] shadow-xs">
              GO
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#1f1f1f]">导出 Go 后端脚手架</h2>
              <p className="text-xs text-stone-500">基于当前画板数据模型，生成开箱即用的独立 Go Web 工程</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl border-[1.5px] border-[#1f1f1f] bg-white text-stone-700 hover:bg-stone-50 transition shadow-2xs font-bold"
          >
            ✕
          </button>
        </div>

        {/* 错误提示条 */}
        {error && (
          <div className="mx-6 mt-3 flex items-center gap-2 rounded-xl border-[1.5px] border-rose-300 bg-rose-50 px-3.5 py-2 text-xs text-rose-700 font-medium">
            <span>{error}</span>
          </div>
        )}

        {/* 模式 A：参数配置面板 */}
        {mode === 'config' && (
          <div className="flex flex-1 flex-col justify-between overflow-hidden p-6 bg-[#faf7f0]/40">
            <div className="space-y-4 overflow-y-auto pr-2">
              {/* 画板结构简报 */}
              <div className="flex items-center justify-between rounded-xl border-[1.5px] border-[#1f1f1f] bg-white p-3.5 shadow-[2px_2px_0px_#1f1f1f]">
                <div className="text-xs text-stone-700">
                  <span className="font-bold text-[#1f1f1f]">识别模型：</span>
                  <span className="font-mono text-stone-600 ml-1">
                    {design.entities.length} 个实体表，{design.relations.length} 条关联关系
                  </span>
                </div>
                {!hasEntities && (
                  <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                    画板暂无实体，请先在画布中添加数据表
                  </span>
                )}
              </div>

              {/* 模块名与端口 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-stone-800 mb-1.5">
                    Go 模块名 (Module Path)
                  </label>
                  <input
                    type="text"
                    value={moduleName}
                    onChange={(e) => setModuleName(e.target.value)}
                    placeholder="例如: myapp 或 github.com/user/myapp"
                    className="w-full rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-2 text-xs font-mono text-stone-800 shadow-[2px_2px_0px_#1f1f1f] focus:border-[#df4e3e] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-stone-500">将写入 go.mod 并作为包引用的根路径</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-800 mb-1.5">服务监听端口</label>
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder=":8080"
                    className="w-full rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3.5 py-2 text-xs font-mono text-stone-800 shadow-[2px_2px_0px_#1f1f1f] focus:border-[#df4e3e] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-stone-500">启动时 HTTP 服务绑定的端口</p>
                </div>
              </div>

              {/* 数据库驱动单选 */}
              <div>
                <label className="block text-xs font-bold text-stone-800 mb-1.5">数据库驱动</label>
                <div className="grid grid-cols-3 gap-3">
                  {(
                    [
                      { id: 'mysql', label: 'MySQL', desc: '标准互联网架构' },
                      { id: 'postgres', label: 'PostgreSQL', desc: '支持高级字段与扩展' },
                      { id: 'sqlite', label: 'SQLite', desc: '单文件即跑，零运维' },
                    ] as const
                  ).map((item) => {
                    const selected = dbDriver === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setDbDriver(item.id)}
                        className={`flex flex-col items-start rounded-xl border-[1.5px] p-3 text-left transition ${
                          selected
                            ? 'border-[#1f1f1f] bg-white shadow-[2px_2px_0px_#1f1f1f] ring-2 ring-[#df4e3e]/20'
                            : 'border-stone-300 bg-white/70 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className={`font-bold text-xs ${selected ? 'text-[#df4e3e]' : 'text-stone-800'}`}>
                            {item.label}
                          </span>
                          {selected && <span className="text-xs text-[#df4e3e] font-bold">✓</span>}
                        </div>
                        <span className="mt-1 text-[11px] text-stone-400">{item.desc}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 组件选配 */}
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

            {/* 底部动作栏 */}
            <div className="flex items-center justify-between border-t border-[#e5ded0] pt-4 mt-2">
              <div className="text-xs text-stone-500 font-mono">
                排版标准：<span className="text-stone-700 font-semibold">gofmt / 构造器依赖注入</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleEnterPreview}
                  disabled={loading || !hasEntities}
                  className={buttonClass}
                >
                  {loading ? '正在解析…' : '展开代码预览 ➔'}
                </button>

                <button
                  type="button"
                  onClick={handleDirectDownload}
                  disabled={loading || !hasEntities}
                  className={primaryButtonClass}
                >
                  {loading ? '正在打包…' : '下载工程 ZIP'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 模式 B：暖纸工坊风格代码树与印刷体代码查看器 */}
        {mode === 'preview' && (
          <div className="flex flex-1 flex-col overflow-hidden bg-[#faf7f0]/40 p-5">
            {/* 顶部二级操作栏 */}
            <div className="flex items-center justify-between pb-3 border-b border-[#e5ded0]">
              <button
                type="button"
                onClick={() => setMode('config')}
                className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-50 shadow-[1px_1px_0px_#1f1f1f] transition active:translate-x-0.5 active:translate-y-0.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>返回配置</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-mono text-stone-600">
                <span className="font-semibold text-stone-800">共生成 {files.length} 个文件</span>
                <span className="text-stone-300">/</span>
                <span className="font-bold text-[#df4e3e]">{selectedFile?.path}</span>
              </div>

              <button
                type="button"
                onClick={handleDirectDownload}
                disabled={loading}
                className={primaryButtonClass}
              >
                {loading ? '打包中…' : '下载工程 ZIP'}
              </button>
            </div>

            {/* 两栏：左侧真实文件夹树 + 右侧暖纸感印刷代码器 */}
            <div className="mt-3 flex flex-1 overflow-hidden rounded-xl border-[1.5px] border-[#1f1f1f] bg-white shadow-[3px_3px_0px_#1f1f1f]">
              {/* 左侧：文件夹树与搜索过滤 */}
              <div className="w-64 border-r-[1.5px] border-[#1f1f1f] bg-[#faf7f0] flex flex-col shrink-0">
                {/* 搜索框 */}
                <div className="p-2 border-b border-[#e5ded0] bg-white">
                  <div className="relative">
                    <input
                      type="text"
                      value={searchKeyword}
                      onChange={(e) => setSearchKeyword(e.target.value)}
                      placeholder="搜索文件..."
                      className="w-full rounded-lg border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] px-2.5 py-1 text-xs font-mono text-stone-800 placeholder-stone-400 focus:border-[#df4e3e] focus:bg-white focus:outline-none"
                    />
                    {searchKeyword && (
                      <button
                        type="button"
                        onClick={() => setSearchKeyword('')}
                        className="absolute right-2 top-1 text-stone-400 hover:text-stone-700 text-xs font-bold"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* 文件夹分组列表 */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 font-mono text-xs [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                  {groupedFiles.map((group) => {
                    const isCollapsed = collapsedDirs[group.dir]
                    return (
                      <div key={group.dir} className="space-y-0.5">
                        {/* 文件夹标头 */}
                        <button
                          type="button"
                          onClick={() => toggleDir(group.dir)}
                          className="flex items-center justify-between w-full rounded-md px-2 py-1 text-left text-[11px] font-bold text-stone-700 hover:bg-[#ede3d5] transition select-none"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-[10px] text-stone-400">
                              {isCollapsed ? '▸' : '▾'}
                            </span>
                            <IconFolder open={!isCollapsed} />
                            <span className="truncate">{group.label}</span>
                          </div>
                          <span className="text-[10px] text-stone-500 bg-stone-200/80 px-1.5 py-0.2 rounded shrink-0">
                            {group.files.length}
                          </span>
                        </button>

                        {/* 展开的文件 */}
                        {!isCollapsed && (
                          <div className="pl-3.5 space-y-0.5 border-l-[1.5px] border-stone-200 ml-2">
                            {group.files.map((file) => {
                              const active = file.path === selectedFile?.path
                              const lastSlash = file.path.lastIndexOf('/')
                              const fileName = lastSlash === -1 ? file.path : file.path.substring(lastSlash + 1)
                              return (
                                <button
                                  key={file.path}
                                  type="button"
                                  onClick={() => setSelectedFilePath(file.path)}
                                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition text-[11px] ${
                                    active
                                      ? 'border-[1.5px] border-[#df4e3e] bg-[#fdf0ee] text-[#df4e3e] font-bold shadow-2xs'
                                      : 'border-[1.5px] border-transparent text-stone-700 hover:bg-white hover:text-[#1f1f1f] font-medium'
                                  }`}
                                  title={file.path}
                                >
                                  <IconFile path={file.path} />
                                  <span className="truncate">{fileName}</span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 右侧：暖纸印刷感代码查看器 */}
              <div className="flex-1 flex flex-col overflow-hidden bg-white text-[#1f1f1f]">
                {/* 顶部面包屑与复制栏 */}
                <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-[#faf7f0] px-4 py-2 shrink-0 select-none">
                  {/* 面包屑 */}
                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <IconFile path={selectedFile?.path || ''} />
                    {breadcrumbs.map((crumb, idx) => {
                      const isLast = idx === breadcrumbs.length - 1
                      return (
                        <div key={idx} className="flex items-center gap-1.5">
                          {idx > 0 && <span className="text-stone-300 font-light">/</span>}
                          <span
                            className={
                              isLast
                                ? 'font-bold text-[#df4e3e]'
                                : 'text-stone-600 font-medium'
                            }
                          >
                            {crumb}
                          </span>
                        </div>
                      )
                    })}
                  </div>

                  {/* 状态与复制 */}
                  <div className="flex items-center gap-3">
                    <div className="text-[11px] font-mono text-stone-400">
                      <span>{codeLines.length} 行</span>
                      <span className="mx-1.5">·</span>
                      <span>{selectedFile?.size || 0} B</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="flex items-center gap-1 rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1 text-xs font-bold text-[#1f1f1f] hover:bg-stone-50 shadow-2xs transition active:scale-95"
                    >
                      {copied ? (
                        <>
                          <span className="text-[#df4e3e]">✓</span>
                          <span className="text-[#df4e3e]">已复制</span>
                        </>
                      ) : (
                        <span>复制代码</span>
                      )}
                    </button>
                  </div>
                </div>

                {/* 暖纸印刷分色代码主视窗 */}
                <div className="flex-1 overflow-auto font-mono text-xs leading-relaxed selection:bg-[#df4e3e] selection:text-white [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                  <div className="min-w-full inline-block py-2">
                    {codeLines.map((line, idx) => {
                      const highlighted = highlightLine(line, selectedFile?.path || '')
                      return (
                        <div
                          key={idx}
                          className="flex hover:bg-[#faf7f0] transition-colors group leading-6"
                        >
                          {/* 吸附固定行号（淡米棕底色） */}
                          <span className="w-12 select-none pr-3 text-right font-mono text-[11px] text-stone-400 group-hover:text-stone-700 bg-[#f4ede2] sticky left-0 shrink-0 border-r-[1.5px] border-[#e5ded0]">
                            {idx + 1}
                          </span>
                          {/* 高亮印刷代码内容 */}
                          <span
                            className="pl-3.5 pr-6 font-mono text-[12px] whitespace-pre text-[#1f1f1f]"
                            dangerouslySetInnerHTML={{ __html: highlighted || ' ' }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
