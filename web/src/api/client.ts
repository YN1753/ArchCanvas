import {
  localID,
  type Cardinality,
  type ConceptualDesign,
  type DatabaseDialect,
  type ERDesign,
  type SchemaReviewReport,
} from '../types/dsl'
import { downloadBlob } from '../utils/download'

const BASE = import.meta.env?.VITE_API_BASE || '/api/v1'
const VISITOR_STORAGE_KEY = 'archcanvas_visitor_id'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let inMemoryVisitorId: string | null = null

export function getOrCreateVisitorID(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(VISITOR_STORAGE_KEY)?.trim()
      if (existing && UUID_RE.test(existing)) {
        inMemoryVisitorId = existing
        return existing
      }
      const generated = localID()
      localStorage.setItem(VISITOR_STORAGE_KEY, generated)
      inMemoryVisitorId = generated
      return generated
    }
  } catch {}
  if (!inMemoryVisitorId) {
    inMemoryVisitorId = localID()
  }
  return inMemoryVisitorId
}

type QuotaHeaderListener = (update: { ipRemaining?: number; globalRemaining?: number }) => void
let quotaHeaderListener: QuotaHeaderListener | null = null

export function setShowcaseQuotaListener(listener: QuotaHeaderListener | null): void {
  quotaHeaderListener = listener
}

function captureResponseMetadata(res: Response): void {
  try {
    const serverVid = res.headers?.get?.('X-Visitor-ID')?.trim()
    if (serverVid && UUID_RE.test(serverVid)) {
      inMemoryVisitorId = serverVid
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(VISITOR_STORAGE_KEY, serverVid)
      }
    }
    if (quotaHeaderListener && res.headers?.get) {
      const ipRemStr = res.headers.get('X-RateLimit-Remaining')
      const globalRemStr = res.headers.get('X-GlobalLimit-Remaining')
      if (ipRemStr !== null || globalRemStr !== null) {
        const ipRemaining = ipRemStr !== null ? Number(ipRemStr) : undefined
        const globalRemaining = globalRemStr !== null ? Number(globalRemStr) : undefined
        quotaHeaderListener({
          ipRemaining: Number.isFinite(ipRemaining) ? ipRemaining : undefined,
          globalRemaining: Number.isFinite(globalRemaining) ? globalRemaining : undefined,
        })
      }
    }
  } catch {}
}

function buildAuthHeaders(): Record<string, string> {
  const envToken = import.meta.env?.VITE_AUTH_TOKEN as string | undefined
  let storedToken: string | null = null
  try {
    if (typeof localStorage !== 'undefined') {
      storedToken = localStorage.getItem('archcanvas_auth_token')
    }
  } catch {}
  const token = (storedToken || envToken || '').trim()
  const headers: Record<string, string> = {
    'X-Visitor-ID': getOrCreateVisitorID(),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

interface Envelope<T> {
  code: number
  message: string
  data: T
}

export interface Project {
  id: string
  name: string
  description: string
  is_template?: boolean
  conceptual_design?: ConceptualDesign
  er_design?: ERDesign
  created_at: string
  updated_at: string
}

export interface ShowcaseStatus {
  enabled: boolean
  visitor_id?: string
  ip_daily_limit?: number
  ip_used?: number
  ip_remaining?: number
  global_daily_limit?: number
  global_used?: number
  global_remaining?: number
  visitor_ttl_hours?: number
  max_projects_per_visitor?: number
  readonly_models?: boolean
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
  need_clarification: boolean
  clarification_cards?: ClarificationCard[]
  questions: string[]
}

export interface ERDesignAnalysisResult {
  requirement: RequirementResult | null
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

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options)
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
        ...buildAuthHeaders(),
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    throw new ApiError(0, `无法连接后端服务，请确认 server 已启动（${String(error)}）`, {
      cause: error,
    })
  }

  captureResponseMetadata(response)

  const text = await response.text()
  let envelope: Envelope<T> | null = null
  if (text) {
    try {
      envelope = JSON.parse(text) as Envelope<T>
    } catch (error) {
      throw new ApiError(response.status, `响应不是合法 JSON：${text.slice(0, 200)}`, {
        cause: error,
      })
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

export type ChatEventType =
  | 'thinking'
  | 'status'
  | 'tool_call'
  | 'result'
  | 'error'
  | 'done'
  | 'message'

export interface ChatEvent<T = unknown> {
  type: ChatEventType
  data: T
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

export interface EnrichSemanticsParams {
  project_id: string
  dialect?: DatabaseDialect
  design?: ERDesign
  model_provider?: string
  model_name?: string
}

export interface EnrichedSemanticsResult {
  design: ERDesign
  conceptual_design: ConceptualDesign
}

export interface ProposeConceptsPayload {
  summary?: string
  need_clarification?: boolean
  clarification_cards?: ClarificationCard[]
  questions?: string[]
  conceptual_design?: ConceptualDesign
}

const PLAIN_TEXT_SSE_EVENTS = new Set<string>(['thinking', 'status', 'error', 'done'])

export async function streamPost<T = unknown>(
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
        ...buildAuthHeaders(),
      },
      body: JSON.stringify(params),
      signal,
    })
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (isAbort || signal?.aborted) {
      return
    }
    const error = new ApiError(0, `无法连接后端服务（${String(err)}）`, { cause: err })
    callbacks.onError?.(error)
    throw error
  }

  captureResponseMetadata(response)

  if (!response.ok) {
    const text = await response.text()
    let msg = `请求失败（HTTP ${response.status}）`
    try {
      const parsed = JSON.parse(text) as { message?: string }
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
  let currentEvent: ChatEventType = 'message'
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

    let parsedData: unknown = rawData
    if (!PLAIN_TEXT_SSE_EVENTS.has(eventType)) {
      try {
        parsedData = JSON.parse(rawData)
      } catch {
        parsedData = rawData
      }
    }
    callbacks.onEvent({
      type: eventType,
      data: parsedData as T,
    })
  }

  const processLine = (line: string) => {
    // 严格按 SSE 空行边界派发事件，避免全空白文本 token 被误判为事件分隔符
    if (line === '') {
      dispatchEvent()
      return
    }
    if (line.startsWith(':')) {
      return
    }
    if (line.startsWith('event:')) {
      currentEvent = (line.slice(6).trim() || 'message') as ChatEventType
    } else if (line.startsWith('data:')) {
      // 后端 gin-contrib/sse 输出格式为 `data:<chunk>`（冒号后无协议空格），直接保留 slice(5) 以免吞掉英文词首空格
      dataLines.push(line.slice(5))
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r\n|\r|\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        processLine(line)
      }
    }

    // 冲刷流末尾残余多字节字符
    buffer += decoder.decode()
    if (buffer.length > 0) {
      const trailingLines = buffer.split(/\r\n|\r|\n/)
      for (const line of trailingLines) {
        processLine(line)
      }
    }
    dispatchEvent()
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (isAbort || signal?.aborted) {
      return
    }
    const normalized = err instanceof Error ? err : new Error(String(err))
    callbacks.onError?.(normalized)
    throw normalized
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }

  if (!signal?.aborted) {
    callbacks.onDone?.()
  }
}

