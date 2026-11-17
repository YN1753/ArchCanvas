import type { Entity, Relation } from '../types/dsl'
import { isForeignKeyColumnName, matchesEntityForeignKeyColumn } from './foreignKey'
import { toSingular, toSnakeCase } from './inflect'

/**
 * 统一审计与技术元数据列名集合（与后端 junction 判定规则严格对齐）
 */
export const UNIFIED_AUDIT_COLUMNS = new Set([
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'create_time',
  'update_time',
  'delete_time',
  'created_by',
  'updated_by',
  'deleted_by',
  'creator_id',
  'updater_id',
  'tenant_id',
  'org_id',
  'version',
  'is_deleted',
  'remark',
  'note',
  'sort',
  'sort_order',
  'seq',
  'weight',
])

const AUDIT_FK_COLUMNS = new Set(['creator_id', 'updater_id', 'tenant_id', 'org_id'])

export interface JunctionDetectionResult {
  isJunction: boolean
  leftEntity?: Entity
  rightEntity?: Entity
  businessFieldCount?: number
}

function resolveJunctionParents(
  entity: Entity,
  allEntities: readonly Entity[],
  relations?: readonly Relation[],
): { matchedParents: Entity[]; matchedFkAttrIds: Set<string> } {
  const attributes = entity.attributes ?? []
  const entityById = new Map(allEntities.map((e) => [e.id, e]))
  const matchedParents: Entity[] = []
  const matchedFkAttrIds = new Set<string>()

  const addParent = (parent: Entity, fkAttrId?: string) => {
    if (parent.id === entity.id) return
    if (!matchedParents.some((p) => p.id === parent.id)) {
      matchedParents.push(parent)
    }
    if (fkAttrId) {
      matchedFkAttrIds.add(fkAttrId)
    }
  }

  // 1. 显式关联关系（parent -> entity）
  if (relations && relations.length > 0) {
    for (const rel of relations) {
      if (rel.target_entity_id === entity.id && rel.source_entity_id !== entity.id) {
        const parent = entityById.get(rel.source_entity_id)
        if (parent) {
          const matchingFk = attributes.find(
            (a) =>
              !matchedFkAttrIds.has(a.id) &&
              isForeignKeyColumnName(a.name) &&
              matchesEntityForeignKeyColumn(a.name, parent.name),
          )
          addParent(parent, matchingFk?.id)
        }
      }
    }
  }

  // 2. 精确 `<singular_target>_id` 外键列匹配（优先非审计外键列，避免 tenant_id 抢占主关联端）
  const fkAttrs = attributes.filter((a) => isForeignKeyColumnName(a.name))
  const primaryFkAttrs = fkAttrs.filter((a) => !AUDIT_FK_COLUMNS.has(toSnakeCase(a.name)))
  const fallbackAuditFkAttrs = fkAttrs.filter((a) => AUDIT_FK_COLUMNS.has(toSnakeCase(a.name)))

  const matchFkList = (list: typeof fkAttrs) => {
    for (const fk of list) {
      for (const candidate of allEntities) {
        if (candidate.id === entity.id) continue
        if (matchesEntityForeignKeyColumn(fk.name, candidate.name)) {
          addParent(candidate, fk.id)
          break
        }
      }
    }
  }

  matchFkList(primaryFkAttrs)
  if (matchedParents.length < 2) {
    matchFkList(fallbackAuditFkAttrs)
  }

  // 3. 组合表名提示兜底（例如 user_roles, article_tags, media_resource_tags）
  const normName = toSnakeCase(entity.name)
  if (matchedParents.length < 2 && normName.includes('_')) {
    const tokens = normName.split('_').filter(Boolean)
    // 支持二元切分前缀/后缀精确词形匹配（兼容复合词表名）
    for (let split = 1; split < tokens.length && matchedParents.length < 2; split++) {
      const leftPart = toSingular(tokens.slice(0, split).join('_'))
      const rightPart = toSingular(tokens.slice(split).join('_'))
      const leftCand = allEntities.find(
        (c) => c.id !== entity.id && toSingular(toSnakeCase(c.name)) === leftPart,
      )
      const rightCand = allEntities.find(
        (c) =>
          c.id !== entity.id &&
          c.id !== leftCand?.id &&
          toSingular(toSnakeCase(c.name)) === rightPart,
      )
      if (leftCand && rightCand) {
        addParent(leftCand)
        addParent(rightCand)
        break
      }
    }

    if (matchedParents.length < 2) {
      for (const part of tokens) {
        const partSingular = toSingular(part)
        for (const candidate of allEntities) {
          if (candidate.id === entity.id) continue
          const cSnake = toSnakeCase(candidate.name)
          if (cSnake === part || toSingular(cSnake) === partSingular) {
            addParent(candidate)
            break
          }
        }
      }
    }
  }

  return { matchedParents, matchedFkAttrIds }
}

