import { cleanDialectIdent } from '../dialects'
import { inferReferencedEntity, isSelfRefForeignKeyColumn } from '../domain/foreignKey'
import { defaultCodeType, localID, type Entity, type ERDesign, type Relation } from '../types/dsl'
import {
  extractTrailingComment,
  findMatchingParen,
  findStatementSemicolon,
  isPositionInsideCommentOrString,
  splitTopLevelSQLItems,
  stripSQLComments,
} from './lexer'

export const cleanIdentifier = cleanDialectIdent

function unescapeSqlCommentLiteral(singleQuoted?: string, doubleQuoted?: string): string {
  const raw = singleQuoted ?? doubleQuoted ?? ''
  return raw
    .replace(/''/g, "'")
    .replace(/\\'/g, "'")
    .replace(/""/g, '"')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim()
}

const MYSQL_COMMENT_CLAUSE_RE =
  /\bCOMMENT\s*=?\s*(?:'((?:''|\\.|[^'\\])*)'|"((?:""|\\.|[^"\\])*)")/i

function extractDefaultValue(restSql: string): string | undefined {
  const match = restSql.match(
    /\bDEFAULT\s+(?:'((?:''|\\.|[^'\\])*)'|"((?:""|\\.|[^"\\])*)"|([A-Za-z_][A-Za-z0-9_]*(?:\(\))?|-?\d+(?:\.\d+)?))/i,
  )
  if (!match) return undefined
  if (match[1] !== undefined || match[2] !== undefined) {
    return unescapeSqlCommentLiteral(match[1], match[2])
  }
  const token = match[3]?.trim()
  if (!token || token.toUpperCase() === 'NULL') {
    return undefined
  }
  return token
}

export function extractTableCommentFromPreamble(sqlBeforeTable: string): string {
  const lines = sqlBeforeTable.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue

    const explicitMatch = line.match(/^--\s*(?:表说明|表注释|表描述|comment)\s*[:：]\s*(.+)$/i)
    if (explicitMatch) {
      return explicitMatch[1].trim()
    }

    const blockExplicitMatch = line.match(
      /^\/\*\s*(?:表说明|表注释|表描述|comment)\s*[:：]\s*(.+?)\s*\*\/$/i,
    )
    if (blockExplicitMatch) {
      return blockExplicitMatch[1].trim()
    }

    if (/^--\s*[-=~_*#]{3,}/.test(line) || /^#\s*[-=~_*#]{3,}/.test(line)) {
      continue
    }

    if (i >= lines.length - 2) {
      const genericLineMatch = line.match(/^--\s*(.+)$/)
      if (genericLineMatch) {
        const text = genericLineMatch[1].trim()
        if (
          !text.includes('自动生成') &&
          !text.includes('数据库方言') &&
          !text.includes('导出时间') &&
          !text.includes('实体总数')
        ) {
          return text
        }
      }
      const genericBlockMatch = line.match(/^\/\*\s*(.+?)\s*\*\/$/)
      if (genericBlockMatch) {
        const text = genericBlockMatch[1].trim()
        if (!text.includes('自动生成') && !text.includes('数据库方言')) {
          return text
        }
      }
    }

    if (!line.startsWith('--') && !line.startsWith('#') && !line.startsWith('/*')) {
      break
    }
  }
  return ''
}

export interface SQLImportResult {
  design: ERDesign
  warnings: string[]
  tableCount: number
  relationCount: number
}

