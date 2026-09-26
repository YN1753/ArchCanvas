import type {
  ConceptualDesign,
  DatabaseDialect,
  ERDesign,
  SchemaReviewReport,
} from '../types/dsl'

const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

interface Envelope<T> {
  code: number
  message: string
  data: T
}

export interface Project {
  id: string
  name: string
  description: string
  conceptual_design?: ConceptualDesign
  er_design: ERDesign
  created_at: string
  updated_at: string
}

export interface ModelItem {
  provider: string
  model: string
  label: string
  base_url?: string
  is_default: boolean
}

export interface ProviderInfo {
  name: string
  base_url: string
  default_model: string
}

export interface AvailableModelsResponse {
  default_provider: string
  default_model: string
  providers?: ProviderInfo[]
  models: ModelItem[]
}

export interface GetModelsParams {
  base_url?: string
  api_key?: string
  provider?: string
}

export interface SaveModelParams {
  provider: string
  model: string
  base_url: string
  api_key?: string
  set_as_default?: boolean
}

export interface RequirementDecision {
  operation: 'create' | 'modify' | 'delete'
  target_type: 'entity' | 'attribute' | 'relation' | 'constraint'
  target: string
  description: string
  reason: string
  source: 'explicit' | 'inferred'
}

export interface ClarificationOption {
  id: string
  label: string
  description?: string
  is_default: boolean
}

export interface ClarificationCard {
  id: string
  title: string
  description?: string
  options: ClarificationOption[]
}

export interface RequirementResult {
  operation_scope: string
  summary: string
  explicit_requirements: string[]
  negative_constraints: string[]
  assumptions: string[]
  decisions: RequirementDecision[]
  need_clarification: boolean
  clarification_cards?: ClarificationCard[]
  questions: string[]
}

export interface ExecutionOperation {
  operation: string
  target_type: string
  target: string
  reason: string
  source: string
}

export interface ExecutionResult {
  summary: string
  operations: ExecutionOperation[]
  need_clarification: boolean
  questions: string[]
}

export interface ReviewResult {
  approved: boolean
  summary: string
  problems: string[]
  suggestions: string[]
}

export interface ERDesignAnalysisResult {
  requirement: RequirementResult | null
  execution: ExecutionResult | null
  review: ReviewResult | null
  applied: boolean
  note?: string
  design?: ERDesign
  changes?: string[]
}

export interface SaveERDesignResult {
  design: ERDesign
  warnings: string[] | null
}

/** 后端返回的是「HTTP 状态码 + 业务 message」，这里统一抛出可读错误。 */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    throw new ApiError(0, `无法连接后端服务，请确认 server 已启动（${String(error)}）`)
  }

  const text = await response.text()
  let envelope: Envelope<T> | null = null
  if (text) {
    try {
      envelope = JSON.parse(text) as Envelope<T>
    } catch {
      throw new ApiError(response.status, `响应不是合法 JSON：${text.slice(0, 200)}`)
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, envelope?.message ?? `请求失败（HTTP ${response.status}）`)
  }
  if (!envelope) {
    throw new ApiError(response.status, '后端返回了空响应')
  }

  return envelope.data
}

export interface ChatEvent<T = any> {
  type: 'thinking' | 'status' | 'tool_call' | 'result' | 'error' | 'done' | 'message'
  data: T
}

export interface ChatStreamParams {
  project_id: string
  input: string
  model_provider?: string
  model_name?: string
}

export interface ProposeConceptsParams {
  project_id: string
  input: string
  model_provider?: string
  model_name?: string
}

export interface DerivePhysicalParams {
  project_id: string
  dialect?: DatabaseDialect
  conceptual_design?: ConceptualDesign
  model_provider?: string
  model_name?: string
}

export interface ReviewSchemaParams {
  project_id: string
  dialect?: DatabaseDialect
  model_provider?: string
  model_name?: string
}

async function streamPost<T = any>(
  endpoint: string,
  params: unknown,
  callbacks: {
    onEvent: (event: ChatEvent<T>) => void
    onError?: (err: Error) => void
    onDone?: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      signal,
    })
  } catch (err) {
    const error = new ApiError(0, `无法连接后端服务（${String(err)}）`)
    callbacks.onError?.(error)
    throw error
  }

  if (!response.ok) {
    const text = await response.text()
    let msg = `请求失败（HTTP ${response.status}）`
    try {
      const parsed = JSON.parse(text)
      if (parsed.message) msg = parsed.message
    } catch {}
    const error = new ApiError(response.status, msg)
    callbacks.onError?.(error)
    throw error
  }

  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onDone?.()
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = 'message'
  let dataLines: string[] = []

  const dispatchEvent = () => {
    if (dataLines.length === 0) {
      currentEvent = 'message'
      return
    }
    const rawData = dataLines.join('\n')
    dataLines = []
    const eventType = currentEvent
    currentEvent = 'message'

    let parsedData: any = rawData
    try {
      parsedData = JSON.parse(rawData)
    } catch {
      parsedData = rawData
    }
    callbacks.onEvent({
      type: eventType as any,
      data: parsedData,
    })
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r\n|\r|\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) {
          dispatchEvent()
          continue
        }
        if (line.startsWith(':')) {
          continue
        }
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          const content = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
          dataLines.push(content)
        }
      }
    }

    if (buffer.trim()) {
      if (buffer.startsWith('event:')) {
        currentEvent = buffer.slice(6).trim()
      } else if (buffer.startsWith('data:')) {
        const content = buffer.startsWith('data: ') ? buffer.slice(6) : buffer.slice(5)
        dataLines.push(content)
      }
    }
    dispatchEvent()
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return
    }
    callbacks.onError?.(err)
    throw err
  } finally {
    callbacks.onDone?.()
  }
}

