import { useMemo, useState } from 'react'

import type { GeneratedFile } from '../../api/client'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { tokenizeCodeLine, type CodeTokenType } from './codeTokenizer'

const primaryButtonClass =
  'rounded-xl border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#c84031] shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#df4e3e] select-none cursor-pointer'

const KNOWN_DIRECTORY_ORDER = [
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
] as const

const TOKEN_CLASS_MAP: Record<CodeTokenType, string> = {
  plain: '',
  comment: 'text-stone-500 italic',
  keyword: 'text-[#df4e3e] font-bold',
  type: 'text-blue-700 font-semibold',
  function: 'text-teal-700 font-semibold',
  string: 'text-green-700',
  number: 'text-orange-700',
  boolean: 'text-orange-900 font-bold',
  yamlKey: 'text-[#df4e3e] font-bold',
  structTagPunct: 'text-orange-900 bg-[#faf5ee]',
  structTagKey: 'text-orange-900 font-bold bg-[#faf5ee]',
  structTagVal: 'text-green-700 bg-[#faf5ee]',
}

interface DirectoryGroup {
  dir: string
  label: string
  files: GeneratedFile[]
}

function IconFolder({ open }: { open?: boolean }) {
  return (
    <svg aria-hidden="true" className="w-3.5 h-3.5 text-stone-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
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
    <svg aria-hidden="true" className="w-3.5 h-3.5 text-stone-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

export default function ScaffoldCodePreview({
  files,
  selectedFilePath,
  onSelectFile,
  loading,
  onBackToConfig,
  onDownload,
}: {
  files: GeneratedFile[]
  selectedFilePath: string
  onSelectFile: (path: string) => void
  loading: boolean
  onBackToConfig: () => void
  onDownload: () => void
}) {
  const [searchKeyword, setSearchKeyword] = useState('')
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({})
  const { copied, copyText } = useCopyFeedback(1500)

  const selectedFile = useMemo(
    () => files.find((f) => f.path === selectedFilePath) || files[0] || null,
    [files, selectedFilePath],
  )

  const groupedFiles = useMemo(() => {
    const map = new Map<string, GeneratedFile[]>()
    const kw = searchKeyword.trim().toLowerCase()
    const filtered = kw ? files.filter((f) => f.path.toLowerCase().includes(kw)) : files

    for (const file of filtered) {
      const lastSlash = file.path.lastIndexOf('/')
      const dir = lastSlash === -1 ? '.' : file.path.substring(0, lastSlash)
      const bucket = map.get(dir)
      if (bucket) {
        bucket.push(file)
      } else {
        map.set(dir, [file])
      }
    }

    const groups: DirectoryGroup[] = []
    const processedDirs = new Set<string>()
    for (const knownDir of KNOWN_DIRECTORY_ORDER) {
      const list = map.get(knownDir)
      if (list) {
        groups.push({
          dir: knownDir,
          label: knownDir === '.' ? '根目录文件' : knownDir,
          files: list,
        })
        processedDirs.add(knownDir)
      }
    }
    for (const [dir, list] of map.entries()) {
      if (!processedDirs.has(dir)) {
        groups.push({ dir, label: dir, files: list })
      }
    }
    return groups
  }, [files, searchKeyword])

  const tokenizedLines = useMemo(() => {
    if (!selectedFile) return []
    return selectedFile.content
      .split('\n')
      .map((line) => tokenizeCodeLine(line, selectedFile.path))
  }, [selectedFile])

  const breadcrumbs = useMemo(
    () => (selectedFile ? selectedFile.path.split('/') : []),
    [selectedFile],
  )

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#faf7f0]/40 p-5">
      <div className="flex items-center justify-between pb-3 border-b border-[#e5ded0]">
        <button
          type="button"
          onClick={onBackToConfig}
          className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#1f1f1f] bg-white px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-50 shadow-[1px_1px_0px_#1f1f1f] transition active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          onClick={onDownload}
          disabled={loading}
          className={primaryButtonClass}
        >
          {loading ? '打包中…' : '下载工程 ZIP'}
        </button>
      </div>

      <div className="mt-3 flex flex-1 overflow-hidden rounded-xl border-[1.5px] border-[#1f1f1f] bg-white shadow-[3px_3px_0px_#1f1f1f]">
        <div className="w-64 border-r-[1.5px] border-[#1f1f1f] bg-[#faf7f0] flex flex-col shrink-0">
          <div className="p-2 border-b border-[#e5ded0] bg-white">
            <div className="relative">
              <input
                type="text"
                aria-label="搜索生成文件"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索文件..."
                className="w-full rounded-lg border-[1.5px] border-[#1f1f1f] bg-[#faf7f0] px-2.5 py-1 text-xs font-mono text-stone-800 placeholder-stone-400 focus:border-[#df4e3e] focus:bg-white focus:outline-none"
              />
              {searchKeyword && (
                <button
                  type="button"
                  aria-label="清除搜索"
                  onClick={() => setSearchKeyword('')}
                  className="absolute right-2 top-1 text-stone-400 hover:text-stone-700 text-xs font-bold cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2 font-mono text-xs [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
            {groupedFiles.map((group) => {
              const isCollapsed = collapsedDirs[group.dir]
              return (
                <div key={group.dir} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedDirs((prev) => ({ ...prev, [group.dir]: !prev[group.dir] }))
                    }
                    className="flex items-center justify-between w-full rounded-md px-2 py-1 text-left text-[11px] font-bold text-stone-700 hover:bg-[#ede3d5] transition select-none cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-[10px] text-stone-400">{isCollapsed ? '▸' : '▾'}</span>
                      <IconFolder open={!isCollapsed} />
                      <span className="truncate">{group.label}</span>
                    </div>
                    <span className="text-[10px] text-stone-500 bg-stone-200/80 px-1.5 py-0.2 rounded shrink-0">
                      {group.files.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="pl-3.5 space-y-0.5 border-l-[1.5px] border-stone-200 ml-2">
                      {group.files.map((file) => {
                        const active = file.path === selectedFile?.path
                        const lastSlash = file.path.lastIndexOf('/')
                        const fileName =
                          lastSlash === -1 ? file.path : file.path.substring(lastSlash + 1)
                        return (
                          <button
                            key={file.path}
                            type="button"
                            onClick={() => onSelectFile(file.path)}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition text-[11px] cursor-pointer ${
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

        <div className="flex-1 flex flex-col overflow-hidden bg-white text-[#1f1f1f]">
          <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-[#faf7f0] px-4 py-2 shrink-0 select-none">
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <IconFile path={selectedFile?.path || ''} />
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1
                return (
                  <div key={idx} className="flex items-center gap-1.5">
                    {idx > 0 && <span className="text-stone-300 font-light">/</span>}
                    <span
                      className={
                        isLast ? 'font-bold text-[#df4e3e]' : 'text-stone-600 font-medium'
                      }
                    >
                      {crumb}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-3">
              <div className="text-[11px] font-mono text-stone-400">
                <span>{tokenizedLines.length} 行</span>
                <span className="mx-1.5">·</span>
                <span>{selectedFile?.size || 0} B</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (selectedFile) void copyText(selectedFile.content)
                }}
                className="flex items-center gap-1 rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1 text-xs font-bold text-[#1f1f1f] hover:bg-stone-50 shadow-2xs transition active:scale-95 cursor-pointer"
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

          <div className="flex-1 overflow-auto font-mono text-xs leading-relaxed selection:bg-[#df4e3e] selection:text-white [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
            <div className="min-w-full inline-block py-2">
              {tokenizedLines.map((tokens, lineIdx) => (
                <div
                  key={lineIdx}
                  className="flex hover:bg-[#faf7f0] transition-colors group leading-6"
                >
                  <span className="w-12 select-none pr-3 text-right font-mono text-[11px] text-stone-400 group-hover:text-stone-700 bg-[#f4ede2] sticky left-0 shrink-0 border-r-[1.5px] border-[#e5ded0]">
                    {lineIdx + 1}
                  </span>
                  <span className="pl-3.5 pr-6 font-mono text-[12px] whitespace-pre text-[#1f1f1f]">
                    {tokens.length === 0
                      ? ' '
                      : tokens.map((token, tokIdx) => {
                          const cls = TOKEN_CLASS_MAP[token.type]
                          return cls ? (
                            <span key={tokIdx} className={cls}>
                              {token.text}
                            </span>
                          ) : (
                            <span key={tokIdx}>{token.text}</span>
                          )
                        })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