function countBusinessColumns(entity: Entity, matchedFkAttrIds: Set<string>): number {
  const attributes = entity.attributes ?? []
  let count = 0
  for (const attr of attributes) {
    if (matchedFkAttrIds.has(attr.id)) continue
    if (attr.is_primary_key) continue
    const lower = toSnakeCase(attr.name)
    if (UNIFIED_AUDIT_COLUMNS.has(lower)) continue
    count += 1
  }
  return count
}

function isCandidateRawJunction(
  entity: Entity,
  allEntities: readonly Entity[],
  relations?: readonly Relation[],
): boolean {
  if (entity.is_junction_table === false) return false
  if (entity.is_junction_table === true) return true
  const attributes = entity.attributes ?? []
  if (attributes.length > 7) return false
  const { matchedParents, matchedFkAttrIds } = resolveJunctionParents(entity, allEntities, relations)
  if (matchedParents.length < 2) return false
  return countBusinessColumns(entity, matchedFkAttrIds) <= 1
}

function isReferencedByNonJunctionEntity(
  entity: Entity,
  allEntities: readonly Entity[],
  relations?: readonly Relation[],
): boolean {
  if (relations && relations.length > 0) {
    for (const rel of relations) {
      if (rel.source_entity_id === entity.id && rel.target_entity_id !== entity.id) {
        const child = allEntities.find((e) => e.id === rel.target_entity_id)
        if (child && !isCandidateRawJunction(child, allEntities)) {
          return true
        }
      }
    }
  }

  for (const other of allEntities) {
    if (other.id === entity.id) continue
    const hasFkToEntity = (other.attributes ?? []).some(
      (a) => !a.is_primary_key && matchesEntityForeignKeyColumn(a.name, entity.name),
    )
    if (hasFkToEntity && !isCandidateRawJunction(other, allEntities)) {
      return true
    }
  }

  return false
}

/**
 * 统一多对多纯技术中间表（Junction Table）判定算法：
 * 1. 用户显式 `is_junction_table` 覆盖优先；
 * 2. 至少解析出 2 个不同关联父实体（显式 relations 或精确 `<singular_target>_id` + 组合表名提示，禁止子串误判）；
 * 3. 总列数 `<= 7`，且剔除主键、外键与统一审计列后至多包含 1 个轻量业务列；
 * 4. 未被其他非中间表实体作为父表外键引用。
 */
export function detectJunctionTable(
  entity: Entity,
  allEntities: readonly Entity[],
  relations?: readonly Relation[],
): JunctionDetectionResult {
  if (entity.is_junction_table === false) {
    return { isJunction: false, businessFieldCount: 0 }
  }

  const attributes = entity.attributes ?? []
  const { matchedParents, matchedFkAttrIds } = resolveJunctionParents(entity, allEntities, relations)

  if (matchedParents.length < 2) {
    return { isJunction: false, businessFieldCount: attributes.length }
  }

  if (entity.is_junction_table === true) {
    return {
      isJunction: true,
      leftEntity: matchedParents[0],
      rightEntity: matchedParents[1],
      businessFieldCount: 0,
    }
  }

  const businessFieldCount = countBusinessColumns(entity, matchedFkAttrIds)

  if (attributes.length > 7 || businessFieldCount > 1) {
    return {
      isJunction: false,
      leftEntity: matchedParents[0],
      rightEntity: matchedParents[1],
      businessFieldCount,
    }
  }

  if (isReferencedByNonJunctionEntity(entity, allEntities, relations)) {
    return {
      isJunction: false,
      leftEntity: matchedParents[0],
      rightEntity: matchedParents[1],
      businessFieldCount,
    }
  }

  return {
    isJunction: true,
    leftEntity: matchedParents[0],
    rightEntity: matchedParents[1],
    businessFieldCount,
  }
}
