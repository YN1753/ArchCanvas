/**
 * ER DSL 类型定义。
 *
 * 这些类型是后端 `internal/domain/er_design.go` 的镜像，
 * 是整个前端的事实来源（Source of Truth）。
 *
 * 重要：React Flow 的 nodes / edges 只是这份 DSL 的投影视图，
 * 任何编辑都必须先改 DSL，再由 adapter 重新投影，禁止把 React Flow 的 JSON 当领域模型。
 */

export const CARDINALITIES = ['one_to_one', 'one_to_many', 'many_to_many'] as const
export type Cardinality = (typeof CARDINALITIES)[number]

export const CARDINALITY_LABEL: Record<Cardinality, string> = {
  one_to_one: '1:1',
  one_to_many: '1:N',
  many_to_many: 'N:M',
}

/** 概念视图（陈氏 ER）与物理视图（关系表）切换模式 */
export type CanvasViewMode = 'chen' | 'relational'

/** 常用数据库类型，供 Inspector 的下拉建议使用；允许自由输入。 */
export const DB_TYPE_SUGGESTIONS = [
  'BIGINT',
  'INT',
  'VARCHAR(64)',
  'VARCHAR(128)',
  'VARCHAR(255)',
  'TEXT',
  'BOOLEAN',
  'DATETIME',
  'DATE',
  'DECIMAL(10,2)',
  'BLOB',
] as const

export interface Position {
  x: number
  y: number
}

export interface IndexDefinition {
  name: string
  columns: string[]
  is_unique?: boolean
  comment?: string
}

export interface Attribute {
  id: string
  name: string
  comment?: string
  db_type: string
  code_type: string
  is_primary_key: boolean
  is_nullable: boolean
  is_unique: boolean
  /** 默认值表达式文本，与后端 `*string` 领域契约严格对齐。 */
  default_value?: string | null
  description: string
}

export interface Entity {
  id: string
  name: string
  comment?: string
  /** 为空表示尚未布局，交给自动布局决定。 */
  position?: Position
  attributes: Attribute[]
  indexes?: IndexDefinition[]
  /** 显式声明是否视为多对多技术中间表并在陈氏概念图中折叠为联系 */
  is_junction_table?: boolean
}

export interface Relation {
  id: string
  source_entity_id: string
  target_entity_id: string
  relation_type_id?: string
  cardinality: Cardinality
}

export interface ERDesign {
  entities: Entity[]
  relations: Relation[]
}

/**
 * 与后端 `generator/model.go` 100% 对齐的数据库类型 → Go 标准类型映射（精确区分有符号/无符号整型）。
 */
export function defaultCodeType(dbType: string): string {
  const upperFull = dbType.trim().toUpperCase().replace(/\s+/g, ' ')
  if (upperFull === 'TINYINT(1)' || upperFull.startsWith('TINYINT(1) ')) {
    return 'bool'
  }

  const isUnsigned = /\bUNSIGNED\b/.test(upperFull)
  const normalized = upperFull
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(?:UNSIGNED|ZEROFILL)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  switch (normalized) {
    case 'BOOLEAN':
    case 'BOOL':
      return 'bool'
    case 'BIGINT':
    case 'BIGSERIAL':
    case 'INT8':
      return isUnsigned ? 'uint64' : 'int64'
    case 'TINYINT':
      return isUnsigned ? 'uint8' : 'int8'
    case 'SMALLINT':
    case 'SMALLSERIAL':
    case 'INT2':
      return isUnsigned ? 'uint16' : 'int16'
    case 'INT':
    case 'INTEGER':
    case 'MEDIUMINT':
    case 'SERIAL':
    case 'INT4':
      return isUnsigned ? 'uint' : 'int'
    case 'DATETIME':
    case 'TIMESTAMP':
    case 'TIMESTAMPTZ':
    case 'TIMESTAMP WITH TIME ZONE':
    case 'TIMESTAMP WITHOUT TIME ZONE':
    case 'DATE':
    case 'TIME':
      return 'time.Time'
    case 'DECIMAL':
    case 'NUMERIC':
    case 'FLOAT':
    case 'DOUBLE':
    case 'DOUBLE PRECISION':
    case 'REAL':
      return 'float64'
    case 'BLOB':
    case 'LONGBLOB':
    case 'MEDIUMBLOB':
    case 'TINYBLOB':
    case 'BINARY':
    case 'VARBINARY':
    case 'BYTEA':
      return '[]byte'
    default:
      return 'string'
  }
}

