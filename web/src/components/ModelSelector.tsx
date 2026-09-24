import { useState, useRef, useEffect, useMemo } from 'react'
import { useStore } from '../store/erStore'
import Select from './Select'

interface PresetConfig {
  name: string
  label: string
  baseURL: string
  suggestedModels: string[]
  placeholderKey: string
  isLocal?: boolean
}

const PRESETS: PresetConfig[] = [
  {
    name: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash'],
    placeholderKey: '留空使用原有配置或输入 sk-...',
  },
  {
    name: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.ssstoken.net/v1',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
    placeholderKey: '留空使用原有配置或输入 sk-...',
  },
  {
    name: 'ollama',
    label: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    suggestedModels: ['qwen2.5-coder', 'deepseek-r1', 'llama3.1'],
    placeholderKey: '本地服务无需 API Key',
    isLocal: true,
  },
  {
    name: 'custom',
    label: '自定义',
    baseURL: 'https://api.example.com/v1',
    suggestedModels: [],
    placeholderKey: 'sk-xxxxxxxx',
  },
]

export default function ModelSelector({
  compact: _compact = false,
  className = '',
}: {
  compact?: boolean
  className?: string
}) {
  const models = useStore((state) => state.models)
  const providers = useStore((state) => state.providers)
  const selectedModel = useStore((state) => state.selectedModel)
  const selectModel = useStore((state) => state.selectModel)
  const saveAndSwitchModel = useStore((state) => state.saveAndSwitchModel)
  const fetchModels = useStore((state) => state.fetchModels)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'config'>('list')
  const popoverRef = useRef<HTMLDivElement>(null)

  // 配置表单状态
  const [selectedProvider, setSelectedProvider] = useState('deepseek')
  const [customProviderName, setCustomProviderName] = useState('')
  const [baseURL, setBaseURL] = useState('https://api.deepseek.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelName, setModelName] = useState('deepseek-chat')
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [detectedModels, setDetectedModels] = useState<string[]>([])
  const [isManualInput, setIsManualInput] = useState(false)

  // 点击外部收起浮层
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false)
        setView('list')
        setStatusMsg(null)
        setDetectedModels([])
        setIsManualInput(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  // 打开配置视图时预填当前选中的 Provider
  const handleOpenConfig = (pName?: string) => {
    const targetP = pName || selectedModel?.provider || 'deepseek'
    const preset = PRESETS.find((p) => p.name === targetP) || PRESETS[3]
    setSelectedProvider(preset.name)
    if (preset.name === 'custom') {
      setCustomProviderName(targetP)
    }

    const foundProvider = providers.find((p) => p.name === targetP)
    setBaseURL(selectedModel?.base_url || foundProvider?.base_url || preset.baseURL)
    setModelName(selectedModel?.model || foundProvider?.default_model || preset.suggestedModels[0] || '')
    setApiKey('')
    setStatusMsg(null)
    setDetectedModels([])
    setIsManualInput(false)
    setView('config')
  }

  // 切换 Provider Tab
  const handleSelectTab = (pName: string) => {
    setSelectedProvider(pName)
    setStatusMsg(null)
    setDetectedModels([])
    setIsManualInput(false)
    const preset = PRESETS.find((p) => p.name === pName)
    if (preset) {
      const found = providers.find((p) => p.name === pName)
      setBaseURL(found?.base_url || preset.baseURL)
      setModelName(found?.default_model || preset.suggestedModels[0] || '')
    }
  }

  // 探测模型
  const handleDetect = async () => {
    if (!baseURL.trim()) return
    setDetecting(true)
    setStatusMsg(null)
    try {
      const providerKey = selectedProvider === 'custom' ? customProviderName.trim() || 'custom' : selectedProvider
      const res = await fetchModels({
        base_url: baseURL.trim(),
        api_key: apiKey.trim() || undefined,
        provider: providerKey,
      })
      if (res && res.models && res.models.length > 0) {
        const uniqueModels = Array.from(new Set(res.models.map((m) => m.model)))
        setDetectedModels(uniqueModels)
        setIsManualInput(false)

        if (uniqueModels.includes(modelName)) {
          // 当前模型恰好在探测结果中，保留该选中状态
          setStatusMsg({ type: 'success', text: `成功获取到 ${uniqueModels.length} 个模型，已保持当前模型` })
        } else {
          // 不再默认首个，清空让用户通过下拉列表主动选择
          setModelName('')
          setStatusMsg({ type: 'success', text: `成功获取到 ${uniqueModels.length} 个模型，请在下方下拉菜单中选择` })
        }
      } else {
        setStatusMsg({ type: 'error', text: '未能从该服务地址解析到可用模型' })
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || '探测失败，请检查地址或密钥' })
    } finally {
      setDetecting(false)
    }
  }

  // 保存并生效
  const handleSave = async () => {
    const finalProvider = selectedProvider === 'custom' ? customProviderName.trim() || 'custom' : selectedProvider
    const finalBaseURL = baseURL.trim()
    const finalModel = modelName.trim()

    if (!finalBaseURL) {
      setStatusMsg({ type: 'error', text: '服务地址 Base URL 不能为空' })
      return
    }
    if (!finalModel) {
      setStatusMsg({
        type: 'error',
        text: detectedModels.length > 0 && !isManualInput ? '请在下拉菜单中选择一个生效模型' : '模型名称不能为空',
      })
      return
    }

    setSaving(true)
    setStatusMsg(null)
    try {
      const ok = await saveAndSwitchModel({
        provider: finalProvider,
        base_url: finalBaseURL,
        model: finalModel,
        api_key: apiKey.trim() || undefined,
        set_as_default: true,
      })
      if (ok) {
        setOpen(false)
        setView('list')
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const currentDisplayName = selectedModel?.model || '选择模型'
  const currentProvider = selectedModel?.provider || 'AI'
  const activePreset = PRESETS.find((p) => p.name === selectedProvider)

  // 按服务商对可用模型进行分组
  const groupedModels = useMemo(() => {
    const groups: Record<string, typeof models> = {}
    for (const item of models) {
      const p = item.provider || 'default'
      if (!groups[p]) groups[p] = []
      groups[p].push(item)
    }
    return groups
  }, [models])

  const modelOptions = useMemo(() => {
    return detectedModels.map((m) => ({
      value: m,
      label: m,
    }))
  }, [detectedModels])

  return (
    <div className={`relative ${className}`} ref={popoverRef}>
      {/* 紧凑模型胶囊选择按钮 */}
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev)
          if (!open) setView('list')
        }}
        className="flex items-center gap-1.5 rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1 text-xs text-[#1f1f1f] shadow-[1.5px_1.5px_0px_#1f1f1f] hover:bg-stone-50 transition active:translate-x-0.5 active:translate-y-0.5 select-none"
        title={`当前模型: ${currentDisplayName} (${currentProvider}) · 点击切换`}
      >
        <span className="max-w-[130px] truncate font-mono text-[11px] font-semibold text-[#1f1f1f] leading-none">
          {currentDisplayName}
        </span>
        <svg
          className={`w-3 h-3 text-stone-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 悬浮气泡面板 (Dock Popover) - 精确右偏移以居中于侧边栏，防止左侧裁剪 */}
      {open ? (
        <div className="absolute bottom-full right-[-34px] z-40 mb-2.5 w-[314px] rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-3 shadow-[4px_4px_0px_#1f1f1f] animate-in fade-in zoom-in-95 duration-100 select-none">
          {view === 'list' ? (
            /* ================= 视图 1: 快捷模型切换 ================= */
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#1f1f1f]">切换推理模型</span>
                  {models.length > 0 && (
                    <span className="rounded bg-stone-100 px-1.5 py-0.2 text-[10px] font-mono text-stone-500">
                      {models.length}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 text-stone-400 hover:text-[#1f1f1f] hover:bg-stone-100 transition"
                  title="关闭"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 模型列表 */}
              <div className="my-2 max-h-60 overflow-y-auto space-y-2 no-scrollbar py-0.5">
                {models.length === 0 ? (
                  <div className="py-6 text-center text-xs text-stone-400">暂无模型，请在下方配置</div>
                ) : (
                  Object.entries(groupedModels).map(([providerName, providerModels]) => (
                    <div key={providerName} className="space-y-1">
                      <div className="flex items-center gap-1.5 px-1 pt-1 pb-0.5 select-none">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 font-mono">
                          {providerName}
                        </span>
                        <div className="h-[1px] flex-1 bg-stone-100" />
                      </div>
                      <div className="space-y-0.5">
                        {providerModels.map((item) => {
                          const isSelected =
                            selectedModel?.provider === item.provider && selectedModel?.model === item.model
                          return (
                            <button
                              key={`${item.provider}::${item.model}`}
                              type="button"
                              onClick={() => {
                                selectModel(item.provider, item.model, item.base_url)
                                setOpen(false)
                              }}
                              className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left transition select-none ${
                                isSelected
                                  ? 'bg-[#faf7f0] text-[#1f1f1f] font-bold border-[1.5px] border-[#1f1f1f] shadow-[1.5px_1.5px_0px_#1f1f1f]'
                                  : 'text-stone-700 hover:text-[#1f1f1f] hover:bg-stone-100 border border-transparent'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                {isSelected ? (
                                  <svg className="w-3.5 h-3.5 text-[#df4e3e] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.6}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <span className="w-3.5 shrink-0" />
                                )}
                                <span className="truncate font-mono text-[11px]">{item.model}</span>
                              </div>

                              {isSelected && (
                                <span className="text-[9px] font-mono font-bold text-[#df4e3e] bg-[#fdf0ee] border border-[#df4e3e]/30 px-1.5 py-0.2 rounded shrink-0 ml-1.5">
                                  激活中
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* 底部设置入口 */}
              <div className="pt-2 border-t border-stone-200 mt-1">
                <button
                  type="button"
                  onClick={() => handleOpenConfig()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 py-1.5 text-xs font-semibold text-stone-700 hover:border-[#1f1f1f] hover:bg-white hover:text-[#1f1f1f] hover:shadow-[1.5px_1.5px_0px_#1f1f1f] transition active:translate-x-0.5 active:translate-y-0.5"
                >
                  <svg className="w-3.5 h-3.5 text-stone-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>配置服务商与密钥…</span>
                </button>
              </div>
            </div>
          ) : (
            /* ================= 视图 2: 极简服务商配置 ================= */
            <div className="space-y-3">
              {/* 头部导航 */}
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <button
                  type="button"
                  onClick={() => {
                    setView('list')
                    setStatusMsg(null)
                  }}
                  className="flex items-center gap-1 text-xs text-stone-600 hover:text-[#1f1f1f] font-medium transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>返回</span>
                </button>
                <span className="text-xs font-bold text-[#1f1f1f]">服务商与密钥设置</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-stone-400 hover:text-[#1f1f1f] transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 极简分段标签选择 Provider */}
              <div className="flex items-center rounded-lg bg-stone-100 p-0.5 border-[1.5px] border-[#1f1f1f]">
                {PRESETS.map((p) => {
                  const active = selectedProvider === p.name
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => handleSelectTab(p.name)}
                      className={`flex-1 py-1 text-[11px] font-bold rounded transition ${
                        active
                          ? 'bg-white text-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f]'
                          : 'text-stone-500 hover:text-[#1f1f1f]'
                      }`}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>

              {/* 自定义厂商时输入 ID */}
              {selectedProvider === 'custom' ? (
                <div>
                  <label className="block text-[10px] font-bold text-stone-600 mb-0.5">
                    服务商标识 (ID)
                  </label>
                  <input
                    type="text"
                    value={customProviderName}
                    onChange={(e) => setCustomProviderName(e.target.value)}
                    placeholder="例如 siliconflow 或 vllm"
                    className="w-full rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1 text-xs font-mono outline-none focus:border-[#df4e3e] focus:ring-1 focus:ring-[#df4e3e]/20 shadow-[1px_1px_0px_#1f1f1f]"
                  />
                </div>
              ) : null}

              {/* Base URL */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-bold text-stone-600">服务地址 (Base URL)</label>
                  <button
                    type="button"
                    onClick={() => void handleDetect()}
                    disabled={detecting || !baseURL.trim()}
                    className="text-[10px] font-bold text-[#df4e3e] hover:underline disabled:opacity-50"
                  >
                    {detecting ? '探测中…' : '探测模型'}
                  </button>
                </div>
                <input
                  type="text"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1 text-xs font-mono outline-none focus:border-[#df4e3e] focus:ring-1 focus:ring-[#df4e3e]/20 shadow-[1px_1px_0px_#1f1f1f]"
                />
              </div>

              {/* API Key */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-bold text-stone-600">API Key 密钥</label>
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="text-[10px] text-stone-400 hover:text-[#1f1f1f]"
                  >
                    {showApiKey ? '隐藏' : '显示'}
                  </button>
                </div>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={activePreset?.placeholderKey}
                  className="w-full rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1 text-xs font-mono outline-none focus:border-[#df4e3e] focus:ring-1 focus:ring-[#df4e3e]/20 shadow-[1px_1px_0px_#1f1f1f]"
                />
              </div>

              {/* 生效模型名称 */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-bold text-stone-600">
                      生效模型 (Model)
                    </label>
                    {detectedModels.length > 0 && !isManualInput && (
                      <span className="rounded bg-[#fdf0ee] border border-[#df4e3e]/30 px-1 py-0.2 text-[9px] font-bold text-[#df4e3e]">
                        已获取 {detectedModels.length} 个
                      </span>
                    )}
                  </div>

                  {detectedModels.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsManualInput((prev) => !prev)}
                      className="text-[10px] font-bold text-[#df4e3e] hover:underline"
                    >
                      {isManualInput ? '从探测列表选择' : '切换手动输入'}
                    </button>
                  )}
                </div>

                {detectedModels.length > 0 && !isManualInput ? (
                  <Select
                    className="w-full font-mono text-xs"
                    dropdownClassName="max-h-52 font-mono text-xs"
                    value={modelName}
                    onChange={(val) => setModelName(val)}
                    options={modelOptions}
                    placeholder={`-- 请下拉选择探测到的模型 (${detectedModels.length}个) --`}
                    placement="top"
                    searchable={detectedModels.length > 6}
                  />
                ) : (
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="如 deepseek-chat 或 gpt-4o"
                    className="w-full rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-2.5 py-1 text-xs font-mono outline-none focus:border-[#df4e3e] focus:ring-1 focus:ring-[#df4e3e]/20 shadow-[1px_1px_0px_#1f1f1f] mb-1"
                  />
                )}

                {/* 常用预设快捷药丸（在未探测或切到手动输入时展示） */}
                {(!detectedModels.length || isManualInput) && activePreset && activePreset.suggestedModels.length > 0 ? (
                  <div className="flex items-center gap-1 flex-wrap mt-1">
                    {activePreset.suggestedModels.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setModelName(m)}
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-mono transition ${
                          modelName === m
                            ? 'bg-[#fdf0ee] text-[#df4e3e] font-bold border-[#1f1f1f] shadow-[1px_1px_0px_#1f1f1f]'
                            : 'border-stone-300 bg-white text-stone-600 hover:border-[#1f1f1f]'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* 错误或成功提示 */}
              {statusMsg ? (
                <div
                  className={`rounded-lg p-2 text-[11px] leading-relaxed border-[1.5px] ${
                    statusMsg.type === 'error'
                      ? 'bg-rose-50 text-rose-700 border-rose-300'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  }`}
                >
                  {statusMsg.text}
                </div>
              ) : null}

              {/* 提交按钮 */}
              <div className="pt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border-[1.5px] border-[#1f1f1f] bg-white px-3 py-1 text-xs font-bold text-[#1f1f1f] hover:bg-stone-100 shadow-[1px_1px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !baseURL.trim() || !modelName.trim()}
                  className="flex items-center gap-1.5 rounded-lg border-[1.5px] border-[#1f1f1f] bg-[#df4e3e] px-3.5 py-1 text-xs font-bold text-white hover:bg-[#d04232] disabled:opacity-40 shadow-[2px_2px_0px_#1f1f1f] active:translate-x-[1px] active:translate-y-[1px] transition"
                >
                  {saving ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>保存中…</span>
                    </>
                  ) : (
                    <span>保存并生效</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
