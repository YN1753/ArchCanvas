import type { StateCreator } from 'zustand'

import { api, type ProjectMessage, type ProposeConceptsPayload } from '../../api/client'
import { ensureLayout, layoutDesign, placeNewEntities } from '../../flow/layout'
import type { DatabaseDialect, ERDesign, SchemaReviewReport } from '../../types/dsl'
import type { AiChatSlice, Store } from '../types'
import { errorMessage } from '../utils'

export const createAiChatSlice: StateCreator<Store, [], [], AiChatSlice> = (set, get) => {
  let activeAbortController: AbortController | null = null

  const resetAbortController = (): AbortController => {
    if (activeAbortController) {
      activeAbortController.abort()
    }
    activeAbortController = new AbortController()
    return activeAbortController
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

    setAgentPhase(phase) {
      set({ agentPhase: phase })
    },

    setTargetDialect(dialect) {
      set({ targetDialect: dialect })
    },

    setReviewDrawerOpen(open) {
      set({ reviewDrawerOpen: open })
    },

    setReviewReport(report) {
      set({ reviewReport: report })
    },

    setAiSidebarOpen(open) {
      set({ aiSidebarOpen: open })
    },

    toggleAiSidebar() {
      set((state) => ({ aiSidebarOpen: !state.aiSidebarOpen }))
    },

    dismissAiResult() {
      set({ aiResult: null, aiError: null, aiThinking: '', aiStatus: '' })
    },

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
      const targetProjectId = project.id
      try {
        await api.clearProjectMessages(targetProjectId)
        if (get().project?.id === targetProjectId) {
          set({ messages: [], aiResult: null, aiThinking: '', aiError: null })
          set({ toast: { kind: 'info', text: '已清空当前项目的 AI 历史对话' } })
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
      const { project, selectedModel } = get()
      if (!project) return
      const trimmed = input.trim()
      if (!trimmed) return
      const targetProjectId = project.id
      const controller = resetAbortController()

      const tempUserMsg: ProjectMessage = {
        id: `temp_${Date.now()}`,
        conversation_id: '',
        role: 'user',
        content: trimmed,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      set((state) => ({
        aiRunning: true,
        aiThinking: '',
        aiStatus: '正在分析业务需求并构建高阶概念模型...',
        aiError: null,
        messages: [...state.messages, tempUserMsg],
      }))

      let rawResult: ProposeConceptsPayload | null = null

      try {
        await api.proposeConceptsStream(
          {
            project_id: targetProjectId,
            input: trimmed,
            model_provider: selectedModel?.provider,
            model_name: selectedModel?.model,
          },
          {
            onEvent: (event) => {
              if (controller.signal.aborted || get().project?.id !== targetProjectId) return
              if (event.type === 'thinking') {
                set((state) => ({ aiThinking: state.aiThinking + String(event.data ?? '') }))
              } else if (event.type === 'status') {
                set({ aiStatus: String(event.data ?? '') })
              } else if (event.type === 'error') {
                set({ aiError: String(event.data ?? '') })
              } else if (event.type === 'result' && event.data && typeof event.data === 'object') {
                rawResult = event.data
                if (event.data.conceptual_design && !event.data.need_clarification) {
                  get().mutateConceptual(event.data.conceptual_design, undefined, {
                    agentPhase: 'concept_ready',
                    canvasViewMode: 'chen',
                  })
                }
              }
            },
            onError: (err) => {
              if (controller.signal.aborted || get().project?.id !== targetProjectId) return
              set({ aiRunning: false, aiStatus: '', aiError: errorMessage(err) })
              void get().fetchProjectMessages(targetProjectId)
            },
            onDone: async () => {
              if (controller.signal.aborted || get().project?.id !== targetProjectId) return
              set({ aiRunning: false, aiStatus: '' })
              void get().fetchProjectMessages(targetProjectId)

              if (rawResult && rawResult.need_clarification) {
                set({
                  aiResult: {
                    applied: false,
                    requirement: {
                      summary: rawResult.summary || '需求存在疑问，请确认以下业务决策',
                      explicit_requirements: [],
                      negative_constraints: [],
                      assumptions: [],
                      decisions: [],
                      need_clarification: true,
                      clarification_cards: rawResult.clarification_cards || [],
                      questions: rawResult.questions || [],
                      operation_scope: 'clarification',
                    },
                  },
                })
              } else if (rawResult && rawResult.summary) {
                set({
                  aiResult: {
                    applied: true,
                    requirement: {
                      summary: rawResult.summary,
                      explicit_requirements: [],
                      negative_constraints: [],
                      assumptions: [],
                      decisions: [],
                      need_clarification: false,
                      questions: [],
                      operation_scope: 'concept',
                    },
                  },
                })
              }
            },
          },
          controller.signal,
        )
      } catch (error) {
        if (!controller.signal.aborted && get().project?.id === targetProjectId) {
          set({ aiRunning: false, aiStatus: '', aiError: errorMessage(error) })
        }
      }
    },

    async derivePhysical(dialect?: DatabaseDialect) {
      const { project, selectedModel, conceptualDesign } = get()
      if (!project) return
      const targetProjectId = project.id
      const controller = resetAbortController()
      const targetDialect = dialect || get().targetDialect || 'mysql'
      set({
        targetDialect,
        aiRunning: true,
        aiThinking: '',
        aiStatus: `物理架构工程师正在推导物理表与索引 (${targetDialect.toUpperCase()})...`,
        aiError: null,
        agentPhase: 'deriving_physical',
      })

      let finalDesign: ERDesign | null = null

      try {
        await api.derivePhysicalStream(
          {
            project_id: targetProjectId,
            dialect: targetDialect,
            conceptual_design: conceptualDesign,
            model_provider: selectedModel?.provider,
            model_name: selectedModel?.model,
          },
          {
            onEvent: (event) => {
              if (controller.signal.aborted || get().project?.id !== targetProjectId) return
              if (event.type === 'thinking') {
                set((state) => ({ aiThinking: state.aiThinking + String(event.data ?? '') }))
              } else if (event.type === 'status') {
                set({ aiStatus: String(event.data ?? '') })
              } else if (event.type === 'error') {
                set({ aiError: String(event.data ?? '') })
              } else if (event.type === 'result' && event.data && typeof event.data === 'object') {
                finalDesign = event.data
              }
            },
            onError: (err) => {
              if (controller.signal.aborted || get().project?.id !== targetProjectId) return
              set({ aiRunning: false, aiStatus: '', aiError: errorMessage(err), agentPhase: 'concept_ready' })
            },
            onDone: async () => {
              if (controller.signal.aborted || get().project?.id !== targetProjectId) return
              set({ aiRunning: false, aiStatus: '' })
              void get().fetchProjectMessages(targetProjectId)

              let designToApply = finalDesign
              if (!designToApply) {
                try {
                  const serverDesign = await api.getERDesign(targetProjectId)
                  if (controller.signal.aborted || get().project?.id !== targetProjectId) return
                  if (serverDesign && Array.isArray(serverDesign.entities) && serverDesign.entities.length > 0) {
                    designToApply = serverDesign
                  }
                } catch (e) {
                  console.warn('拉取服务端 ER 设计兜底失败:', e)
                }
              }

              if (controller.signal.aborted || get().project?.id !== targetProjectId) return

              if (designToApply && Array.isArray(designToApply.entities) && designToApply.entities.length > 0) {
                const currentEntities = get().design.entities
                const isInitiallyEmpty = currentEntities.length === 0

                const posByID = new Map(currentEntities.map((entity) => [entity.id, entity.position]))
                const posByName = new Map(currentEntities.map((entity) => [entity.name.toLowerCase(), entity.position]))

                const before = new Set(currentEntities.map((entity) => entity.id))
                const added = designToApply.entities
                  .filter((entity) => !before.has(entity.id))
                  .map((entity) => entity.id)

                const validEntityIds = new Set(designToApply.entities.map((e) => e.id))
                const cleanedRelations = (designToApply.relations ?? []).filter(
                  (r) => validEntityIds.has(r.source_entity_id) && validEntityIds.has(r.target_entity_id),
                )

                let nextDesign: ERDesign
                if (isInitiallyEmpty) {
                  const freshDesign: ERDesign = {
                    ...designToApply,
                    entities: designToApply.entities.map((e) => ({
                      ...e,
                      attributes: e.attributes ?? [],
                      position: undefined,
                    })),
                    relations: cleanedRelations,
                  }
                  nextDesign = layoutDesign(freshDesign)
                } else {
                  const mergedEntities = designToApply.entities.map((entity) => ({
                    ...entity,
                    attributes: entity.attributes ?? [],
                    position: entity.position ?? posByID.get(entity.id) ?? posByName.get(entity.name.toLowerCase()),
                  }))
                  const designWithPos: ERDesign = {
                    ...designToApply,
                    entities: mergedEntities,
                    relations: cleanedRelations,
                  }
                  nextDesign = ensureLayout(placeNewEntities(designWithPos, added))
                }

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
          },
          controller.signal,
        )
      } catch (error) {
        if (!controller.signal.aborted && get().project?.id === targetProjectId) {
          set({ aiRunning: false, aiStatus: '', aiError: errorMessage(error), agentPhase: 'concept_ready' })
        }
      }
    },

    async reviewSchema(dialect?: DatabaseDialect) {
      const { project, selectedModel, design } = get()
      if (!project) return
      const targetProjectId = project.id
      const targetDialect = dialect || get().targetDialect || 'mysql'

      if (design.entities.length === 0) {
        set({
          targetDialect,
          reviewReport: null,
          reviewDrawerOpen: true,
          aiError: null,
        })
        return
      }

      const controller = resetAbortController()
      const previousPhase = get().agentPhase
      set({
        targetDialect,
        aiRunning: true,
        aiThinking: '',
        aiStatus: '正在同步未保存变更并启动架构质量与性能体检...',
        aiError: null,
        agentPhase: 'reviewing',
      })

      try {
        await get().saveNow()
      } catch (err) {
        console.warn('架构体检前刷盘保存失败:', err)
      }

      if (controller.signal.aborted || get().project?.id !== targetProjectId) {
        return
      }

      let finalReport: SchemaReviewReport | null = null

      try {
        await api.reviewSchemaStream(
          {
            project_id: targetProjectId,
            dialect: targetDialect,
            model_provider: selectedModel?.provider,
            model_name: selectedModel?.model,
          },
          {
            onEvent: (event) => {
              if (controller.signal.aborted || get().project?.id !== targetProjectId) return
              if (event.type === 'thinking') {
                set((state) => ({ aiThinking: state.aiThinking + String(event.data ?? '') }))
              } else if (event.type === 'status') {
                set({ aiStatus: String(event.data ?? '') })
              } else if (event.type === 'error') {
                set({ aiError: String(event.data ?? '') })
              } else if (event.type === 'result' && event.data && typeof event.data === 'object') {
                finalReport = event.data
              }
            },
            onError: (err) => {
              if (controller.signal.aborted || get().project?.id !== targetProjectId) return
              set({
                aiRunning: false,
                aiStatus: '',
                aiError: errorMessage(err),
                agentPhase: previousPhase === 'reviewing' ? 'physical_ready' : previousPhase,
              })
            },
            onDone: async () => {
              if (controller.signal.aborted || get().project?.id !== targetProjectId) return
              set({ aiRunning: false, aiStatus: '' })
              void get().fetchProjectMessages(targetProjectId)

              if (finalReport) {
                set({
                  reviewReport: finalReport,
                  reviewDrawerOpen: true,
                  agentPhase: 'physical_ready',
                  toast: { kind: 'info', text: `架构体检完成！健康度得分: ${finalReport.score} 分` },
                })
              } else {
                set({
                  agentPhase: previousPhase === 'reviewing' ? 'physical_ready' : previousPhase,
                })
              }
            },
          },
          controller.signal,
        )
      } catch (error) {
        if (!controller.signal.aborted && get().project?.id === targetProjectId) {
          set({
            aiRunning: false,
            aiStatus: '',
            aiError: errorMessage(error),
            agentPhase: previousPhase === 'reviewing' ? 'physical_ready' : previousPhase,
          })
        }
      }
    },

    async enrichSemantics(options) {
      const { project, selectedModel, design } = get()
      if (!project) return
      const targetProjectId = project.id
      const targetDesign = options?.design || design
      if (!targetDesign || !Array.isArray(targetDesign.entities) || targetDesign.entities.length === 0) {
        set({ toast: { kind: 'error', text: '当前画布无数据表，无法推导概念语义' } })
        return
      }

      const controller = resetAbortController()
      set({
        aiRunning: true,
        aiThinking: '',
        aiStatus: 'AI 架构师正在分析全图并推导业务概念层语义…',
        aiError: null,
      })

      try {
        const res = await api.enrichSemantics(
          {
            project_id: targetProjectId,
            dialect: get().targetDialect,
            design: targetDesign,
            model_provider: selectedModel?.provider,
            model_name: selectedModel?.model,
          },
          controller.signal,
        )

        if (controller.signal.aborted || get().project?.id !== targetProjectId) {
          return
        }

        if (res && res.design) {
          const existingPosMap = new Map<string, { x: number; y: number }>()
          for (const e of get().design.entities) {
            if (e.position) existingPosMap.set(e.id, e.position)
          }

          const enrichedEntities = res.design.entities.map((e) => ({
            ...e,
            position: e.position || existingPosMap.get(e.id),
          }))

          const nextDesign: ERDesign = ensureLayout({
            entities: enrichedEntities,
            relations: res.design.relations || targetDesign.relations,
          })

          get().mutateBoth(
            nextDesign,
            res.conceptual_design ?? get().conceptualDesign,
            {
              serverWarnings: [],
              aiRunning: false,
              aiStatus: '',
              toast: {
                kind: 'info',
                text: '✨ 全图概念层语义推导完成！已为所有实体与属性注入精准中文业务概念',
              },
            },
          )
        } else {
          set({ aiRunning: false, aiStatus: '' })
        }
      } catch (error) {
        if (!controller.signal.aborted && get().project?.id === targetProjectId) {
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
