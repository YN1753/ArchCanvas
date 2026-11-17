import type { Attribute, Entity } from '../types/dsl'
import { toSingular, toSnakeCase } from './inflect'

/**
 * 统一外键（Foreign Key）解析与命名推断内核。
 * 供 React Flow 关系边锚点、TableNode 行高亮、Mermaid 导出与 SQL 逆向导入共同消费。
 */

const SELF_REF_PRIORITY_NAMES = [
  'parent_id',
  'reply_to_id',
  'manager_id',
  'pid',
  'leader_id',
  'superior_id',
  'root_id',
] as const

const SELF_REF_SET = new Set<string>(SELF_REF_PRIORITY_NAMES)

/**
 * 判断列名是否符合外键语法特征（`<xxx>_id` 或 camelCase `<xxx>Id`，排除主键 `id`）。
 */
export function isForeignKeyColumnName(rawName: string): boolean {
  const trimmed = rawName.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  if (lower === 'id') return false
  return lower.endsWith('_id') || /[a-z0-9]Id$/.test(trimmed)
}

/**
 * 判断列名是否为常见自引用外键列（如 `parent_id`, `reply_to_id`, `manager_id`）。
 */
export function isSelfRefForeignKeyColumn(rawName: string): boolean {
  const snake = toSnakeCase(rawName)
  if (!snake || snake === 'id') return false
  return (
    SELF_REF_SET.has(snake) ||
    (snake.startsWith('parent_') && snake.endsWith('_id')) ||
    snake.endsWith('_pid')
  )
}

/**
 * 从外键列名提取去除了 `_id` 后缀的基础目标词（例如 `user_id -> user`, `orderItemId -> order_item`）。
 */
export function extractForeignKeyBaseName(columnName: string): string | null {
  const trimmed = columnName.trim()
  if (!trimmed) return null
  const snake = toSnakeCase(trimmed)
  if (snake === 'id') return null
  if (snake.endsWith('_id') && snake.length > 3) {
    return snake.slice(0, -3)
  }
  const lower = trimmed.toLowerCase()
  if (lower.endsWith('id') && /[a-z0-9]Id$/.test(trimmed)) {
    return snake.replace(/_?id$/, '') || null
  }
  return null
}

/**
 * 严格判定外键列名是否精确指向目标实体表（基于词形单复数归一化，绝不使用 `.includes()` 子串模糊匹配）。
 */
export function matchesEntityForeignKeyColumn(columnName: string, targetEntityName: string): boolean {
  const fkBase = extractForeignKeyBaseName(columnName)
  if (!fkBase) return false

  const entSnake = toSnakeCase(targetEntityName)
  if (!entSnake) return false

  const entSingular = toSingular(entSnake)
  if (fkBase === entSingular || fkBase === entSnake) {
    return true
  }
  return toSingular(fkBase) === entSingular
}

/**
 * 根据字段名在实体集合中反查所引用的目标实体（用于 Mermaid FK 标记与 SQL 逻辑外键推导）。
 */
export function inferReferencedEntity(
  columnName: string,
  entities: readonly Entity[],
  options?: { excludeEntityId?: string },
): Entity | undefined {
  const fkBase = extractForeignKeyBaseName(columnName)
  if (!fkBase) return undefined
  const fkSingular = toSingular(fkBase)

  for (const entity of entities) {
    if (options?.excludeEntityId && entity.id === options.excludeEntityId) {
      continue
    }
    const entSnake = toSnakeCase(entity.name)
    if (!entSnake) continue
    if (entSnake === fkBase || toSingular(entSnake) === fkSingular) {
      return entity
    }
  }
  return undefined
}

/**
 * 解析实体的主键属性（无显式主键时回退至首个属性）。
 */
export function resolvePrimaryKeyAttribute(entity: Entity | undefined): Attribute | undefined {
  if (!entity?.attributes?.length) return undefined
  return entity.attributes.find((a) => a.is_primary_key) ?? entity.attributes[0]
}

/**
 * 在子表（`childEntity`）上解析指向父表（`parentEntity`）的最佳外键字段。
 * 支持：
 * 1. `<singular_target>_id` 精确匹配；
 * 2. 自引用 `parent_id` / `reply_to_id` / `manager_id` 等优先级匹配；
 * 3. 多条同向关联的 `usedAttrIds` 去重消歧（如 `buyer_id` 与 `seller_id`）。
 */
export function resolveRelationForeignKey(
  parentEntity: Entity | undefined,
  childEntity: Entity | undefined,
  options?: {
    usedAttrIds?: Set<string>
    allEntities?: readonly Entity[]
    fallbackToAnyNonPk?: boolean
  },
): Attribute | undefined {
  if (!parentEntity || !childEntity) return undefined
  const attrs = childEntity.attributes ?? []
  if (attrs.length === 0) return undefined

  const used = options?.usedAttrIds
  const isAvailable = (attr: Attribute) => !attr.is_primary_key && !(used && used.has(attr.id))
  const isSelf = parentEntity.id === childEntity.id

  if (isSelf) {
    for (const preferred of SELF_REF_PRIORITY_NAMES) {
      const exact = attrs.find((a) => isAvailable(a) && toSnakeCase(a.name) === preferred)
      if (exact) return exact
    }
    const selfPattern = attrs.find((a) => isAvailable(a) && isSelfRefForeignKeyColumn(a.name))
    if (selfPattern) return selfPattern

    const entityNamedSelf = attrs.find(
      (a) => isAvailable(a) && matchesEntityForeignKeyColumn(a.name, parentEntity.name),
    )
    if (entityNamedSelf) return entityNamedSelf

    return attrs.find((a) => isAvailable(a) && isForeignKeyColumnName(a.name))
  }

  // 1. 优先精确匹配 `<singular_parent>_id`
  const exactMatch = attrs.find(
    (a) => isAvailable(a) && matchesEntityForeignKeyColumn(a.name, parentEntity.name),
  )
  if (exactMatch) return exactMatch

  // 2. 角色型外键（如 buyer_id / seller_id / reviewer_id）：优先排除明确指向其他已存在实体的外键列
  const fkCandidates = attrs.filter((a) => isAvailable(a) && isForeignKeyColumnName(a.name))
  if (fkCandidates.length > 0) {
    if (options?.allEntities && options.allEntities.length > 0) {
      const unboundRoleFk = fkCandidates.find((a) => {
        const otherTarget = inferReferencedEntity(a.name, options.allEntities!)
        return !otherTarget || otherTarget.id === parentEntity.id
      })
      if (unboundRoleFk) return unboundRoleFk
    }
    return fkCandidates[0]
  }

  // 3. 可选兜底：首个可用非主键列（供画布连线锚点无外键列时平滑挂载）
  if (options?.fallbackToAnyNonPk) {
    return attrs.find((a) => isAvailable(a))
  }

  return undefined
}
