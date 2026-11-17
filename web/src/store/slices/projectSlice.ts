import type { StateCreator } from 'zustand'

import {
  api,
  setShowcaseQuotaListener,
  type GetModelsParams,
  type Project,
  type SaveModelParams,
} from '../../api/client'
import { normalizeConceptualDesign } from '../../domain/conceptNormalize'
import { ensureLayout } from '../../flow/layout'
import { emptyConceptualDesign, type ERDesign, type Position } from '../../types/dsl'
import type { ProjectSlice, Store } from '../types'
import { errorMessage, loadChenPositions, saveChenPositions } from '../utils'

export const createProjectSlice: StateCreator<Store, [], [], ProjectSlice> = (set, get) => {
  let isBootstrapping = false
  let projectSwitchSeq = 0
  let inFlightForkPromise: Promise<string | null> | null = null
  let loadProjectsInFlight: Promise<Project[]> | null = null

  function loadProjectsDeduped(): Promise<Project[]> {
    if (loadProjectsInFlight) {
      return loadProjectsInFlight
    }
    const req = api.listProjects().finally(() => {
      loadProjectsInFlight = null
    })
    loadProjectsInFlight = req
    return req
  }
  setShowcaseQuotaListener(({ ipRemaining, globalRemaining }) => {
    const cur = get().showcase
    if (!cur?.enabled) return
    set({
      showcase: {
        ...cur,
        ...(ipRemaining !== undefined
          ? {
              ip_remaining: ipRemaining,
              ip_used:
                cur.ip_daily_limit !== undefined
                  ? Math.max(0, cur.ip_daily_limit - ipRemaining)
                  : cur.ip_used,
            }
          : {}),
        ...(globalRemaining !== undefined
          ? {
              global_remaining: globalRemaining,
              global_used:
                cur.global_daily_limit !== undefined
                  ? Math.max(0, cur.global_daily_limit - globalRemaining)
                  : cur.global_used,
            }
          : {}),
      },
    })
  })

  /**
   * 统一收敛项目载入/切换/新建/Fork 的状态重置与入口规范化，杜绝跨项目残留。
   */
  function applyLoadedProjectState(params: {
    project: Project
    design: ERDesign
    projects?: Project[]
    chenPositions: Record<string, Position>
    loadMessages: boolean
    extras?: Partial<Store>
  }) {
    const { project, design, projects, chenPositions, loadMessages, extras } = params
    const conceptualDesign =
      project.conceptual_design?.concepts && project.conceptual_design.concepts.length > 0
        ? normalizeConceptualDesign(project.conceptual_design)
        : emptyConceptualDesign()
    const initialAgentPhase: 'idle' | 'concept_ready' =
      conceptualDesign.concepts.length > 0 && design.entities.length === 0
        ? 'concept_ready'
        : 'idle'

    get().resetHistory()
    set({
      ...(projects ? { projects } : {}),
      project,
      conceptualDesign,
      agentPhase: initialAgentPhase,
      chenPositions,
      selection: null,
      inspectorOpen: false,
      serverWarnings: [],
      aiResult: null,
      aiError: null,
      reviewReport: null,
      messages: [],
      messagesLoading: loadMessages,
      aiThinking: '',
      aiStatus: '',
      ...extras,
    })
    get().recompute(ensureLayout(design))
    if (loadMessages) {
      void get().fetchProjectMessages(project.id)
    }
  }

  return {
    ready: false,
    bootError: null,
    projects: [],
    project: null,
    showcase: null,
    forkingProject: false,

    models: [],
    providers: [],
    selectedModel: null,

    async fetchShowcaseStatus() {
      try {
        const status = await api.getShowcaseStatus()
        set({ showcase: status })
      } catch {
        // 离线或旧接口未开启时静默忽略
      }
    },

    async fetchModels(params?: GetModelsParams) {
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

        set({ models, providers, selectedModel })
        return res
      } catch (error) {
        console.warn('获取可用模型列表失败:', error)
        return null
      }
    },

    selectModel(provider: string, model: string, base_url?: string) {
      set({ selectedModel: { provider, model, base_url } })
      if (get().showcase?.enabled) {
        return
      }
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
            if (res?.models) {
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
      try {
        const res = await api.saveModel(params)
        set({
          models: res.models ?? [],
          providers: res.providers ?? [],
          selectedModel: {
            provider: params.provider,
            model: params.model,
            base_url: params.base_url,
          },
          toast: {
            kind: 'info',
            text: `已成功写入 config.yaml 并切换生效模型：${params.provider}::${params.model}`,
          },
        })
        return true
      } catch (error) {
        const msg = errorMessage(error)
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
        void get().fetchShowcaseStatus()
        void get().fetchModels()
        let projects = await loadProjectsDeduped()
        if (projects.length === 0) {
          await api.createProject('新项目', '默认 ER 设计项目')
          projects = await loadProjectsDeduped()
        }
        const firstProject = projects[0]
        const [detail, design] = await Promise.all([
          api.getProject(firstProject.id),
          api.getERDesign(firstProject.id),
        ])
        if (seq !== projectSwitchSeq) return

        applyLoadedProjectState({
          project: detail,
          design,
          projects,
          chenPositions: loadChenPositions(firstProject.id),
          loadMessages: true,
          extras: { ready: true, bootError: null },
        })
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

        applyLoadedProjectState({
          project: detail,
          design,
          chenPositions: loadChenPositions(id),
          loadMessages: true,
        })
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
        const projects = await loadProjectsDeduped()
        if (seq !== projectSwitchSeq) return

        applyLoadedProjectState({
          project,
          design: { entities: [], relations: [] },
          projects,
          chenPositions: {},
          loadMessages: false,
          extras: {
            toast: { kind: 'info', text: `已成功创建项目「${name}」` },
          },
        })
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
        let projects = await loadProjectsDeduped()
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

    async forkProject(sourceId?: string, customName?: string): Promise<Project | null> {
      const targetId = sourceId || get().project?.id
      if (!targetId || get().forkingProject) return null
      set({ forkingProject: true })
      try {
        const forked = await api.forkProject(targetId, customName)
        const [projects, design] = await Promise.all([
          loadProjectsDeduped(),
          api.getERDesign(forked.id),
        ])
        const currentPos = get().chenPositions
        if (Object.keys(currentPos).length > 0) {
          saveChenPositions(forked.id, currentPos)
        }
        applyLoadedProjectState({
          project: forked,
          design,
          projects,
          chenPositions: currentPos,
          loadMessages: false,
          extras: {
            toast: {
              kind: 'info',
              text: `已克隆专属沙盒副本「${forked.name}」，您可自由编辑与体验 AI 建模`,
            },
          },
        })
        return forked
      } catch (error) {
        set({ toast: { kind: 'error', text: `克隆项目副本失败: ${errorMessage(error)}` } })
        return null
      } finally {
        set({ forkingProject: false })
      }
    },

    async ensureWritableProject(): Promise<string | null> {
      const current = get().project
      if (!current) return null
      if (!current.is_template) return current.id

      if (inFlightForkPromise) {
        return inFlightForkPromise
      }

      const run = (async (): Promise<string | null> => {
        const pendingDesign = get().design
        const pendingConceptual = normalizeConceptualDesign(get().conceptualDesign)
        const currentPos = get().chenPositions
        set({ forkingProject: true })
        try {
          const forked = await api.forkProject(current.id)
          if (pendingConceptual.concepts.length > 0) {
            await api.saveConceptualDesign(forked.id, pendingConceptual)
          }
          let latestDesign = pendingDesign
          if (pendingDesign && pendingDesign.entities.length > 0) {
            const savedRes = await api.saveERDesign(forked.id, pendingDesign)
            latestDesign = savedRes.design
          }
          if (Object.keys(currentPos).length > 0) {
            saveChenPositions(forked.id, currentPos)
          }
          const projects = await loadProjectsDeduped()
          set({
            projects,
            project: forked,
            conceptualDesign: pendingConceptual,
            messages: [],
            toast: {
              kind: 'info',
              text: `官方样板受只读保护，已自动为您创建专属沙盒副本「${forked.name}」保存修改`,
            },
          })
          get().recompute(ensureLayout(latestDesign))
          return forked.id
        } catch (error) {
          set({ toast: { kind: 'error', text: errorMessage(error) } })
          return null
        } finally {
          set({ forkingProject: false })
          inFlightForkPromise = null
        }
      })()

      inFlightForkPromise = run
      return run
    },
  }
}
