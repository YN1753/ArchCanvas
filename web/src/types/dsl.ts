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

export interface Attribute {
  id: string
  name: string
  db_type: string
  code_type: string
  is_primary_key: boolean
  is_nullable: boolean
  is_unique: boolean
  /** 任意 JSON 值：数字、布尔、字符串。后端以 json.RawMessage 承载。 */
  default_value?: unknown
  description: string
}

export interface Entity {
  id: string
  name: string
  /** 为空表示尚未布局，交给自动布局决定。 */
  position?: Position
  attributes: Attribute[]
}

export interface Relation {
  id: string
  source_entity_id: string
  target_entity_id: string
  cardinality: Cardinality
}

export interface ERDesign {
  entities: Entity[]
  relations: Relation[]
}

export function emptyDesign(): ERDesign {
  return { entities: [], relations: [] }
}

/** 后端类型映射表的子集，用于字段类型变更时同步 Go 类型。 */
export function defaultCodeType(dbType: string): string {
  const normalized = dbType.trim().toUpperCase().split('(')[0].trim()
  switch (normalized) {
    case 'BIGINT':
      return 'uint64'
    case 'INT':
    case 'INTEGER':
    case 'SMALLINT':
    case 'TINYINT':
      return 'int'
    case 'VARCHAR':
    case 'CHAR':
    case 'TEXT':
    case 'LONGTEXT':
      return 'string'
    case 'BOOLEAN':
    case 'BOOL':
      return 'bool'
    case 'DATETIME':
    case 'TIMESTAMP':
    case 'DATE':
    case 'TIME':
      return 'time.Time'
    case 'DECIMAL':
    case 'NUMERIC':
      return 'decimal.Decimal'
    case 'BLOB':
      return '[]byte'
    default:
      return 'string'
  }
}

/**
 * 生成前端本地 ID。
 *
 * 这里生成的 ID 只用于「尚未保存到后端的新对象」占位。
 * 保存时后端会按 ID 对齐，凡是带本地占位 ID 的对象都会被替换成后端 ID，
 * 因此占位 ID 与后端 ID 使用同一套前缀 + 不同长度，便于在界面上区分。
 */
export function localID(prefix: 'ent' | 'attr' | 'rel'): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${prefix}_local_${hex}`
}

export function isLocalID(id: string): boolean {
  return id.includes('_local_')
}
