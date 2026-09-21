import { create } from 'zustand'

import {
  api,
  ApiError,
  type AvailableModelsResponse,
  type ERDesignAnalysisResult,
  type GetModelsParams,
  type SaveModelParams,
  type ModelItem,
  type Project,
  type ProviderInfo,
} from '../api/client'
import { ensureLayout, layoutDesign, placeNewEntities } from '../flow/layout'
import {
  defaultCodeType,
  localID,
  type Attribute,
  type Cardinality,
  type Entity,
  type ERDesign,
  type Relation,
} from '../types/dsl'
import { validateDesign, type ValidationReport } from '../validate/dsl'

export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'relation'; id: string }
  | null

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface Toast {
  kind: 'info' | 'error'
  text: string
}

interface StoreState {
  ready: boolean
  bootError: string | null
  projects: Project[]
  project: Project | null

  models: ModelItem[]
  providers: ProviderInfo[]
  selectedModel: { provider: string; model: string; base_url?: string } | null
  modelsLoading: boolean
  modelsError: string | null

  design: ERDesign
  selection: Selection
  report: ValidationReport
  serverWarnings: string[]

  saveState: SaveState
  saveError: string | null

  aiRunning: boolean
  aiThinking: string
  aiStatus: string
  aiError: string | null
  aiResult: ERDesignAnalysisResult | null

  toast: Toast | null

  dslView: 'canvas' | 'code'
}

interface StoreActions {
  bootstrap: () => Promise<void>
  selectProject: (id: string) => Promise<void>
  createProject: (name: string) => Promise<void>
  reload: () => Promise<void>

  fetchModels: (params?: GetModelsParams) => Promise<AvailableModelsResponse | null>
  selectModel: (provider: string, model: string, base_url?: string) => void
  saveAndSwitchModel: (params: SaveModelParams) => Promise<boolean>

  select: (selection: Selection) => void
  dismissToast: () => void
  dismissAiResult: () => void

  setDslView: (view: 'canvas' | 'code') => void

  moveEntity: (id: string, position: { x: number; y: number }) => void
  moveEntities: (moves: Array<{ id: string; position: { x: number; y: number } }>) => void
  addEntity: (position?: { x: number; y: number }) => void
  renameEntity: (id: string, name: string) => void
  deleteEntity: (id: string) => void

  addAttribute: (entityID: string) => void
  updateAttribute: (entityID: string, attributeID: string, patch: Partial<Attribute>) => void
  deleteAttribute: (entityID: string, attributeID: string) => void
  moveAttribute: (entityID: string, attributeID: string, direction: -1 | 1) => void

  addRelation: (sourceEntityID: string, targetEntityID: string) => void
  updateRelation: (id: string, patch: Partial<Relation>) => void
  deleteRelation: (id: string) => void

  autoLayout: () => void
  importDesign: (design: ERDesign) => void
  runAI: (input: string) => Promise<void>
  saveNow: () => Promise<void>
}

type Store = StoreState & StoreActions

const SAVE_DEBOUNCE_MS = 700

