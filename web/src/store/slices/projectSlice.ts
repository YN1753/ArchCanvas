import type { StateCreator } from 'zustand'

import { api, type GetModelsParams, type SaveModelParams } from '../../api/client'
import { ensureLayout } from '../../flow/layout'
import { emptyConceptualDesign } from '../../types/dsl'
import type { ProjectSlice, Store } from '../types'
import { errorMessage, loadChenPositions } from '../utils'

let isBootstrapping = false
let projectSwitchSeq = 0

export const createProjectSlice: StateCreator<Store, [], [], ProjectSlice> = (set, get) => ({
  ready: false,
  bootError: null,
  projects: [],
  project: null,

  models: [],
  providers: [],
  selectedModel: null,
  modelsLoading: false,
  modelsError: null,

  async fetchModels(params?: GetModelsParams) {
    set({ modelsLoading: true, modelsError: null })
    try {
      const res = await api.getModels(params)
      const models = res.models ?? []
      const providers = res.providers ?? []
      let selectedModel = get().selectedModel

      if (
        params?.base_url ||
        !selectedModel ||
        !models.some(
          (m) => m.provider === selectedModel?.provider && m.model === selectedModel?.model,
        )
      ) {
        if (res.default_provider && res.default_model) {
          const found = models.find(
            (m) => m.provider === res.default_provider && m.model === res.default_model,
          )
          selectedModel = {
            provider: res.default_provider,
            model: res.default_model,
            base_url: found?.base_url,
          }
        } else if (models.length > 0) {
          selectedModel = {
            provider: models[0].provider,
            model: models[0].model,
            base_url: models[0].base_url,
          }
        }
      }

      set({ models, providers, selectedModel, modelsLoading: false })
      return res
    } catch (error) {
      const msg = errorMessage(error)
      set({ modelsLoading: false, modelsError: msg })
      console.warn('获取可用模型列表失败:', error)
      return null
    }
  },

  selectModel(provider: string, model: string, base_url?: string) {
    set({ selectedModel: { provider, model, base_url } })
    const targetBaseURL =
      base_url ||
      get().providers.find((p) => p.name === provider)?.base_url ||
      get().models.find((m) => m.provider === provider && m.model === model)?.base_url ||
      ''
    if (targetBaseURL) {
      api
        .saveModel({
          provider,
          model,
          base_url: targetBaseURL,
          set_as_default: true,
        })
        .then((res) => {
          if (res && res.models) {
            set({
              models: res.models,
              providers: res.providers || get().providers,
            })
          }
        })
        .catch((err) => {
          console.warn('同步保存模型至 config.yaml 失败:', err)
        })
    }
  },

  async saveAndSwitchModel(params: SaveModelParams): Promise<boolean> {
    set({ modelsLoading: true, modelsError: null })
    try {
      const res = await api.saveModel(params)
      const models = res.models ?? []
      const providers = res.providers ?? []
      set({
        models,
        providers,
        selectedModel: {
          provider: params.provider,
          model: params.model,
          base_url: params.base_url,
        },
        modelsLoading: false,
        toast: {
          kind: 'info',
          text: `已成功写入 config.yaml 并切换生效模型：${params.provider}::${params.model}`,
        },
      })
      return true
    } catch (error) {
      const msg = errorMessage(error)
      set({ modelsLoading: false, modelsError: msg })
      set({ toast: { kind: 'error', text: `保存模型配置失败: ${msg}` } })
      return false
    }
  },

  async bootstrap() {
    if (isBootstrapping || (get().ready && !get().bootError)) {
      return
    }
    isBootstrapping = true
    const seq = ++projectSwitchSeq
    try {
      void get().fetchModels()
      let projects = await api.listProjects()
      if (projects.length === 0) {
        await api.createProject('新项目', '默认 ER 设计项目')
        projects = await api.listProjects()
      }
      const project = projects[0]
      const [detail, design] = await Promise.all([
        api.getProject(project.id),
        api.getERDesign(project.id),
      ])
      if (seq !== projectSwitchSeq) return

      const conceptualDesign =
        detail.conceptual_design && detail.conceptual_design.concepts && detail.conceptual_design.concepts.length > 0
          ? detail.conceptual_design
          : emptyConceptualDesign()
      const initialAgentPhase: 'idle' | 'concept_ready' =
        conceptualDesign.concepts.length > 0 && design.entities.length === 0 ? 'concept_ready' : 'idle'
      get().resetHistory()
      set({
        ready: true,
        bootError: null,
        projects,
        project: detail,
        conceptualDesign,
        agentPhase: initialAgentPhase,
        reviewReport: null,
        chenPositions: loadChenPositions(project.id),
        selection: null,
        inspectorOpen: false,
      })
      get().recompute(ensureLayout(design))
      void get().fetchProjectMessages(project.id)
    } catch (error) {
      if (seq === projectSwitchSeq) {
        set({ ready: true, bootError: errorMessage(error) })
      }
    } finally {
      isBootstrapping = false
    }
  },

  async retryBootstrap() {
    set({ ready: false, bootError: null })
    await get().bootstrap()
  },

  async selectProject(id) {
    if (get().project?.id === id) return
    const seq = ++projectSwitchSeq
    if (get().aiRunning) {
      get().stopAI()
    }
    // 1. 切换前先等待当前项目未落库的防抖/在途变更完整刷盘
    if (get().project) {
      try {
        await get().saveNow()
      } catch (err) {
        console.warn('切换项目前自动保存失败:', err)
      }
    }
    if (seq !== projectSwitchSeq) return

    try {
      const [detail, design] = await Promise.all([api.getProject(id), api.getERDesign(id)])
      if (seq !== projectSwitchSeq) return

      const conceptualDesign =
        detail.conceptual_design && detail.conceptual_design.concepts && detail.conceptual_design.concepts.length > 0
          ? detail.conceptual_design
          : emptyConceptualDesign()
      const initialAgentPhase: 'idle' | 'concept_ready' =
        conceptualDesign.concepts.length > 0 && design.entities.length === 0 ? 'concept_ready' : 'idle'
      get().resetHistory()
      set({
        project: detail,
        conceptualDesign,
        agentPhase: initialAgentPhase,
        chenPositions: loadChenPositions(id),
        selection: null,
        inspectorOpen: false,
        serverWarnings: [],
        aiResult: null,
        aiError: null,
        reviewReport: null,
        messages: [],
        messagesLoading: true,
        aiThinking: '',
        aiStatus: '',
      })
      get().recompute(ensureLayout(design))
      void get().fetchProjectMessages(id)
    } catch (error) {
      if (seq === projectSwitchSeq) {
        set({ toast: { kind: 'error', text: errorMessage(error) } })
      }
    }
  },

  async createProject(name, description = '') {
    const seq = ++projectSwitchSeq
    if (get().aiRunning) {
      get().stopAI()
    }
    // 1. 创建新项目前先将当前项目未落库的变更完整保存
    if (get().project) {
      try {
        await get().saveNow()
      } catch (err) {
        console.warn('新建项目前自动保存失败:', err)
      }
    }
    if (seq !== projectSwitchSeq) return

    try {
      const project = await api.createProject(name, description)
      const projects = await api.listProjects()
      if (seq !== projectSwitchSeq) return

      get().resetHistory()
      set({
        projects,
        project,
        conceptualDesign: emptyConceptualDesign(),
        agentPhase: 'idle',
        reviewReport: null,
        chenPositions: {},
        selection: null,
        inspectorOpen: false,
        aiResult: null,
        aiError: null,
        messages: [],
        messagesLoading: false,
        aiThinking: '',
        aiStatus: '',
      })
      get().recompute({ entities: [], relations: [] })
      set({ toast: { kind: 'info', text: `已成功创建项目「${name}」` } })
    } catch (error) {
      if (seq === projectSwitchSeq) {
        set({ toast: { kind: 'error', text: errorMessage(error) } })
      }
    }
  },

  async deleteProject(id) {
    if (get().project?.id === id) {
      if (get().aiRunning) {
        get().stopAI()
      }
      get().resetHistory()
    }
    try {
      await api.deleteProject(id)
      try {
        localStorage.removeItem(`archcanvas_chen_pos_${id}`)
      } catch {}
      let projects = await api.listProjects()
      if (projects.length === 0) {
        const created = await api.createProject('新项目')
        projects = [created]
      }
      const current = get().project
      const nextProject = projects.find((p) => p.id !== id) || projects[0]
      set({ projects })
      if (!current || current.id === id) {
        await get().selectProject(nextProject.id)
      }
      set({ toast: { kind: 'info', text: '项目已成功删除' } })
    } catch (error) {
      set({ toast: { kind: 'error', text: `删除项目失败: ${errorMessage(error)}` } })
    }
  },

  async updateProject(id, name, description) {
    try {
      const updated = await api.updateProject(id, name, description)
      const projects = get().projects.map((p) => (p.id === id ? { ...p, ...updated } : p))
      const current = get().project
      set({
        projects,
        project: current?.id === id ? { ...current, ...updated } : current,
        toast: { kind: 'info', text: `项目已更名为「${name}」` },
      })
    } catch (error) {
      set({ toast: { kind: 'error', text: `更新项目失败: ${errorMessage(error)}` } })
    }
  },
})
