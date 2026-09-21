import { useEffect, useState } from 'react'

import { useStore } from '../store/erStore'
import Select from './Select'

interface ModelModalProps {
  onClose: () => void
}

interface PresetProvider {
  name: string
  label: string
  baseURL: string
  placeholderKey: string
  isLocal?: boolean
}

const PRESETS: PresetProvider[] = [
  {
    name: 'deepseek',
    label: 'DeepSeek 官方',
    baseURL: 'https://api.deepseek.com/v1',
    placeholderKey: '留空则使用 .env 中的 DEEPSEEK_API_KEY',
  },
  {
    name: 'openai',
    label: 'OpenAI 官方 / 代理',
    baseURL: 'https://api.ssstoken.net/v1',
    placeholderKey: '留空则使用 .env 中的 SSSTOKEN_API_KEY',
  },
  {
    name: 'ollama',
    label: '本地 Ollama',
    baseURL: 'http://localhost:11434/v1',
    placeholderKey: '本地服务无需 API Key',
    isLocal: true,
  },
  {
    name: 'siliconflow',
    label: 'SiliconFlow 硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    placeholderKey: 'sk-xxxxxxxx',
  },
]

export default function ModelModal({ onClose }: ModelModalProps) {
  const providers = useStore((state) => state.providers)
  const models = useStore((state) => state.models)
  const selectedModel = useStore((state) => state.selectedModel)
  const fetchModels = useStore((state) => state.fetchModels)
  const saveAndSwitchModel = useStore((state) => state.saveAndSwitchModel)
  const modelsLoading = useStore((state) => state.modelsLoading)

  // 默认激活当前选中的 provider
  const initialProvider = selectedModel?.provider || providers[0]?.name || 'deepseek'
  const initialCfg = providers.find((p) => p.name === initialProvider)

  const [provider, setProvider] = useState(initialProvider)
  const [baseURL, setBaseURL] = useState(
    selectedModel?.base_url || initialCfg?.base_url || 'https://api.deepseek.com/v1'
  )
  const [apiKey, setApiKey] = useState('')
  const [setAsDefault, setSetAsDefault] = useState(true)

  // 从当前 BaseURL 实际拉取到的模型列表（严禁任意手打，只能从这里选）
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [selectedFetchedModel, setSelectedFetchedModel] = useState<string>(
    selectedModel?.model || initialCfg?.default_model || ''
  )

  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // 初始化时，如果当前 Provider 在全局已有模型列表，先预填
  useEffect(() => {
    const existing = models
      .filter((m) => m.provider === provider)
      .map((m) => m.model)
    if (existing.length > 0) {
      setFetchedModels(existing)
      if (selectedModel?.provider === provider && existing.includes(selectedModel.model)) {
        setSelectedFetchedModel(selectedModel.model)
      } else if (!existing.includes(selectedFetchedModel)) {
        setSelectedFetchedModel(existing[0])
      }
    }
  }, [provider])

  function handleSelectProvider(pName: string) {
    setProvider(pName)
    setError(null)
    setSuccessMsg(null)
    const found = providers.find((p) => p.name === pName)
    if (found) {
      setBaseURL(found.base_url)
      setSelectedFetchedModel(found.default_model)
    } else {
      const preset = PRESETS.find((p) => p.name === pName)
      if (preset) {
        setBaseURL(preset.baseURL)
      }
    }
    const existing = models.filter((m) => m.provider === pName).map((m) => m.model)
    setFetchedModels(existing)
    if (existing.length > 0) {
      setSelectedFetchedModel(existing[0])
    } else {
      setSelectedFetchedModel('')
    }
  }

  // 借鉴 CC-Switch：向 baseURL + /models 发送真实请求拉取模型
  async function handleFetch() {
    const url = baseURL.trim()
    if (!url) {
      setError('请输入有效的 Base URL 地址')
      return
    }

    setError(null)
    setSuccessMsg(null)
    setFetching(true)

    try {
      const res = await fetchModels({
        base_url: url,
        api_key: apiKey.trim() || undefined,
        provider: provider.trim() || undefined,
      })

      if (res && res.models.length > 0) {
        const modelNames = res.models.map((m) => m.model)
        setFetchedModels(modelNames)
        // 自动选择第一个或保留已选
        if (!modelNames.includes(selectedFetchedModel)) {
          setSelectedFetchedModel(modelNames[0])
        }
        setSuccessMsg(
          `⚡ 成功从 ${url}/models 拉取到 ${modelNames.length} 个可用模型！请在下方下拉菜单中选用。`
        )
      } else {
        setFetchedModels([])
        setSelectedFetchedModel('')
        setError('从该 BaseURL 未能解析到可用模型，请检查服务地址是否支持 /models 端点。')
      }
    } catch (err: any) {
      setError(err?.message || '获取模型失败，请检查网络、BaseURL 与 API Key。')
    } finally {
      setFetching(false)
    }
  }

  // 保存并写入 config.yaml
  async function handleSaveAndApply() {
    if (!provider.trim()) {
      setError('请输入供应商标识 (Provider)')
      return
    }
    if (!baseURL.trim()) {
      setError('请输入 Base URL')
      return
    }
    if (!selectedFetchedModel.trim()) {
      setError('请先从拉取的可用模型列表中选择一个模型（禁止手动输入）')
      return
    }

    setSaving(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const ok = await saveAndSwitchModel({
        provider: provider.trim(),
        model: selectedFetchedModel.trim(),
        base_url: baseURL.trim(),
        api_key: apiKey.trim() || undefined,
        set_as_default: setAsDefault,
      })

      if (ok) {
        setSuccessMsg(
          `💾 成功写入 configs/config.yaml 与 .env！当前生效模型已热切换为：${provider}::${selectedFetchedModel}`
        )
        setTimeout(() => {
          onClose()
        }, 1200)
      }
    } catch (err: any) {
      setError(err?.message || '保存模型配置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/80">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">模型与供应商配置 (CC-Switch 模式)</h2>
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                写回 config.yaml
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              通过 <code className="font-mono text-indigo-600 font-semibold">{baseURL || 'BaseURL'}/models</code>{' '}
              拉取真实模型，下拉选择后实时更新配置文件与运行态。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs no-scrollbar">
          {/* Provider 切换与预设 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-slate-700">
                选择供应商或常用预设：
              </label>
              <button
                type="button"
                onClick={() => {
                  const customName = `custom-${Date.now().toString().slice(-4)}`
                  setProvider(customName)
                  setBaseURL('http://localhost:11434/v1')
                  setFetchedModels([])
                  setSelectedFetchedModel('')
                  setError(null)
                  setSuccessMsg(null)
                }}
                className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                + 添加自定义服务商
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRESETS.map((p) => {
                const isActive = provider === p.name
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => handleSelectProvider(p.name)}
                    className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition ${
                      isActive
                        ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-200 text-indigo-900 shadow-xs'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-semibold text-xs truncate w-full">{p.label}</span>
                    <span className="text-[10px] text-slate-400 truncate w-full mt-0.5">
                      {p.name}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 表单配置：BaseURL、API Key、Provider 标识 */}
          <div className="space-y-3.5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  供应商标识 (ID)：<span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="如 deepseek、ollama"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Base URL (服务请求根地址)：<span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder="例如: https://api.deepseek.com/v1 或 http://localhost:11434/v1"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                API Key（留空则沿用原有密钥配置；本地 Ollama 免填）：
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
              />
            </div>

            {/* CC-Switch 核心按键：拉取模型 */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => void handleFetch()}
                disabled={fetching || modelsLoading || !baseURL.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300 shadow-sm"
              >
                {fetching || modelsLoading ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>正在向 {baseURL}/models 探测可用模型...</span>
                  </>
                ) : (
                  <>
                    <span>⚡ 拉取可用模型 (GET /models)</span>
                    <span className="text-[10px] text-slate-300">自动探测接口</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 状态与告警提示 */}
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700 leading-relaxed">
              <span className="font-semibold">操作提示：</span>
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800 leading-relaxed font-medium">
              {successMsg}
            </div>
          )}

          {/* CC-Switch 严格模型选择区域：杜绝手打，只允许从拉取结果中下拉选择 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-bold text-slate-800">
                  选择使用的模型 (只允许下拉选择，禁止手打)：
                </label>
                {fetchedModels.length > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    已拉取 {fetchedModels.length} 个
                  </span>
                )}
              </div>
            </div>

            {fetchedModels.length === 0 ? (
              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-4 text-center text-amber-800 space-y-1">
                <div className="font-medium text-xs">⚠️ 尚未拉取到可用模型</div>
                <div className="text-[11px] text-amber-600">
                  请先点击上方的「⚡ 拉取可用模型」按钮，系统将向目标 BaseURL 查询真实支持的模型列表。
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Select
                  size="md"
                  className="w-full"
                  value={selectedFetchedModel}
                  onChange={(val) => setSelectedFetchedModel(val)}
                  options={fetchedModels.map((name) => ({
                    value: name,
                    label: name,
                    sublabel: `${provider} · 可用`,
                    badge: name === initialCfg?.default_model ? '当前默认' : undefined,
                  }))}
                  placeholder="请从已拉取的模型中选择..."
                />

                <div className="text-[11px] text-slate-400">
                  选中的模型将作为该供应商在 <code className="font-mono text-slate-600">config.yaml</code> 中的 <code className="font-mono text-indigo-600 font-semibold">default_model</code>。
                </div>
              </div>
            )}

            {/* 设为默认与写入 config.yaml 选项 */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={setAsDefault}
                  onChange={(e) => setSetAsDefault(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-700 font-medium">
                  设为系统当前全局生效模型（写入 config.yaml 与 .env）
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 bg-slate-50/80">
          <div className="text-[11px] text-slate-400">
            当前使用中：
            <span className="font-mono font-medium text-slate-600 ml-1">
              {selectedModel ? `${selectedModel.provider}::${selectedModel.model}` : '未指定'}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition shadow-2xs"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSaveAndApply()}
              disabled={saving || !selectedFetchedModel || fetchedModels.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 shadow-sm"
            >
              {saving ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>正在写入 config.yaml...</span>
                </>
              ) : (
                <>
                  <span>💾 保存配置并写入 config.yaml</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
