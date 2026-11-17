import type { StateCreator } from 'zustand'

import {
  api,
  type ChatEvent,
  type ProjectMessage,
  type ProposeConceptsPayload,
} from '../../api/client'
import { normalizeConceptualDesign } from '../../domain/conceptNormalize'
import { ensureLayout, layoutDesign, placeNewEntities } from '../../flow/layout'
import type { DatabaseDialect, ERDesign, SchemaReviewReport } from '../../types/dsl'
import type { AiChatSlice, Store } from '../types'
import { errorMessage } from '../utils'

export const createAiChatSlice: StateCreator<Store, [], [], AiChatSlice> = (set, get) => {
  let activeAbortController: AbortController | null = null

  const resetAbortController = (): AbortController => {
    activeAbortController?.abort()
    activeAbortController = new AbortController()
    return activeAbortController
  }

  const refreshQuotaIfShowcase = () => {
    if (get().showcase?.enabled) {
      void get().fetchShowcaseStatus()
    }
  }

  async function prepareAiSession(options: {
    requireWritableProject: boolean
    initialStatus: string
    buildInitialPatch?: (state: Store) => Partial<Store>
  }): Promise<{ targetProjectId: string; signal: AbortSignal; isStale: () => boolean } | null> {
    const { project } = get()
    if (!project) return null

    const targetProjectId =
      options.requireWritableProject && project.is_template
        ? await get().ensureWritableProject()
        : project.id
    if (!targetProjectId) return null

    const controller = resetAbortController()
    const isStale = () => controller.signal.aborted || get().project?.id !== targetProjectId

    set((state) => ({
      aiRunning: true,
      aiThinking: '',
      aiStatus: options.initialStatus,
      aiError: null,
      ...(options.buildInitialPatch ? options.buildInitialPatch(state) : {}),
    }))

    return { targetProjectId, signal: controller.signal, isStale }
  }

  /**
   * 统一 Agent SSE 流执行器：
   * 集中托管只读样板自动克隆（CoW）、AbortController 生命周期、跨项目竞态隔离守卫、
   * 思考/状态/异常事件流聚合与演示沙盒配额刷新。
   */
  async function runAgentSSEStream<TResult>(options: {
    requireWritableProject: boolean
    initialStatus: string
    buildInitialPatch?: (state: Store) => Partial<Store>
    beforeStream?: () => Promise<void>
    executeStream: (
      ctx: { targetProjectId: string; signal: AbortSignal },
      callbacks: {
        onEvent: (event: ChatEvent<TResult | string>) => void
        onError: (err: Error) => void
        onDone: () => Promise<void>
      },
    ) => Promise<void>
    onResult: (result: TResult) => void
    onCompleted: (ctx: { targetProjectId: string; isStale: () => boolean }) => Promise<void> | void
    onErrorPatch?: () => Partial<Store>
    refreshMessagesOnError?: boolean
  }): Promise<void> {
    const session = await prepareAiSession(options)
    if (!session) return
    const { targetProjectId, signal, isStale } = session

    if (options.beforeStream) {
      await options.beforeStream()
      if (isStale()) return
    }

    let handledError = false
    const handleFailure = (err: unknown) => {
      if (handledError || isStale()) return
      handledError = true
      set({
        aiRunning: false,
        aiStatus: '',
        aiError: errorMessage(err),
        ...(options.onErrorPatch ? options.onErrorPatch() : {}),
      })
      if (options.refreshMessagesOnError) {
        void get().fetchProjectMessages(targetProjectId)
      }
      refreshQuotaIfShowcase()
    }

    try {
      await options.executeStream(
        { targetProjectId, signal },
        {
          onEvent: (event) => {
            if (isStale()) return
            if (event.type === 'thinking') {
              set((state) => ({ aiThinking: state.aiThinking + String(event.data ?? '') }))
            } else if (event.type === 'status') {
              set({ aiStatus: String(event.data ?? '') })
            } else if (event.type === 'error') {
              set({ aiError: String(event.data ?? '') })
            } else if (event.type === 'result' && event.data && typeof event.data === 'object') {
              options.onResult(event.data as TResult)
            }
          },
          onError: (err) => handleFailure(err),
          onDone: async () => {
            if (isStale()) return
            set({ aiRunning: false, aiStatus: '' })
            void get().fetchProjectMessages(targetProjectId)
            refreshQuotaIfShowcase()
            await options.onCompleted({ targetProjectId, isStale })
          },
        },
      )
    } catch (error) {
      handleFailure(error)
    }
  }

  return {
    aiRunning: false,
    aiThinking: '',
    aiStatus: '',
    aiError: null,
    aiResult: null,

    messages: [],
    messagesLoading: false,
    aiSidebarOpen: true,

    agentPhase: 'idle',
    targetDialect: 'mysql',
    reviewReport: null,
    reviewDrawerOpen: false,

    setAgentPhase: (phase) => set({ agentPhase: phase }),
    setTargetDialect: (dialect) => set({ targetDialect: dialect }),
    setReviewDrawerOpen: (open) => set({ reviewDrawerOpen: open }),
    setReviewReport: (report) => set({ reviewReport: report }),
    setAiSidebarOpen: (open) => set({ aiSidebarOpen: open }),
    toggleAiSidebar: () => set((state) => ({ aiSidebarOpen: !state.aiSidebarOpen })),
    dismissAiResult: () => set({ aiResult: null, aiError: null, aiThinking: '', aiStatus: '' }),

    async fetchProjectMessages(projectId) {
      if (!projectId) return
      set({ messagesLoading: true })
      try {
        const messages = await api.getProjectMessages(projectId)
        if (get().project?.id === projectId) {
          set({ messages: Array.isArray(messages) ? messages : [], messagesLoading: false })
        }
      } catch {
        if (get().project?.id === projectId) {
          set({ messages: [], messagesLoading: false })
        }
      }
    },

    async clearProjectMessages() {
      const { project } = get()
      if (!project) return
      if (project.is_template) {
        set({
          toast: {
            kind: 'info',
            text: '官方演示样板对话为预设展示，请先点击「克隆副本」在沙盒中自由对话',
          },
        })
        return
      }
      const targetProjectId = project.id
      try {
        await api.clearProjectMessages(targetProjectId)
        if (get().project?.id === targetProjectId) {
          set({
            messages: [],
            aiResult: null,
            aiThinking: '',
            aiError: null,
            toast: { kind: 'info', text: '已清空当前项目的 AI 历史对话' },
          })
        }
      } catch (err) {
        if (get().project?.id === targetProjectId) {
          set({ toast: { kind: 'error', text: `清空会话失败: ${errorMessage(err)}` } })
        }
      }
    },

    stopAI() {
      if (activeAbortController) {
        activeAbortController.abort()
        activeAbortController = null
      }
      set((state) => ({
        aiRunning: false,
        aiStatus: '',
        agentPhase:
          state.agentPhase === 'deriving_physical'
            ? 'concept_ready'
            : state.agentPhase === 'reviewing'
              ? 'physical_ready'
              : state.agentPhase,
        toast: { kind: 'info', text: '已停止当前 AI 生成任务' },
      }))
    },

    async proposeConcepts(input: string) {
      const trimmed = input.trim()
      if (!trimmed || !get().project) return

      const nowIso = new Date().toISOString()
      const tempUserMsg: ProjectMessage = {
        id: `temp_${Date.now()}`,
        conversation_id: '',
        role: 'user',
        content: trimmed,
        created_at: nowIso,
        updated_at: nowIso,
      }
      let rawResult: ProposeConceptsPayload | null = null

      await runAgentSSEStream<ProposeConceptsPayload>({
        requireWritableProject: true,
        initialStatus: '正在分析业务需求并构建高阶概念模型...',
        buildInitialPatch: (state) => ({ messages: [...state.messages, tempUserMsg] }),
        refreshMessagesOnError: true,
        executeStream: ({ targetProjectId, signal }, callbacks) => {
          const { selectedModel } = get()
          return api.proposeConceptsStream(
            {
              project_id: targetProjectId,
              input: trimmed,
              model_provider: selectedModel?.provider,
              model_name: selectedModel?.model,
            },
            callbacks,
            signal,
          )
        },
        onResult: (data) => {
          rawResult = data
          if (data.conceptual_design && !data.need_clarification) {
            get().mutateConceptual(normalizeConceptualDesign(data.conceptual_design), undefined, {
              agentPhase: 'concept_ready',
              canvasViewMode: 'chen',
            })
          }
        },
        onCompleted: () => {
          if (rawResult?.need_clarification) {
            set({
              aiResult: {
                applied: false,
                requirement: {
                  summary: rawResult.summary || '需求存在疑问，请确认以下业务决策',
                  need_clarification: true,
                  clarification_cards: rawResult.clarification_cards || [],
                  questions: rawResult.questions || [],
                  operation_scope: 'clarification',
                },
              },
            })
          } else if (rawResult?.summary) {
            set({
              aiResult: {
                applied: true,
                requirement: {
                  summary: rawResult.summary,
                  need_clarification: false,
                  questions: [],
                  operation_scope: 'concept',
                },
              },
            })
          }
        },
      })
    },

    async derivePhysical(dialect?: DatabaseDialect) {
      if (!get().project) return
      const targetDialect = dialect || get().targetDialect || 'mysql'
      let finalDesign: ERDesign | null = null

      await runAgentSSEStream<ERDesign>({
        requireWritableProject: true,
        initialStatus: `物理架构工程师正在推导物理表与索引 (${targetDialect.toUpperCase()})...`,
        buildInitialPatch: () => ({ targetDialect, agentPhase: 'deriving_physical' }),
        onErrorPatch: () => ({ agentPhase: 'concept_ready' }),
        executeStream: ({ targetProjectId, signal }, callbacks) => {
          const { selectedModel, conceptualDesign } = get()
          return api.derivePhysicalStream(
            {
              project_id: targetProjectId,
              dialect: targetDialect,
              conceptual_design: conceptualDesign,
              model_provider: selectedModel?.provider,
              model_name: selectedModel?.model,
            },
            callbacks,
            signal,
          )
        },
        onResult: (data) => {
          finalDesign = data
        },
        onCompleted: async ({ targetProjectId, isStale }) => {
          let designToApply = finalDesign
          if (!designToApply) {
            try {
              const serverDesign = await api.getERDesign(targetProjectId)
              if (isStale()) return
              if (serverDesign?.entities?.length) {
                designToApply = serverDesign
              }
            } catch (e) {
              console.warn('拉取服务端 ER 设计兜底失败:', e)
            }
          }
          if (isStale()) return

          if (designToApply?.entities?.length) {
            const currentEntities = get().design.entities
            const posByID = new Map(currentEntities.map((e) => [e.id, e.position]))
            const posByName = new Map(currentEntities.map((e) => [e.name.toLowerCase(), e.position]))
            const before = new Set(currentEntities.map((e) => e.id))
            const added = designToApply.entities.filter((e) => !before.has(e.id)).map((e) => e.id)
            const validIds = new Set(designToApply.entities.map((e) => e.id))
            const cleanedRelations = (designToApply.relations ?? []).filter(
              (r) => validIds.has(r.source_entity_id) && validIds.has(r.target_entity_id),
            )

            const nextDesign: ERDesign =
              currentEntities.length === 0
                ? layoutDesign({
                    ...designToApply,
                    entities: designToApply.entities.map((e) => ({
                      ...e,
                      attributes: e.attributes ?? [],
                      position: undefined,
                    })),
                    relations: cleanedRelations,
                  })
                : ensureLayout(
                    placeNewEntities(
                      {
                        ...designToApply,
                        entities: designToApply.entities.map((e) => ({
                          ...e,
                          attributes: e.attributes ?? [],
                          position:
                            e.position ??
                            posByID.get(e.id) ??
                            posByName.get(e.name.toLowerCase()),
                        })),
                        relations: cleanedRelations,
                      },
                      added,
                    ),
                  )

            get().mutate(nextDesign, undefined, {
              serverWarnings: [],
              agentPhase: 'physical_ready',
              canvasViewMode: 'relational',
              toast: { kind: 'info', text: '物理表结构与索引推导完成并已同步' },
            })
          } else {
            set({ agentPhase: 'concept_ready' })
          }
        },
      })
    },

    async reviewSchema(dialect?: DatabaseDialect) {
      const { project, design } = get()
      if (!project) return
      const targetDialect = dialect || get().targetDialect || 'mysql'

      if (design.entities.length === 0) {
        set({ targetDialect, reviewReport: null, reviewDrawerOpen: true, aiError: null })
        return
      }

      const previousPhase = get().agentPhase
      const fallbackPhase = previousPhase === 'reviewing' ? 'physical_ready' : previousPhase
      let finalReport: SchemaReviewReport | null = null

      await runAgentSSEStream<SchemaReviewReport>({
        requireWritableProject: false,
        initialStatus: '正在同步未保存变更并启动架构质量与性能体检...',
        buildInitialPatch: () => ({ targetDialect, agentPhase: 'reviewing' }),
        onErrorPatch: () => ({ agentPhase: fallbackPhase }),
        beforeStream: async () => {
          try {
            await get().saveNow()
          } catch (err) {
            console.warn('架构体检前刷盘保存失败:', err)
          }
        },
        executeStream: ({ targetProjectId, signal }, callbacks) => {
          const { selectedModel } = get()
          return api.reviewSchemaStream(
            {
              project_id: targetProjectId,
              dialect: targetDialect,
              model_provider: selectedModel?.provider,
              model_name: selectedModel?.model,
            },
            callbacks,
            signal,
          )
        },
        onResult: (data) => {
          finalReport = data
        },
        onCompleted: () => {
          if (finalReport) {
            set({
              reviewReport: finalReport,
              reviewDrawerOpen: true,
              agentPhase: 'physical_ready',
              toast: { kind: 'info', text: `架构体检完成！健康度得分: ${finalReport.score} 分` },
            })
          } else {
            set({ agentPhase: fallbackPhase })
          }
        },
      })
    },

    async enrichSemantics(options) {
      const targetDesign = options?.design || get().design
      if (!targetDesign?.entities?.length) {
        set({ toast: { kind: 'error', text: '当前画布无数据表，无法推导概念语义' } })
        return
      }

      const session = await prepareAiSession({
        requireWritableProject: true,
        initialStatus: 'AI 架构师正在分析全图并推导业务概念层语义…',
      })
      if (!session) return
      const { targetProjectId, signal, isStale } = session

      try {
        const { selectedModel, targetDialect } = get()
        const res = await api.enrichSemantics(
          {
            project_id: targetProjectId,
            dialect: targetDialect,
            design: targetDesign,
            model_provider: selectedModel?.provider,
            model_name: selectedModel?.model,
          },
          signal,
        )
        if (isStale()) return
        refreshQuotaIfShowcase()

        if (res?.design) {
          const existingPosMap = new Map(
            get()
              .design.entities.filter((e) => e.position !== undefined)
              .map((e) => [e.id, e.position!]),
          )
          const nextDesign = ensureLayout({
            entities: res.design.entities.map((e) => ({
              ...e,
              position: e.position || existingPosMap.get(e.id),
            })),
            relations: res.design.relations || targetDesign.relations,
          })
          const nextConceptual = res.conceptual_design
            ? normalizeConceptualDesign(res.conceptual_design)
            : get().conceptualDesign

          get().mutateBoth(nextDesign, nextConceptual, {
            serverWarnings: [],
            aiRunning: false,
            aiStatus: '',
            toast: {
              kind: 'info',
              text: '✨ 全图概念层语义推导完成！已为所有实体与属性注入精准中文业务概念',
            },
          })
        } else {
          set({ aiRunning: false, aiStatus: '' })
        }
      } catch (error) {
        if (!isStale()) {
          refreshQuotaIfShowcase()
          set({
            aiRunning: false,
            aiStatus: '',
            aiError: errorMessage(error),
            toast: { kind: 'error', text: `语义推导失败: ${errorMessage(error)}` },
          })
        }
      }
    },
  }
}