/** 本地变更计数：用来判断一次保存请求返回时，用户是否又改了东西。 */
let mutationCount = 0
let saveTimer: number | null = null
let saveInFlight = false
let savePending = false

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export const useStore = create<Store>((set, get) => {
  function recompute(design: ERDesign, extras?: Partial<StoreState>) {
    set({
      design,
      report: validateDesign(design),
      ...extras,
    })
  }

  function scheduleSave() {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }

  async function flushSave() {
    const { project, design } = get()
    if (!project) {
      return
    }
    if (saveInFlight) {
      savePending = true
      return
    }

    const countAtStart = mutationCount
    saveInFlight = true
    set({ saveState: 'saving', saveError: null })

    try {
      const result = await api.saveERDesign(project.id, design)
      const changedDuringRequest = mutationCount !== countAtStart
      set({
        saveState: 'saved',
        saveError: null,
        serverWarnings: result.warnings ?? [],
      })
      // 保存期间用户又改了东西时，不要用服务端返回值覆盖本地编辑。
      if (!changedDuringRequest) {
        const currentPositions = new Map(get().design.entities.map((e) => [e.id, e.position]))
        const posByName = new Map(get().design.entities.map((e) => [e.name.toLowerCase(), e.position]))
        const mergedEntities = result.design.entities.map((e) => ({
          ...e,
          position: e.position ?? currentPositions.get(e.id) ?? posByName.get(e.name.toLowerCase()),
        }))
        recompute(ensureLayout({ ...result.design, entities: mergedEntities }))
      }
    } catch (error) {
      set({ saveState: 'error', saveError: errorMessage(error) })
    } finally {
      saveInFlight = false
      if (savePending) {
        savePending = false
        scheduleSave()
      }
    }
  }

  function mutate(next: ERDesign) {
    mutationCount += 1
    recompute(next)
    scheduleSave()
  }

  function withEntities(updater: (entities: Entity[]) => Entity[]) {
    const { design } = get()
    mutate({ ...design, entities: updater(design.entities) })
  }

  return {
    ready: false,
    bootError: null,
    projects: [],
    project: null,
    models: [],
    providers: [],
    selectedModel: null,
    modelsLoading: false,
    modelsError: null,
    design: { entities: [], relations: [] },
    selection: null,
    report: { errors: [], warnings: [] },
    serverWarnings: [],
    saveState: 'idle',
    saveError: null,
    aiRunning: false,
    aiThinking: '',
    aiStatus: '',
    aiError: null,
    aiResult: null,
    toast: null,
    dslView: 'canvas',

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
            (m) => m.provider === selectedModel?.provider && m.model === selectedModel?.model
          )
        ) {
          if (res.default_provider && res.default_model) {
            const found = models.find(
              (m) => m.provider === res.default_provider && m.model === res.default_model
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
      // 切换模型时同步持久化到服务端的 config.yaml，保持与 CC-Switch 一致的配置写入
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
      try {
        void get().fetchModels()
        let projects = await api.listProjects()
        if (projects.length === 0) {
          await api.createProject('未命名项目', '由前端首次启动自动创建')
          projects = await api.listProjects()
        }
        const project = projects[0]
        const detail = await api.getProject(project.id)
        const design = await api.getERDesign(project.id)
        set({
          ready: true,
          bootError: null,
          projects,
          project: detail,
          selection: null,
        })
        recompute(ensureLayout(design))
      } catch (error) {
        set({ ready: true, bootError: errorMessage(error) })
      }
    },

    async selectProject(id) {
      try {
        const [detail, design] = await Promise.all([api.getProject(id), api.getERDesign(id)])
        set({ project: detail, selection: null, serverWarnings: [], aiResult: null, aiError: null })
        recompute(ensureLayout(design))
        mutationCount = 0
      } catch (error) {
        set({ toast: { kind: 'error', text: errorMessage(error) } })
      }
    },

    async createProject(name) {
      try {
        const project = await api.createProject(name)
        const projects = await api.listProjects()
        set({ projects, project, selection: null, aiResult: null })
        recompute({ entities: [], relations: [] })
        mutationCount = 0
      } catch (error) {
        set({ toast: { kind: 'error', text: errorMessage(error) } })
      }
    },

    async reload() {
      const { project } = get()
      if (!project) {
        return
      }
      try {
        const design = await api.getERDesign(project.id)
        recompute(ensureLayout(design))
        set({ aiResult: null, aiError: null })
        mutationCount = 0
      } catch (error) {
        set({ toast: { kind: 'error', text: errorMessage(error) } })
      }
    },

    select(selection) {
      set({ selection })
    },

    dismissToast() {
      set({ toast: null })
    },

    dismissAiResult() {
      set({ aiResult: null, aiError: null, aiThinking: '', aiStatus: '' })
    },

    setDslView(view) {
      set({ dslView: view })
    },

    moveEntity(id, position) {
      withEntities((entities) =>
        entities.map((entity) => (entity.id === id ? { ...entity, position } : entity)),
      )
    },

    moveEntities(moves) {
      if (moves.length === 0) return
      const moveMap = new Map(moves.map((m) => [m.id, m.position]))
      withEntities((entities) =>
        entities.map((entity) => {
          const pos = moveMap.get(entity.id)
          return pos ? { ...entity, position: pos } : entity
        }),
      )
    },

    addEntity(customPosition) {
      const { design } = get()
      const name = uniqueEntityName(design, 'new_table')
      const entity: Entity = {
        id: localID('ent'),
        name,
        position: customPosition
          ? {
              x: Math.round(customPosition.x / 20) * 20,
              y: Math.round(customPosition.y / 20) * 20,
            }
          : undefined,
        attributes: [
          {
            id: localID('attr'),
            name: 'id',
            db_type: 'BIGINT',
            code_type: 'uint64',
            is_primary_key: true,
            is_nullable: false,
            is_unique: false,
            description: '主键',
          },
        ],
      }

      const placed = customPosition
        ? { ...design, entities: [...design.entities, entity] }
        : placeNewEntities(
            { ...design, entities: [...design.entities, entity] },
            [entity.id],
          )
      mutationCount += 1
      recompute(placed, { selection: { kind: 'entity', id: entity.id } })
      scheduleSave()
    },

    renameEntity(id, name) {
      withEntities((entities) =>
        entities.map((entity) => (entity.id === id ? { ...entity, name } : entity)),
      )
    },

    deleteEntity(id) {
      const { design, selection } = get()
      const next: ERDesign = {
        entities: design.entities.filter((entity) => entity.id !== id),
        relations: design.relations.filter(
          (relation) => relation.source_entity_id !== id && relation.target_entity_id !== id,
        ),
      }
      const removedRelations = design.relations.length - next.relations.length
      mutationCount += 1
      recompute(next, {
        selection: selection?.kind === 'entity' && selection.id === id ? null : selection,
      })
      scheduleSave()
      if (removedRelations > 0) {
        set({
          toast: {
            kind: 'info',
            text: `已删除实体，并连带移除 ${removedRelations} 条关系`,
          },
        })
      }
    },

    addAttribute(entityID) {
      withEntities((entities) =>
        entities.map((entity) =>
          entity.id === entityID
            ? {
                ...entity,
                attributes: [
                  ...entity.attributes,
                  {
                    id: localID('attr'),
                    name: uniqueFieldName(entity, 'field'),
                    db_type: 'VARCHAR(255)',
                    code_type: 'string',
                    is_primary_key: false,
                    is_nullable: true,
                    is_unique: false,
                    description: '',
                  },
                ],
              }
            : entity,
        ),
      )
    },

    updateAttribute(entityID, attributeID, patch) {
      withEntities((entities) =>
        entities.map((entity) => {
          if (entity.id !== entityID) {
            return entity
          }
          return {
            ...entity,
            attributes: entity.attributes.map((attribute) => {
              if (attribute.id !== attributeID) {
                return attribute
              }
              const next = { ...attribute, ...patch }
              // 改了数据库类型但没显式改 Go 类型时，同步推导，避免两者长期漂移。
              if (patch.db_type !== undefined && patch.code_type === undefined) {
                next.code_type = defaultCodeType(patch.db_type)
              }
              if (next.is_primary_key) {
                next.is_nullable = false
              }
              return next
            }),
          }
        }),
      )
    },

    deleteAttribute(entityID, attributeID) {
      withEntities((entities) =>
        entities.map((entity) =>
          entity.id === entityID
            ? {
                ...entity,
                attributes: entity.attributes.filter((attribute) => attribute.id !== attributeID),
              }
            : entity,
        ),
      )
    },

    moveAttribute(entityID, attributeID, direction) {
      withEntities((entities) =>
        entities.map((entity) => {
          if (entity.id !== entityID) {
            return entity
          }
          const index = entity.attributes.findIndex((attribute) => attribute.id === attributeID)
          const target = index + direction
          if (index < 0 || target < 0 || target >= entity.attributes.length) {
            return entity
          }
          const attributes = [...entity.attributes]
          const [moved] = attributes.splice(index, 1)
          attributes.splice(target, 0, moved)
          return { ...entity, attributes }
        }),
      )
    },

    addRelation(sourceEntityID, targetEntityID) {
      const { design } = get()
      if (sourceEntityID === targetEntityID) {
        set({ toast: { kind: 'error', text: '暂不支持把实体连到自己，请先在 Inspector 里手工确认自引用是否必要' } })
        return
      }
      const duplicate = design.relations.some(
        (relation) =>
          relation.source_entity_id === sourceEntityID && relation.target_entity_id === targetEntityID,
      )
      if (duplicate) {
        set({ toast: { kind: 'error', text: '这两个实体之间已经存在同方向的关系' } })
        return
      }

      const relation: Relation = {
        id: localID('rel'),
        source_entity_id: sourceEntityID,
        target_entity_id: targetEntityID,
        cardinality: 'one_to_many',
      }
      mutationCount += 1
      recompute(
        { ...design, relations: [...design.relations, relation] },
        { selection: { kind: 'relation', id: relation.id } },
      )
      scheduleSave()
    },

    updateRelation(id, patch) {
      const { design } = get()
      mutationCount += 1
      recompute({
        ...design,
        relations: design.relations.map((relation) =>
          relation.id === id ? { ...relation, ...patch } : relation,
        ),
      })
      scheduleSave()
    },

    deleteRelation(id) {
      const { design, selection } = get()
      mutationCount += 1
      recompute(
        {
          ...design,
          relations: design.relations.filter((relation) => relation.id !== id),
        },
        { selection: selection?.kind === 'relation' && selection.id === id ? null : selection },
      )
      scheduleSave()
    },

    autoLayout() {
      const { design } = get()
      mutationCount += 1
      recompute(layoutDesign(design))
      scheduleSave()
    },

    importDesign(design) {
      mutationCount += 1
      recompute(ensureLayout(design), { selection: null, aiResult: null, aiError: null })
      scheduleSave()
    },

    async runAI(input) {
      const { project, selectedModel } = get()
      if (!project) {
        return
      }
      set({
        aiRunning: true,
        aiError: null,
        aiResult: null,
        aiThinking: '',
        aiStatus: 'AI 正在分析需求…',
      })

      let finalDesign: ERDesign | null = null

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
              } else if (event.type === 'result') {
                if (event.data && typeof event.data === 'object' && Array.isArray((event.data as any).entities)) {
                  finalDesign = event.data as ERDesign
                }
              } else if (event.type === 'error') {
                set({ aiError: String(event.data) })
              }
            },
            onError: (err) => {
              set({ aiRunning: false, aiError: errorMessage(err) })
            },
            onDone: () => {
              set({ aiRunning: false, aiStatus: '' })

              if (finalDesign) {
                const currentEntities = get().design.entities
                const posByID = new Map(currentEntities.map((entity) => [entity.id, entity.position]))
                const posByName = new Map(currentEntities.map((entity) => [entity.name.toLowerCase(), entity.position]))

                const before = new Set(currentEntities.map((entity) => entity.id))
                const added = finalDesign.entities
                  .filter((entity) => !before.has(entity.id))
                  .map((entity) => entity.id)

                const mergedEntities = finalDesign.entities.map((entity) => ({
                  ...entity,
                  position: entity.position ?? posByID.get(entity.id) ?? posByName.get(entity.name.toLowerCase()),
                }))
                const designWithPos = { ...finalDesign, entities: mergedEntities }

                mutationCount = 0
                const nextDesign = ensureLayout(placeNewEntities(designWithPos, added))
                recompute(nextDesign, { serverWarnings: [] })
                scheduleSave()
                set({
                  aiResult: {
                    applied: true,
                    design: finalDesign,
                    requirement: {
                      summary: '数据模型设计已生成并自动落库',
                      explicit_requirements: [],
                      negative_constraints: [],
                      assumptions: [],
                      decisions: [],
                      need_clarification: false,
                      questions: [],
                      operation_scope: 'create',
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
                      summary: '回复完毕',
                      explicit_requirements: [],
                      negative_constraints: [],
                      assumptions: [],
                      decisions: [],
                      need_clarification: false,
                      questions: [],
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

    async saveNow() {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer)
        saveTimer = null
      }
      await flushSave()
    },
  }
})

function uniqueEntityName(design: ERDesign, base: string): string {
  const used = new Set(design.entities.map((entity) => entity.name.toLowerCase()))
  if (!used.has(base)) {
    return base
  }
  let index = 2
  while (used.has(`${base}_${index}`)) {
    index += 1
  }
  return `${base}_${index}`
}

function uniqueFieldName(entity: Entity, base: string): string {
  const used = new Set(entity.attributes.map((attribute) => attribute.name.toLowerCase()))
  if (!used.has(base)) {
    return base
  }
  let index = 2
  while (used.has(`${base}_${index}`)) {
    index += 1
  }
  return `${base}_${index}`
}

/** 组件里常用的便捷选择器。 */
export function useSelectedEntity(): Entity | null {
  return useStore((state) => {
    if (state.selection?.kind !== 'entity') {
      return null
    }
    return state.design.entities.find((entity) => entity.id === state.selection!.id) ?? null
  })
}

export function useSelectedRelation(): Relation | null {
  return useStore((state) => {
    if (state.selection?.kind !== 'relation') {
      return null
    }
    return state.design.relations.find((relation) => relation.id === state.selection!.id) ?? null
  })
}

export type { Cardinality, ERDesign }
