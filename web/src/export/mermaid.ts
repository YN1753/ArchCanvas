import { CARDINALITY_LABEL, type Attribute, type Cardinality, type ERDesign } from '../types/dsl'

/**
 * 导出 Mermaid erDiagram。
 *
 * 选择 Mermaid 而不是图片格式的原因：它是纯文本，可以直接贴进 Markdown、
 * 文档、issue、PR 描述里，评审时不需要来回截图；而且生成过程是纯函数，
 * 没有渲染依赖，改一行 DSL 就立刻能得到新图。
 */

const MANY_TO_MANY = '}o--o{'
const ONE_TO_MANY = '||--o{'
const ONE_TO_ONE = '||--||'

const CARDINALITY_SYMBOL: Record<Cardinality, string> = {
  one_to_one: ONE_TO_ONE,
  one_to_many: ONE_TO_MANY,
  many_to_many: MANY_TO_MANY,
}

const ASCII_ENTITY_IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/

/**
 * Mermaid 实体名：纯 ASCII 合法标识符直接输出；
 * 含中文或特殊字符的表名使用双引号包裹，杜绝多张中文表退化为同名 `__` 冲突。
 */
function formatEntityIdent(name: string, fallbackIndex: number): string {
  const trimmed = name.replace(/[\r\n]+/g, ' ').trim()
  if (!trimmed) {
    return `entity_${fallbackIndex + 1}`
  }
  if (ASCII_ENTITY_IDENT.test(trimmed)) {
    return trimmed
  }
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, "'")
  return `"${escaped}"`
}

/**
 * Mermaid 字段数据类型：Mermaid erDiagram 的字段类型词法不允许逗号与空格。
 * - 将数值精度如 `DECIMAL(10, 2)` 规范化为 `DECIMAL(10-2)`（避免生成丑陋的 `10_2`）
 * - 将 `ENUM('a','b')` 收敛为基础类型名 `ENUM`
 * - 将 `BIGINT UNSIGNED` 合并为 `BIGINT_UNSIGNED`
 */
function sanitizeType(rawType: string): string {
  const trimmed = rawType.trim()
  if (!trimmed) return 'VARCHAR'
  const numericPrecision = trimmed.replace(
    /\(\s*(\d+)\s*,\s*(\d+)\s*\)/g,
    '($1-$2)',
  )
  const withoutStringArgs = numericPrecision.replace(/\([^)]*['",][^)]*\)/g, '')
  const cleaned = withoutStringArgs
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_\-[\]()]/g, '_')
    .replace(/_+/g, '_')
  return cleaned.length > 0 ? cleaned : 'VARCHAR'
}

/**
 * Mermaid 字段名：ASCII 标识符原样保留；非 ASCII 字符转为稳健的 Unicode 十六进制后缀避免重名。
 */
function sanitizeAttrName(name: string, index: number): string {
  const trimmed = name.trim()
  if (!trimmed) return `field_${index + 1}`
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed)) {
    return trimmed
  }
  const converted = Array.from(trimmed)
    .map((ch) => (/[A-Za-z0-9_-]/.test(ch) ? ch : `u${ch.codePointAt(0)?.toString(16) ?? '0'}`))
    .join('')
  return /^[A-Za-z_]/.test(converted) ? converted : `f_${converted}`
}

function quote(comment: string): string {
  const singleLine = comment.replace(/[\r\n]+/g, ' ').trim()
  return `"${singleLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 外键推断：字段名形如 `<某实体名>_id`，且该实体确实存在于本设计中。
 */
function inferForeignKey(fieldName: string, entityNames: Set<string>): boolean {
  const lower = fieldName.trim().toLowerCase()
  if (!lower.endsWith('_id')) {
    return false
  }
  const base = lower.slice(0, -3)
  if (base.length === 0) {
    return false
  }
  if (entityNames.has(base)) {
    return true
  }
  if (base.endsWith('s') && entityNames.has(base.slice(0, -1))) {
    return true
  }
  if (entityNames.has(`${base}s`) || entityNames.has(`${base}es`)) {
    return true
  }
  if (base.endsWith('y') && entityNames.has(`${base.slice(0, -1)}ies`)) {
    return true
  }
  return false
}

function attributeLine(
  attribute: Attribute,
  index: number,
  entityNames: Set<string>,
): string {
  const parts = [sanitizeType(attribute.db_type), sanitizeAttrName(attribute.name, index)]

  const keys: string[] = []
  if (attribute.is_primary_key) {
    keys.push('PK')
  }
  if (inferForeignKey(attribute.name, entityNames)) {
    keys.push('FK')
  }
  if (attribute.is_unique) {
    keys.push('UK')
  }
  if (keys.length > 0) {
    parts.push(keys.join(','))
  }
  const desc = (attribute.description || attribute.comment || '').trim()
  if (desc) {
    parts.push(quote(desc))
  }

  return `    ${parts.join(' ')}`
}

export function toMermaid(design: ERDesign): string {
  const entityNames = new Set(design.entities.map((entity) => entity.name.trim().toLowerCase()))
  const entityIdentByID = new Map<string, string>()

  const lines: string[] = ['erDiagram']

  if (design.entities.length === 0) {
    lines.push('    %% 设计为空：先用自然语言生成，或在画布上新建实体')
    return lines.join('\n')
  }

  design.entities.forEach((entity, entityIdx) => {
    const ident = formatEntityIdent(entity.name, entityIdx)
    entityIdentByID.set(entity.id, ident)
    lines.push(`  ${ident} {`)
    if (entity.attributes.length === 0) {
      lines.push('    %% 该实体暂无字段')
    }
    entity.attributes.forEach((attribute, attrIdx) => {
      lines.push(attributeLine(attribute, attrIdx, entityNames))
    })
    lines.push('  }')
  })

  if (design.relations.length > 0) {
    lines.push('')
  }
  for (const relation of design.relations) {
    const sourceIdent = entityIdentByID.get(relation.source_entity_id)
    const targetIdent = entityIdentByID.get(relation.target_entity_id)
    if (!sourceIdent || !targetIdent) {
      continue
    }
    const card: Cardinality =
      relation.cardinality || (relation.relation_type_id as Cardinality | undefined) || 'one_to_many'
    const symbol = CARDINALITY_SYMBOL[card] ?? ONE_TO_MANY
    const label = CARDINALITY_LABEL[card] ?? '1:N'
    lines.push(`  ${sourceIdent} ${symbol} ${targetIdent} : "${label}"`)
  }

  return lines.join('\n')
}