let lastUuidV7Ms = 0
let uuidV7Seq = 0

/**
 * 生成符合 RFC 9562 标准的单调有序 UUIDv7。
 *
 * 前后端统一使用合法 UUIDv7：后端 `SaveByProjectID` 对归属本项目的合法 UUID 直接保留原值，
 * 从而彻底消除 700ms 自动保存后因换发 ID 或重排引起的 Undo/Redo JSON Pointer 错位与选中态丢失。
 */
export function localID(): string {
  const rand = new Uint8Array(16)
  crypto.getRandomValues(rand)

  let now = Date.now()
  if (now === lastUuidV7Ms) {
    uuidV7Seq = (uuidV7Seq + 1) & 0x0fff
    if (uuidV7Seq === 0) {
      now = lastUuidV7Ms + 1
      lastUuidV7Ms = now
    }
  } else {
    lastUuidV7Ms = now
    uuidV7Seq = ((rand[6] << 8) | rand[7]) & 0x03ff
  }

  const bytes = new Uint8Array(16)
  bytes[0] = Math.floor(now / 0x10000000000) & 0xff
  bytes[1] = Math.floor(now / 0x100000000) & 0xff
  bytes[2] = Math.floor(now / 0x1000000) & 0xff
  bytes[3] = Math.floor(now / 0x10000) & 0xff
  bytes[4] = Math.floor(now / 0x100) & 0xff
  bytes[5] = now & 0xff
  bytes[6] = 0x70 | ((uuidV7Seq >> 8) & 0x0f)
  bytes[7] = uuidV7Seq & 0xff
  bytes[8] = (rand[8] & 0x3f) | 0x80
  for (let i = 9; i < 16; i++) {
    bytes[i] = rand[i]
  }

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ---------------------------------------------------------------------------
// Layer 1: 业务概念模型 (Conceptual / Chen's ER Model)
// ---------------------------------------------------------------------------

export type ConceptOperation = 'create' | 'modify' | 'retain' | 'delete'
export type ConceptCardinality = 'one_to_one' | 'one_to_many' | 'many_to_many'
export type AttributeCategory = 'string' | 'number' | 'boolean' | 'datetime' | 'enum' | 'media'

export interface ConceptAttribute {
  id?: string
  name: string
  display_name?: string
  category: AttributeCategory
  description?: string
  is_business_key?: boolean
  required?: boolean
  is_unique?: boolean
  enum_value_options?: string[]
}

export interface BusinessConcept {
  id?: string
  name: string
  display_name?: string
  description?: string
  operation?: ConceptOperation
  position?: Position
  attributes: ConceptAttribute[]
}

export interface ConceptRelation {
  id?: string
  name?: string
  source_concept: string
  target_concept: string
  cardinality: ConceptCardinality
  description?: string
  position?: Position
}

export interface ConceptualDesign {
  summary?: string
  concepts: BusinessConcept[]
  relations: ConceptRelation[]
}

export function emptyConceptualDesign(): ConceptualDesign {
  return { concepts: [], relations: [] }
}

// ---------------------------------------------------------------------------
// Layer 3: 架构质量与性能守卫 (Schema Review / Health Report)
// ---------------------------------------------------------------------------

export type SchemaIssueSeverity = 'critical' | 'warning' | 'info'
export type SchemaIssueCategory = 'index' | 'normalization' | 'naming' | 'performance' | 'type_safety'

export interface SchemaIssue {
  id: string
  category: SchemaIssueCategory
  severity: SchemaIssueSeverity
  title: string
  description: string
  entity_name?: string
  column_name?: string
  suggestion: string
}

export interface SchemaReviewReport {
  score: number // 0-100
  summary: string
  passed_count: number
  total_count: number
  issues: SchemaIssue[]
}

export type DatabaseDialect = 'mysql' | 'postgres' | 'sqlite'
