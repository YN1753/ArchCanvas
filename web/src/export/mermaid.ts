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

/**
 * Mermaid 的标识符只接受有限字符集。
 * 数据库类型里常见的 VARCHAR(64) / DECIMAL(10,2) 必须收敛成合法 token，
 * 逗号和空格会直接让 Mermaid 解析失败。
 */
function sanitize(token: string): string {
  const cleaned = token.trim().replace(/[^A-Za-z0-9_\-[\]()]/g, '_')
  return cleaned.length > 0 ? cleaned : '_'
}

function quote(comment: string): string {
  return `"${comment.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 外键推断：字段名形如 `<某实体名>_id`，且该实体确实存在于本设计中。
 *
 * DSL 目前没有独立的 FK 标记（外键通过 relation 表达），
 * 但 Mermaid 图里标出 FK 对阅读帮助很大，所以这里用命名约定做一次只读推断，
 * 不写回 DSL —— 推断结果不应污染事实来源。
 */
function inferForeignKey(fieldName: string, entityNames: Set<string>): boolean {
  if (!fieldName.endsWith('_id')) {
    return false
  }
  const base = fieldName.slice(0, -3)
  if (base.length === 0) {
    return false
  }
  if (entityNames.has(base)) {
    return true
  }
  // users -> user_id 这类单复数差异也认
  if (base.endsWith('s') && entityNames.has(base.slice(0, -1))) {
    return true
  }
  return entityNames.has(`${base}s`)
}

function attributeLine(
  attribute: Attribute,
  entityNames: Set<string>,
): string {
  const parts = [sanitize(attribute.db_type), sanitize(attribute.name)]

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
  if (attribute.description.trim()) {
    parts.push(quote(attribute.description.trim()))
  }

  return `    ${parts.join(' ')}`
}

export function toMermaid(design: ERDesign): string {
  const entityNames = new Set(design.entities.map((entity) => entity.name.toLowerCase()))
  const entityByID = new Map(design.entities.map((entity) => [entity.id, entity]))

  const lines: string[] = ['erDiagram']

  if (design.entities.length === 0) {
    lines.push('    %% 设计为空：先用自然语言生成，或在画布上新建实体')
    return lines.join('\n')
  }

  for (const entity of design.entities) {
    lines.push(`  ${sanitize(entity.name)} {`)
    if (entity.attributes.length === 0) {
      lines.push('    %% 该实体暂无字段')
    }
    for (const attribute of entity.attributes) {
      lines.push(attributeLine(attribute, entityNames))
    }
    lines.push('  }')
  }

  if (design.relations.length > 0) {
    lines.push('')
  }
  for (const relation of design.relations) {
    const source = entityByID.get(relation.source_entity_id)
    const target = entityByID.get(relation.target_entity_id)
    if (!source || !target) {
      continue
    }
    const symbol = CARDINALITY_SYMBOL[relation.cardinality]
    lines.push(
      `  ${sanitize(source.name)} ${symbol} ${sanitize(target.name)} : "${CARDINALITY_LABEL[relation.cardinality]}"`,
    )
  }

  return lines.join('\n')
}
