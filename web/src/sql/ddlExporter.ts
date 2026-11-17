import { getDialect, type FormattedColumnItem } from '../dialects'
import type { DatabaseDialect, Entity, ERDesign, Relation } from '../types/dsl'

export function quoteIdent(ident: string, dialect: DatabaseDialect): string {
  return getDialect(dialect).quoteIdent(ident)
}

/**
 * 将单个实体表转化为目标方言的标准 SQL DDL 脚本
 * （含 CREATE TABLE、表与字段 COMMENT、复合主键、DEFAULT 与 CREATE INDEX）
 */
export function entityToSQL(entity: Entity, dialect: DatabaseDialect = 'mysql'): string {
  const strategy = getDialect(dialect)
  const tableComment = (entity.comment || '').trim()
  const qTable = strategy.quoteIdent(entity.name)

  if (!entity.attributes || entity.attributes.length === 0) {
    return `-- 实体 ${entity.name} 暂无字段定义，已跳过 CREATE TABLE ${qTable}`
  }

  const items: FormattedColumnItem[] = []
  const primaryKeys: string[] = []
  const pkCount = entity.attributes.filter((a) => a.is_primary_key).length
  const isCompositePk = pkCount > 1

  for (const attr of entity.attributes) {
    const quotedCol = strategy.quoteIdent(attr.name)
    const comment = (attr.comment || attr.description || '').trim()
    const isSingleAutoPk = attr.is_primary_key && !isCompositePk
    const normalizedType = strategy.normalizeColumnType(attr.db_type, isSingleAutoPk)
    const defaultClause = attr.is_primary_key
      ? ''
      : strategy.formatDefaultClause(attr.default_value)

    if (attr.is_primary_key) {
      primaryKeys.push(quotedCol)
    }

    items.push(
      strategy.formatColumn({
        attr,
        quotedCol,
        normalizedType,
        defaultClause,
        comment,
        isCompositePk,
      }),
    )
  }

  if (strategy.shouldEmitTablePrimaryKey(primaryKeys.length, isCompositePk)) {
    items.push({
      definition: `  PRIMARY KEY (${primaryKeys.join(', ')})`,
    })
  }

  const sqlChunks: string[] = []

  const preamble = strategy.formatTablePreamble(tableComment)
  if (preamble) {
    sqlChunks.push(preamble)
  }

  const bodyLines = items.map((item, idx) => {
    const comma = idx === items.length - 1 ? '' : ','
    return item.trailingLineComment
      ? `${item.definition}${comma} -- ${item.trailingLineComment}`
      : `${item.definition}${comma}`
  })

  sqlChunks.push(
    `${strategy.createTablePrefix(qTable)}\n${bodyLines.join('\n')}\n${strategy.createTableSuffix(tableComment)}`,
  )

  const commentStmts = strategy.formatCommentStatements(entity, qTable)
  if (commentStmts.length > 0) {
    sqlChunks.push(commentStmts.join('\n'))
  }

  if (entity.indexes && entity.indexes.length > 0) {
    const indexStmts: string[] = []
    for (const idx of entity.indexes) {
      if (!idx.name || !idx.columns || idx.columns.length === 0) continue
      const qIdx = strategy.quoteIdent(idx.name)
      const qCols = idx.columns.map((c) => strategy.quoteIdent(c)).join(', ')
      indexStmts.push(...strategy.formatIndexStatements(idx, qIdx, qTable, qCols))
    }
    if (indexStmts.length > 0) {
      sqlChunks.push(indexStmts.join('\n'))
    }
  }

  return sqlChunks.join('\n\n')
}

export function sortEntitiesTopologically(entities: Entity[], relations: Relation[]): Entity[] {
  if (entities.length <= 1 || relations.length === 0) {
    return entities
  }
  const byId = new Map(entities.map((e) => [e.id, e]))
  const inDegree = new Map<string, number>()
  const childrenMap = new Map<string, string[]>()
  for (const e of entities) {
    inDegree.set(e.id, 0)
    childrenMap.set(e.id, [])
  }

  const seenEdges = new Set<string>()
  for (const rel of relations) {
    if (
      rel.source_entity_id === rel.target_entity_id ||
      !byId.has(rel.source_entity_id) ||
      !byId.has(rel.target_entity_id)
    ) {
      continue
    }
    const edgeKey = `${rel.source_entity_id}->${rel.target_entity_id}`
    if (seenEdges.has(edgeKey)) continue
    seenEdges.add(edgeKey)
    childrenMap.get(rel.source_entity_id)!.push(rel.target_entity_id)
    inDegree.set(rel.target_entity_id, (inDegree.get(rel.target_entity_id) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const e of entities) {
    if ((inDegree.get(e.id) ?? 0) === 0) {
      queue.push(e.id)
    }
  }

  const ordered: Entity[] = []
  const emitted = new Set<string>()

  while (queue.length > 0) {
    const id = queue.shift()!
    if (emitted.has(id)) continue
    emitted.add(id)
    ordered.push(byId.get(id)!)

    for (const childId of childrenMap.get(id) ?? []) {
      const nextDeg = (inDegree.get(childId) ?? 1) - 1
      inDegree.set(childId, nextDeg)
      if (nextDeg === 0) {
        queue.push(childId)
      }
    }
  }

  for (const e of entities) {
    if (!emitted.has(e.id)) {
      ordered.push(e)
    }
  }
  return ordered
}

export function designToSQL(design: ERDesign, dialect: DatabaseDialect = 'mysql'): string {
  if (design.entities.length === 0) {
    return '-- 画布暂无实体数据表'
  }

  const strategy = getDialect(dialect)

  const chunks: string[] = [
    '-- =============================================',
    '-- ArchCanvas 自动生成的 SQL DDL 结构脚本',
    `-- 数据库方言: ${strategy.headerTitle}`,
    `-- 导出时间: ${new Date().toLocaleString()}`,
    `-- 实体总数: ${design.entities.length} | 关联总数: ${design.relations.length}`,
    '-- =============================================\n',
  ]

  const sortedEntities = sortEntitiesTopologically(design.entities, design.relations ?? [])
  for (const entity of sortedEntities) {
    chunks.push(entityToSQL(entity, dialect))
    chunks.push('')
  }

  return chunks.join('\n').trim()
}