export function parseSQLToDesign(sqlText: string): SQLImportResult {
  const warnings: string[] = []
  const createTableRegex =
    /CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.\u4e00-\u9fa5]+)\s*\(/gi

  const rawTables: Array<{ name: string; body: string; comment?: string }> = []
  let match: RegExpExecArray | null

  while ((match = createTableRegex.exec(sqlText)) !== null) {
    if (isPositionInsideCommentOrString(sqlText, match.index)) {
      continue
    }

    const tableName = cleanIdentifier(match[1])
    const openParenIndex = match.index + match[0].length - 1
    const startIndex = openParenIndex + 1

    const preamble = sqlText.slice(Math.max(0, match.index - 500), match.index)
    let tblComment = extractTableCommentFromPreamble(preamble)

    const endIndex = findMatchingParen(sqlText, openParenIndex)
    if (endIndex === -1) continue

    const body = sqlText.slice(startIndex, endIndex)
    const stmtEnd = findStatementSemicolon(sqlText, endIndex + 1, 500)
    const restAfterParen = sqlText.slice(endIndex + 1, stmtEnd)
    const commentMatch = restAfterParen.match(MYSQL_COMMENT_CLAUSE_RE)
    if (commentMatch) {
      tblComment = unescapeSqlCommentLiteral(commentMatch[1], commentMatch[2])
    }

    rawTables.push({ name: tableName, body, comment: tblComment || undefined })
    createTableRegex.lastIndex = endIndex + 1
  }

  if (rawTables.length === 0) {
    throw new Error('未在输入的 SQL 中识别到有效的 CREATE TABLE 建表语句，请检查 SQL 文本。')
  }

  const entities: Entity[] = []
  const entityMap = new Map<string, Entity>()
  const rawFKs: Array<{
    sourceTable: string
    sourceCol: string
    targetTable: string
    targetCol: string
  }> = []

  for (const rawTable of rawTables) {
    const entity: Entity = {
      id: localID(),
      name: rawTable.name,
      comment: rawTable.comment,
      attributes: [],
      indexes: [],
    }

    const items = splitTopLevelSQLItems(rawTable.body)
    const tablePrimaryKeys = new Set<string>()
    const tableSingleUniqueKeys = new Set<string>()

    for (const rawItem of items) {
      const itemTrimmed = rawItem.trim()
      if (!itemTrimmed) continue

      const { cleanSql, comment: inlineComment } = extractTrailingComment(itemTrimmed)
      const item = cleanSql.trim()
      if (!item) continue

      const pkMatch = item.match(/^(?:CONSTRAINT\s+[`"[\]\w]+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i)
      if (pkMatch) {
        const cols = pkMatch[1].split(',').map(cleanIdentifier).filter(Boolean)
        cols.forEach((c) => tablePrimaryKeys.add(c.toLowerCase()))
        continue
      }

      const fkMatch = item.match(
        /^(?:CONSTRAINT\s+[`"[\]\w]+\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([`"[\]\w.]+)\s*(?:\(([^)]+)\))?/i,
      )
      if (fkMatch) {
        const sourceCol = cleanIdentifier(fkMatch[1])
        const targetTable = cleanIdentifier(fkMatch[2])
        const targetCol = fkMatch[3] ? cleanIdentifier(fkMatch[3]) : 'id'
        rawFKs.push({
          sourceTable: entity.name,
          sourceCol,
          targetTable,
          targetCol,
        })
        continue
      }

      const ukMatch = item.match(
        /^(?:CONSTRAINT\s+[`"[\]\w]+\s+)?UNIQUE\s*(?:KEY|INDEX)?\s*([`"[\]\w]+)?\s*\(([^)]+)\)(.*)$/is,
      )
      if (ukMatch) {
        const cols = ukMatch[2].split(',').map(cleanIdentifier).filter(Boolean)
        if (cols.length === 1) {
          tableSingleUniqueKeys.add(cols[0].toLowerCase())
        }
        const ukCommentMatch = ukMatch[3]?.match(MYSQL_COMMENT_CLAUSE_RE)
        const ukComment = ukCommentMatch
          ? unescapeSqlCommentLiteral(ukCommentMatch[1], ukCommentMatch[2])
          : inlineComment
        const idxName = cleanIdentifier(ukMatch[1] || `uk_${entity.name}_${cols.join('_')}`)
        entity.indexes = entity.indexes || []
        entity.indexes.push({
          name: idxName,
          columns: cols,
          is_unique: true,
          comment: ukComment,
        })
        continue
      }

      const keyMatch = item.match(/^(?:KEY|INDEX)\s+([`"[\]\w]+)?\s*\(([^)]+)\)(.*)$/is)
      if (keyMatch) {
        const cols = keyMatch[2].split(',').map(cleanIdentifier).filter(Boolean)
        const keyCommentMatch = keyMatch[3]?.match(MYSQL_COMMENT_CLAUSE_RE)
        const keyComment = keyCommentMatch
          ? unescapeSqlCommentLiteral(keyCommentMatch[1], keyCommentMatch[2])
          : inlineComment
        const idxName = cleanIdentifier(keyMatch[1] || `idx_${entity.name}_${cols.join('_')}`)
        entity.indexes = entity.indexes || []
        entity.indexes.push({
          name: idxName,
          columns: cols,
          is_unique: false,
          comment: keyComment,
        })
        continue
      }

      if (/^(?:FULLTEXT|SPATIAL|CHECK)\b/i.test(item)) {
        continue
      }

      const colMatch = item.match(/^([`"[\]\w\u4e00-\u9fa5]+)\s+(.+)$/s)
      if (!colMatch) continue

      const colName = cleanIdentifier(colMatch[1])
      const rest = colMatch[2].trim()

      const typeMatch = rest.match(
        /^([a-zA-Z]+(?:\s+(?:PRECISION|VARYING|WITHOUT\s+TIME\s+ZONE|WITH\s+TIME\s+ZONE))?(?:\s*\([^)]*\))?(?:\s+(?:UNSIGNED|ZEROFILL))?)/i,
      )
      const dbType = typeMatch
        ? typeMatch[1].replace(/\s+/g, ' ').trim().toUpperCase()
        : 'VARCHAR(255)'

      const isPk =
        /\bPRIMARY\s+KEY\b/i.test(rest) ||
        /\bAUTO_INCREMENT\b/i.test(rest) ||
        /\bAUTOINCREMENT\b/i.test(rest) ||
        /\bIDENTITY\b/i.test(rest)
      const isUnique = /\bUNIQUE\b/i.test(rest)
      const isNotNull = /\bNOT\s+NULL\b/i.test(rest)
      const isNullable = isPk ? false : !isNotNull
      const defaultValue = extractDefaultValue(rest)

      let description = ''
      const commentMatch = rest.match(MYSQL_COMMENT_CLAUSE_RE)
      if (commentMatch) {
        description = unescapeSqlCommentLiteral(commentMatch[1], commentMatch[2])
      } else if (inlineComment) {
        description = inlineComment.trim()
      }

      const inlineRefMatch = rest.match(/\bREFERENCES\s+([`"[\]\w.]+)\s*(?:\(([`"[\]\w]+)\))?/i)
      if (inlineRefMatch) {
        const targetTable = cleanIdentifier(inlineRefMatch[1])
        const targetCol = inlineRefMatch[2] ? cleanIdentifier(inlineRefMatch[2]) : 'id'
        rawFKs.push({
          sourceTable: entity.name,
          sourceCol: colName,
          targetTable,
          targetCol,
        })
      }

      entity.attributes.push({
        id: localID(),
        name: colName,
        comment: description,
        db_type: dbType,
        code_type: defaultCodeType(dbType),
        is_primary_key: isPk,
        is_nullable: isNullable,
        is_unique: isUnique,
        ...(defaultValue !== undefined ? { default_value: defaultValue } : {}),
        description,
      })
    }

    for (const attr of entity.attributes) {
      const lowerCol = attr.name.toLowerCase()
      if (tablePrimaryKeys.has(lowerCol)) {
        attr.is_primary_key = true
        attr.is_nullable = false
      }
      if (tableSingleUniqueKeys.has(lowerCol)) {
        attr.is_unique = true
      }
    }

    entities.push(entity)
    entityMap.set(entity.name.toLowerCase(), entity)
  }

  const clean = stripSQLComments(sqlText)

  const standaloneIndexRegex =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.]+)\s+ON\s+([`"[\]\w.]+)\s*\(([^)]+)\)(?:\s+COMMENT\s+(?:'((?:''|\\.|[^'\\])*)'|"((?:""|\\.|[^"\\])*)"))?/gi
  let idxMatch: RegExpExecArray | null
  while ((idxMatch = standaloneIndexRegex.exec(clean)) !== null) {
    const isUnique = Boolean(idxMatch[1])
    const idxName = cleanIdentifier(idxMatch[2])
    const targetTable = cleanIdentifier(idxMatch[3]).toLowerCase()
    const cols = idxMatch[4].split(',').map(cleanIdentifier).filter(Boolean)
    const idxComment =
      idxMatch[5] !== undefined || idxMatch[6] !== undefined
        ? unescapeSqlCommentLiteral(idxMatch[5], idxMatch[6])
        : undefined

    const ent = entityMap.get(targetTable)
    if (ent) {
      if (isUnique && cols.length === 1) {
        const targetAttr = ent.attributes.find(
          (a) => a.name.toLowerCase() === cols[0].toLowerCase(),
        )
        if (targetAttr) targetAttr.is_unique = true
      }
      ent.indexes = ent.indexes || []
      if (!ent.indexes.some((i) => i.name.toLowerCase() === idxName.toLowerCase())) {
        ent.indexes.push({
          name: idxName,
          columns: cols,
          is_unique: isUnique,
          comment: idxComment,
        })
      }
    }
  }

  applyCommentOnStatements(clean, entityMap)

  const relations: Relation[] = []
  const relationKeys = new Set<string>()

  function addRelation(sourceEntity: Entity, targetEntity: Entity) {
    const key = `${sourceEntity.id}->${targetEntity.id}`
    if (relationKeys.has(key)) return
    relationKeys.add(key)
    relations.push({
      id: localID(),
      source_entity_id: sourceEntity.id,
      target_entity_id: targetEntity.id,
      cardinality: 'one_to_many',
    })
  }

  for (const fk of rawFKs) {
    const parentEntity = entityMap.get(fk.targetTable.toLowerCase())
    const childEntity = entityMap.get(fk.sourceTable.toLowerCase())
    if (parentEntity && childEntity) {
      addRelation(parentEntity, childEntity)
    } else {
      warnings.push(`外键引用目标表不存在：${fk.sourceTable}.${fk.sourceCol} -> ${fk.targetTable}`)
    }
  }

  for (const entity of entities) {
    for (const attr of entity.attributes) {
      if (attr.is_primary_key) continue
      if (isSelfRefForeignKeyColumn(attr.name)) {
        addRelation(entity, entity)
        continue
      }
      const parent = inferReferencedEntity(attr.name, entities, { excludeEntityId: entity.id })
      if (parent) {
        const key = `${parent.id}->${entity.id}`
        if (!relationKeys.has(key)) {
          addRelation(parent, entity)
          warnings.push(`自动识别逻辑外键：${entity.name}.${attr.name} 关联至 ${parent.name}`)
        }
      }
    }
  }

  return {
    design: { entities, relations },
    warnings,
    tableCount: entities.length,
    relationCount: relations.length,
  }
}

function applyCommentOnStatements(cleanSql: string, entityMap: Map<string, Entity>): void {
  const commentTableRegex =
    /COMMENT\s+ON\s+TABLE\s+([`"[\]\w.]+)\s+IS\s+(?:'((?:''|\\'|[^'])*)'|"((?:""|\\"|[^"])*)")/gi
  let tcMatch: RegExpExecArray | null
  while ((tcMatch = commentTableRegex.exec(cleanSql)) !== null) {
    const tbl = cleanIdentifier(tcMatch[1]).toLowerCase()
    const comm = unescapeSqlCommentLiteral(tcMatch[2], tcMatch[3])
    const ent = entityMap.get(tbl)
    if (ent && !ent.comment) {
      ent.comment = comm
    }
  }

  const commentColRegex =
    /COMMENT\s+ON\s+COLUMN\s+([`"[\]\w.]+)\.([`"[\]\w.]+)\s+IS\s+(?:'((?:''|\\'|[^'])*)'|"((?:""|\\"|[^"])*)")/gi
  let ccMatch: RegExpExecArray | null
  while ((ccMatch = commentColRegex.exec(cleanSql)) !== null) {
    const tbl = cleanIdentifier(ccMatch[1]).toLowerCase()
    const col = cleanIdentifier(ccMatch[2]).toLowerCase()
    const comm = unescapeSqlCommentLiteral(ccMatch[3], ccMatch[4])
    const ent = entityMap.get(tbl)
    if (ent) {
      const attr = ent.attributes.find((a) => a.name.toLowerCase() === col)
      if (attr) {
        attr.comment = comm
        if (!attr.description) attr.description = comm
      }
    }
  }

  const commentIdxRegex =
    /COMMENT\s+ON\s+INDEX\s+([`"[\]\w.]+)\s+IS\s+(?:'((?:''|\\'|[^'])*)'|"((?:""|\\"|[^"])*)")/gi
  let icMatch: RegExpExecArray | null
  while ((icMatch = commentIdxRegex.exec(cleanSql)) !== null) {
    const idxName = cleanIdentifier(icMatch[1]).toLowerCase()
    const comm = unescapeSqlCommentLiteral(icMatch[2], icMatch[3])
    for (const ent of entityMap.values()) {
      const foundIdx = ent.indexes?.find((i) => i.name.toLowerCase() === idxName)
      if (foundIdx && !foundIdx.comment) {
        foundIdx.comment = comm
        break
      }
    }
  }
}