export function proposeConceptsStream(
  params: ProposeConceptsParams,
  callbacks: {
    onEvent: (event: ChatEvent<ProposeConceptsPayload | string>) => void
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
    onEvent: (event: ChatEvent<ERDesign | string>) => void
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
    onEvent: (event: ChatEvent<SchemaReviewReport | string>) => void
    onError?: (err: Error) => void
    onDone?: () => void
  },
  signal?: AbortSignal,
): Promise<void> {
  return streamPost<SchemaReviewReport | string>('/agent/review-schema', params, callbacks, signal)
}

export const api = {
  getShowcaseStatus: () => request<ShowcaseStatus>('/showcase/status'),

  listProjects: () => request<Project[]>('/projects/list'),

  createProject: (name: string, description = '') =>
    request<Project>('/projects/create', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  forkProject: (project_id: string, name?: string) =>
    request<Project>('/projects/fork', {
      method: 'POST',
      body: JSON.stringify({
        project_id,
        ...(name ? { name } : {}),
      }),
    }),

  deleteProject: (project_id: string) =>
    request<{ deleted: boolean; id: string }>('/projects/delete', {
      method: 'POST',
      body: JSON.stringify({ project_id }),
    }),

  updateProject: (project_id: string, name: string, description?: string) =>
    request<Project>('/projects/update', {
      method: 'POST',
      body: JSON.stringify({
        project_id,
        name,
        ...(description !== undefined ? { description } : {}),
      }),
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
        entities: (design.entities ?? []).map((e) => ({
          ...e,
          attributes: (e.attributes ?? []).map((attr) => ({
            ...attr,
            default_value:
              attr.default_value === undefined || attr.default_value === null
                ? undefined
                : String(attr.default_value),
          })),
        })),
        relations: (design.relations ?? []).map((r) => {
          const card: Cardinality =
            r.cardinality || (r.relation_type_id as Cardinality | undefined) || 'one_to_many'
          return {
            ...r,
            relation_type_id: card,
            cardinality: card,
          }
        }),
      }),
    }),

  saveConceptualDesign: (id: string, design: ConceptualDesign) =>
    request<string>('/projects/save-conceptual-design', {
      method: 'POST',
      body: JSON.stringify({
        project_id: id,
        design,
      }),
    }),

  proposeConceptsStream,
  derivePhysicalStream,
  reviewSchemaStream,

  /**
   * 一键调用轻量 LLM 推导全图概念层语义
   */
  enrichSemantics: (params: EnrichSemanticsParams, signal?: AbortSignal) =>
    request<EnrichedSemanticsResult>('/agent/enrich-semantics', {
      method: 'POST',
      body: JSON.stringify(params),
      signal,
    }),

  /**
   * 获取可用的大模型列表。
   * 当携带自定义 base_url 或 api_key 探测时使用 POST JSON Body 传参，避免密钥出现在 URL Query 与日志中。
   */
  getModels: (params?: GetModelsParams) => {
    if (params?.base_url || params?.api_key) {
      return request<AvailableModelsResponse>('/models/list', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    }
    const query = new URLSearchParams()
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
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const text = await res.text()
      let message = `下载脚手架失败（HTTP ${res.status}）`
      if (text) {
        try {
          const parsed = JSON.parse(text) as { message?: string }
          if (parsed.message) {
            message = parsed.message
          } else {
            message = `下载脚手架失败: ${text.slice(0, 200)}`
          }
        } catch {
          message = `下载脚手架失败: ${text.slice(0, 200)}`
        }
      }
      throw new ApiError(res.status, message)
    }
    const blob = await res.blob()
    let filename = `${params.module_name || 'archcanvas-app'}.zip`
    if (filename.includes('/')) {
      filename = filename.substring(filename.lastIndexOf('/') + 1)
    }
    downloadBlob(blob, filename)
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
