import type { ERDesign } from '../types/dsl'

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

export interface RequirementResult {
  operation_scope: string
  summary: string
  explicit_requirements: string[]
  negative_constraints: string[]
  assumptions: string[]
  decisions: RequirementDecision[]
  need_clarification: boolean
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
  type: 'thinking' | 'status' | 'tool_call' | 'result' | 'error' | 'done'
  data: T
}

export interface ChatStreamParams {
  project_id: string
  input: string
  model_provider?: string
  model_name?: string
}

export async function chatStream(
  params: ChatStreamParams,
  callbacks: {
    onEvent: (event: ChatEvent) => void
    onError?: (err: Error) => void
    onDone?: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${BASE}/agent/chat`, {
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

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      let currentEvent = 'message'
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          currentEvent = 'message'
          continue
        }
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim()
        } else if (trimmed.startsWith('data:')) {
          const rawData = trimmed.slice(5).trim()
          let parsedData: any = rawData
          try {
            parsedData = JSON.parse(rawData)
          } catch {
            parsedData = rawData
          }
          callbacks.onEvent({
            type: currentEvent as any,
            data: parsedData,
          })
        }
      }
    }
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

export const api = {
  listProjects: () => request<Project[]>('/projects/list'),

  createProject: (name: string, description = '') =>
    request<Project>('/projects/create', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
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

  /**
   * 自然语言 → ER 结构变更。
   */
  analyzeERDesign: (projectID: string, input: string, apply = true) =>
    request<ERDesignAnalysisResult>('/agent/er-design/analyze', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectID, input, apply }),
    }),

  chatStream,

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
}