export function chatStream(
  params: ChatStreamParams,
  callbacks: {
    onEvent: (event: ChatEvent) => void
    onError?: (err: Error) => void
    onDone?: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  return streamPost('/agent/chat', params, callbacks, signal)
}

export function proposeConceptsStream(
  params: ProposeConceptsParams,
  callbacks: {
    onEvent: (event: ChatEvent) => void
    onError?: (err: Error) => void
    onDone?: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  return streamPost('/agent/propose-concepts', params, callbacks, signal)
}

export function derivePhysicalStream(
  params: DerivePhysicalParams,
  callbacks: {
    onEvent: (event: ChatEvent) => void
    onError?: (err: Error) => void
    onDone?: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  return streamPost('/agent/derive-physical', params, callbacks, signal)
}

export function reviewSchemaStream(
  params: ReviewSchemaParams,
  callbacks: {
    onEvent: (event: ChatEvent<SchemaReviewReport>) => void
    onError?: (err: Error) => void
    onDone?: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  return streamPost<SchemaReviewReport>('/agent/review-schema', params, callbacks, signal)
}

export const api = {
  listProjects: () => request<Project[]>('/projects/list'),

  createProject: (name: string, description = '') =>
    request<Project>('/projects/create', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  deleteProject: (project_id: string) =>
    request<{ deleted: boolean; id: string }>('/projects/delete', {
      method: 'POST',
      body: JSON.stringify({ project_id }),
    }),

  updateProject: (project_id: string, name: string, description = '') =>
    request<Project>('/projects/update', {
      method: 'POST',
      body: JSON.stringify({ project_id, name, description }),
    }),

  getProject: (id: string) =>
    request<Project>(`/projects/detail?id=${encodeURIComponent(id)}`),

  getERDesign: (id: string) =>
    request<ERDesign>(`/projects/get-er-design?id=${encodeURIComponent(id)}`),

  /**
   * 保存整份 ER 设计（纯语义化 POST 请求）。
   */
  saveERDesign: (id: string, design: ERDesign) =>
    request<SaveERDesignResult>('/projects/save-er-design', {
      method: 'POST',
      body: JSON.stringify({
        project_id: id,
        entities: design.entities,
        relations: design.relations,
      }),
    }),

  getConceptualDesign: (id: string) =>
    request<ConceptualDesign>(`/projects/get-conceptual-design?id=${id}`),

  saveConceptualDesign: (id: string, design: ConceptualDesign) =>
    request<string>('/projects/save-conceptual-design', {
      method: 'POST',
      body: JSON.stringify({
        project_id: id,
        design,
      }),
    }),

  /**
   * 自然语言 → ER 结构变更。
   */
  analyzeERDesign: (projectID: string, input: string, apply = true) =>
    request<ERDesignAnalysisResult>('/agent/er-design/analyze', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectID, input, apply }),
    }),

  chatStream,
  proposeConceptsStream,
  derivePhysicalStream,
  reviewSchemaStream,

  /**
   * 获取可用的大模型列表（语义化 GET /models/list）。
   * 支持通过 BaseURL 动态获取指定服务地址的模型，未指定时获取服务端配置的模型。
   */
  getModels: (params?: GetModelsParams) => {
    const query = new URLSearchParams()
    if (params?.base_url) query.set('base_url', params.base_url)
    if (params?.api_key) query.set('api_key', params.api_key)
    if (params?.provider) query.set('provider', params.provider)
    const qs = query.toString()
    return request<AvailableModelsResponse>(qs ? `/models/list?${qs}` : '/models/list')
  },

  /**
   * 保存并热切换模型配置，写入服务端的 config.yaml 与 .env 文件。
   */
  saveModel: (params: SaveModelParams) =>
    request<AvailableModelsResponse>('/models/save', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  /**
   * 预览生成的 Go 脚手架文件树与代码
   */
  previewScaffold: (params: GenerateRequest) =>
    request<GeneratedFile[]>('/generator/preview', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  /**
   * 触发下载 Go 工程脚手架 ZIP 压缩包
   */
  downloadScaffold: async (params: GenerateRequest) => {
    const res = await fetch(`${BASE}/generator/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`下载脚手架失败: ${text}`)
    }
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    let filename = `${params.module_name || 'archcanvas-app'}.zip`
    if (filename.includes('/')) {
      filename = filename.substring(filename.lastIndexOf('/') + 1)
    }
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  },

  /**
   * 获取项目的历史对话消息
   */
  getProjectMessages: (projectId: string) =>
    request<ProjectMessage[]>(`/projects/messages?project_id=${encodeURIComponent(projectId)}`),

  /**
   * 清空项目的历史对话
   */
  clearProjectMessages: (projectId: string) =>
    request<{ cleared: boolean; project_id: string }>('/projects/messages/clear', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId }),
    }),
}

export interface ProjectMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  updated_at: string
}

export interface GenerateRequest {
  project_id: string
  module_name: string
  port?: string
  db_driver?: string
  enable_redis?: boolean
  enable_docker?: boolean
  enable_soft_delete?: boolean
}

export interface GeneratedFile {
  path: string
  content: string
  size: number
}

