import type { StateCreator } from 'zustand'

import { api, type ProjectMessage } from '../../api/client'
import { ensureLayout, layoutDesign, placeNewEntities } from '../../flow/layout'
import type { DatabaseDialect, ERDesign, SchemaReviewReport } from '../../types/dsl'
import type { AiChatSlice, Store } from '../types'
import { errorMessage } from '../utils'

export const createAiChatSlice: StateCreator<Store, [], [], AiChatSlice> = (set, get) => ({
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
    try {
      await api.clearProjectMessages(project.id)
      set({ messages: [], aiResult: null, aiThinking: '', aiError: null })
      set({ toast: { kind: 'info', text: '已清空当前项目的 AI 历史对话' } })
    } catch (err) {
      set({ toast: { kind: 'error', text: `清空会话失败: ${errorMessage(err)}` } })
    }
  },

  async runAI(input) {
    const { project, selectedModel } = get()
    if (!project) {
      return
    }

    const tempUserMsg: ProjectMessage = {
      id: `temp_${Date.now()}`,
      conversation_id: '',
      role: 'user',
      content: input,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    set((state) => ({
      aiRunning: true,
      aiError: null,
      aiResult: null,
      aiThinking: '',
      aiStatus: 'AI 正在分析需求…',
      messages: [...state.messages, tempUserMsg],
    }))

    let finalDesign: ERDesign | null = null
    let rawResult: any = null

    try {
      await api.chatStream(
        {
          project_id: project.id,
          input,
          model_provider: selectedModel?.provider,
          model_name: selectedModel?.model,
        },
        {
          onEvent: (event) => {
            if (event.type === 'thinking') {
              const text = typeof event.data === 'string' ? event.data : JSON.stringify(event.data)
              set((state) => ({ aiThinking: state.aiThinking + text }))
            } else if (event.type === 'status') {
              set({ aiStatus: String(event.data) })
            } else if (event.type === 'tool_call') {
              set({ aiStatus: '已识别数据模型，正在持久化落库…' })
              if (event.data && typeof event.data === 'object' && Array.isArray((event.data as any).entities)) {
                finalDesign = event.data as ERDesign
              }
            } else if (event.type === 'result' || event.type === 'message') {
              rawResult = event.data
              if (event.data && typeof event.data === 'object' && Array.isArray((event.data as any).entities)) {
                finalDesign = event.data as ERDesign
              }
            } else if (event.type === 'error') {
              set({ aiError: String(event.data) })
            }
          },
          onError: (err) => {
            set({ aiRunning: false, aiError: errorMessage(err) })
            void get().fetchProjectMessages(project.id)
          },
          onDone: async () => {
            set({ aiRunning: false, aiStatus: '' })
            void get().fetchProjectMessages(project.id)

            let designToApply = finalDesign
            // 兜底保障：若未从 SSE 流中解析出设计（如断网或网络丢包），直接拉取后端数据库已保存的物理设计
            if (!designToApply) {
              try {
                const serverDesign = await api.getERDesign(project.id)
                if (serverDesign && Array.isArray(serverDesign.entities) && serverDesign.entities.length > 0) {
                  designToApply = serverDesign
                }
              } catch (e) {
                console.warn('拉取服务端 ER 设计兜底失败:', e)
              }
            }

            if (designToApply && Array.isArray(designToApply.entities) && designToApply.entities.length > 0) {
              get().recordSnapshot()
              const currentEntities = get().design.entities
              const isInitiallyEmpty = currentEntities.length === 0

              const posByID = new Map(currentEntities.map((entity) => [entity.id, entity.position]))
              const posByName = new Map(currentEntities.map((entity) => [entity.name.toLowerCase(), entity.position]))

              const before = new Set(currentEntities.map((entity) => entity.id))
              const added = designToApply.entities
                .filter((entity) => !before.has(entity.id))
                .map((entity) => entity.id)

              // 彻底过滤掉表内自引用关系 (如 comments -> comments，避免回环遮挡字段)
              const cleanedRelations = (designToApply.relations ?? []).filter(
                (r) => r.source_entity_id !== r.target_entity_id,
              )

              let nextDesign: ERDesign
              if (isInitiallyEmpty) {
                // 用户明确要求：更新实体到画布时如果初始画布是空白的，默认调用一次全量自动整理（Compact ER Layout）
                const freshDesign = {
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
                const designWithPos = { ...designToApply, entities: mergedEntities, relations: cleanedRelations }
                nextDesign = ensureLayout(placeNewEntities(designWithPos, added))
              }

              get().recompute(nextDesign, { serverWarnings: [] })
              get().scheduleSave()
              set({
                aiResult: {
                  applied: true,
                  design: designToApply,
                  requirement: {
                    summary: rawResult?.summary || '数据模型设计已生成并自动落库',
                    explicit_requirements: [],
                    negative_constraints: rawResult?.negative_constraints || [],
                    assumptions: rawResult?.assumptions || [],
                    decisions: [],
                    need_clarification: false,
                    questions: [],
                    operation_scope: 'create',
                  },
                  execution: null,
                  review: null,
                },
              })
            } else if (rawResult && rawResult.need_clarification) {
              set({
                aiResult: {
                  applied: false,
                  requirement: {
                    summary: rawResult.summary || '需求存在疑问，请确认以下业务决策',
                    explicit_requirements: [],
                    negative_constraints: rawResult.negative_constraints || [],
                    assumptions: rawResult.assumptions || [],
                    decisions: [],
                    need_clarification: true,
                    clarification_cards: rawResult.clarification_cards || [],
                    questions: rawResult.questions || [],
                    operation_scope: 'clarification',
                  },
                  execution: null,
                  review: null,
                },
              })
            } else if (!get().aiError) {
              set({
                aiResult: {
                  applied: false,
                  requirement: {
                    summary: rawResult?.summary || '回复完毕',
                    explicit_requirements: [],
                    negative_constraints: rawResult?.negative_constraints || [],
                    assumptions: rawResult?.assumptions || [],
                    decisions: [],
                    need_clarification: false,
                    clarification_cards: rawResult?.clarification_cards || [],
                    questions: rawResult?.questions || [],
                    operation_scope: 'chat',
                  },
                  execution: null,
                  review: null,
                },
              })
            }
          },
        },
      )
    } catch (error) {
      set({ aiRunning: false, aiError: errorMessage(error) })
    }
  },

  async proposeConcepts(input: string) {
    const { project, selectedModel } = get()
    if (!project) return
    const trimmed = input.trim()
    if (!trimmed) return

    set({
      aiRunning: true,
      aiThinking: '',
      aiStatus: '正在分析业务需求并构建高阶概念模型...',
      aiError: null,
    })

    let rawResult: any = null

    try {
      await api.proposeConceptsStream(
        {
          project_id: project.id,
          input: trimmed,
          model_provider: selectedModel?.provider,
          model_name: selectedModel?.model,
        },
        {
          onEvent: (event) => {
            if (event.type === 'thinking') {
              set((state) => ({ aiThinking: state.aiThinking + (event.data || '') }))
            } else if (event.type === 'status') {
              set({ aiStatus: String(event.data || '') })
            } else if (event.type === 'error') {
              set({ aiError: String(event.data || '') })
            } else if (event.type === 'result') {
              rawResult = event.data
              if (event.data?.conceptual_design) {
                get().mutateConceptual(event.data.conceptual_design, undefined, {
                  agentPhase: 'concept_ready',
                  canvasViewMode: 'chen',
                })
              }
            }
          },
          onError: (err) => {
            set({ aiRunning: false, aiError: errorMessage(err) })
          },
          onDone: async () => {
            set({ aiRunning: false, aiStatus: '' })
            void get().fetchProjectMessages(project.id)

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
                  execution: null,
                  review: null,
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
                  execution: null,
                  review: null,
                },
              })
            }
          },
        },
      )
    } catch (error) {
      set({ aiRunning: false, aiError: errorMessage(error) })
    }
  },

  async derivePhysical(dialect?: DatabaseDialect) {
    const { project, selectedModel, conceptualDesign } = get()
    if (!project) return
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
          project_id: project.id,
          dialect: targetDialect,
          conceptual_design: conceptualDesign,
          model_provider: selectedModel?.provider,
          model_name: selectedModel?.model,
        },
        {
          onEvent: (event) => {
            if (event.type === 'thinking') {
              set((state) => ({ aiThinking: state.aiThinking + (event.data || '') }))
            } else if (event.type === 'status') {
              set({ aiStatus: String(event.data || '') })
            } else if (event.type === 'error') {
              set({ aiError: String(event.data || '') })
            } else if (event.type === 'result') {
              finalDesign = event.data as ERDesign
            }
          },
          onError: (err) => {
            set({ aiRunning: false, aiError: errorMessage(err), agentPhase: 'concept_ready' })
          },
          onDone: async () => {
            set({ aiRunning: false, aiStatus: '' })
            void get().fetchProjectMessages(project.id)

            let designToApply = finalDesign
            if (!designToApply) {
              try {
                const serverDesign = await api.getERDesign(project.id)
                if (serverDesign && Array.isArray(serverDesign.entities) && serverDesign.entities.length > 0) {
                  designToApply = serverDesign
                }
              } catch (e) {
                console.warn('拉取服务端 ER 设计兜底失败:', e)
              }
            }

            if (designToApply && Array.isArray(designToApply.entities) && designToApply.entities.length > 0) {
              get().recordSnapshot()
              const currentEntities = get().design.entities
              const isInitiallyEmpty = currentEntities.length === 0

              const posByID = new Map(currentEntities.map((entity) => [entity.id, entity.position]))
              const posByName = new Map(currentEntities.map((entity) => [entity.name.toLowerCase(), entity.position]))

              const before = new Set(currentEntities.map((entity) => entity.id))
              const added = designToApply.entities
                .filter((entity) => !before.has(entity.id))
                .map((entity) => entity.id)

              const cleanedRelations = (designToApply.relations ?? []).filter(
                (r) => r.source_entity_id !== r.target_entity_id,
              )

              let nextDesign: ERDesign
              if (isInitiallyEmpty) {
                const freshDesign = {
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
                const designWithPos = { ...designToApply, entities: mergedEntities, relations: cleanedRelations }
                nextDesign = ensureLayout(placeNewEntities(designWithPos, added))
              }

              get().recompute(nextDesign, { serverWarnings: [] })
              get().scheduleSave()
              set({
                agentPhase: 'physical_ready',
                canvasViewMode: 'relational',
                toast: { kind: 'info', text: '物理表结构与索引推导完成并已同步' },
              })
            } else {
              set({ agentPhase: 'concept_ready' })
            }
          },
        },
      )
    } catch (error) {
      set({ aiRunning: false, aiError: errorMessage(error), agentPhase: 'concept_ready' })
    }
  },

  async reviewSchema(dialect?: DatabaseDialect) {
    const { project, selectedModel } = get()
    if (!project) return
    const targetDialect = dialect || get().targetDialect || 'mysql'
    set({
      targetDialect,
      aiRunning: true,
      aiThinking: '',
      aiStatus: '首席架构师正在执行架构质量与性能体检...',
      aiError: null,
      agentPhase: 'reviewing',
    })

    let finalReport: SchemaReviewReport | null = null

    try {
      await api.reviewSchemaStream(
        {
          project_id: project.id,
          dialect: targetDialect,
          model_provider: selectedModel?.provider,
          model_name: selectedModel?.model,
        },
        {
          onEvent: (event) => {
            if (event.type === 'thinking') {
              set((state) => ({ aiThinking: state.aiThinking + (event.data || '') }))
            } else if (event.type === 'status') {
              set({ aiStatus: String(event.data || '') })
            } else if (event.type === 'error') {
              set({ aiError: String(event.data || '') })
            } else if (event.type === 'result') {
              finalReport = event.data as SchemaReviewReport
            }
          },
          onError: (err) => {
            set({ aiRunning: false, aiError: errorMessage(err), agentPhase: 'physical_ready' })
          },
          onDone: async () => {
            set({ aiRunning: false, aiStatus: '' })
            void get().fetchProjectMessages(project.id)

            if (finalReport) {
              set({
                reviewReport: finalReport,
                reviewDrawerOpen: true,
                agentPhase: 'physical_ready',
                toast: { kind: 'info', text: `架构体检完成！健康度得分: ${finalReport.score} 分` },
              })
            } else {
              set({ agentPhase: 'physical_ready' })
            }
          },
        },
      )
    } catch (error) {
      set({ aiRunning: false, aiError: errorMessage(error), agentPhase: 'physical_ready' })
    }
  },

  async enrichSemantics(options) {
    const { project, selectedModel, design } = get()
    if (!project) return
    const targetDesign = options?.design || design
    if (!targetDesign || !Array.isArray(targetDesign.entities) || targetDesign.entities.length === 0) {
      set({ toast: { kind: 'error', text: '当前画布无数据表，无法推导概念语义' } })
      return
    }

    set({
      aiRunning: true,
      aiThinking: '',
      aiStatus: 'AI 架构师正在分析全图并推导业务概念层语义…',
      aiError: null,
    })

    try {
      const res = await api.enrichSemantics({
        project_id: project.id,
        dialect: get().targetDialect,
        design: targetDesign,
        model_provider: selectedModel?.provider,
        model_name: selectedModel?.model,
      })

      if (res && res.design) {
        get().recordSnapshot()

        // 保持现有坐标，仅合并/应用 enriched 表注释与字段注释
        const existingPosMap = new Map<string, { x: number; y: number }>()
        for (const e of get().design.entities) {
          if (e.position) existingPosMap.set(e.id, e.position)
        }

        const enrichedEntities = res.design.entities.map((e) => ({
          ...e,
          position: e.position || existingPosMap.get(e.id),
        }))

        const nextDesign: ERDesign = {
          entities: enrichedEntities,
          relations: res.design.relations || targetDesign.relations,
        }

        get().recompute(ensureLayout(nextDesign), { serverWarnings: [] })

        if (res.conceptual_design) {
          set({ conceptualDesign: res.conceptual_design })
        }

        get().scheduleSave()

        set({
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
      set({
        aiRunning: false,
        aiStatus: '',
        aiError: errorMessage(error),
        toast: { kind: 'error', text: `语义推导失败: ${errorMessage(error)}` },
      })
    }
  },
})
