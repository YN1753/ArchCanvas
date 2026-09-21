import { useState } from 'react'

import { useStore } from '../store/erStore'
import ModelModal from './ModelModal'
import Select from './Select'

interface ModelSelectorProps {
  compact?: boolean
  className?: string
}

export default function ModelSelector({ compact = false, className = '' }: ModelSelectorProps) {
  const models = useStore((state) => state.models)
  const selectedModel = useStore((state) => state.selectedModel)
  const selectModel = useStore((state) => state.selectModel)
  const [modalOpen, setModalOpen] = useState(false)

  const currentValue = selectedModel
    ? `${selectedModel.provider}::${selectedModel.model}`
    : ''

  const options = models.map((item) => {
    const val = `${item.provider}::${item.model}`
    return {
      value: val,
      label: item.label || item.model,
      sublabel: item.base_url ? `${item.provider} · ${item.base_url}` : item.provider,
      badge: item.is_default ? '默认' : undefined,
    }
  })

  return (
    <>
      <div className={`flex items-center gap-1.5 ${className}`}>
        <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
          模型:
        </span>

        {models.length === 0 ? (
          <span className="text-[11px] text-slate-400">暂无模型</span>
        ) : (
          <Select
            size={compact ? 'sm' : 'md'}
            className={compact ? 'w-[180px]' : 'w-[210px]'}
            value={currentValue}
            onChange={(val) => {
              const [provider, model] = val.split('::')
              if (provider && model) {
                const found = models.find((m) => m.provider === provider && m.model === model)
                selectModel(provider, model, found?.base_url)
              }
            }}
            options={options}
            placeholder="选择 AI 模型..."
            title="选择当前用于需求分析与 ER 生成的模型"
          />
        )}

        {/* 通过 BaseURL 获取模型的按键 */}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`flex items-center gap-1 rounded border border-slate-300 bg-white font-medium text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/40 shadow-2xs ${
            compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
          }`}
          title="打开 CC-Switch 风格的模型与供应商配置窗口（支持通过 BaseURL + /models 拉取并写入 config.yaml）"
        >
          <span>⚡</span>
          <span>{compact ? '模型' : '模型管理 (CC-Switch)'}</span>
        </button>
      </div>

      {modalOpen && <ModelModal onClose={() => setModalOpen(false)} />}
    </>
  )
}
