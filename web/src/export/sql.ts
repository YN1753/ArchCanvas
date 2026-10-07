import {
  defaultCodeType,
  localID,
  type DatabaseDialect,
  type Entity,
  type ERDesign,
  type Relation,
} from '../types/dsl'

/**
 * 格式化 SQL 字符串字面量转义
 */
function escapeSqlString(str: string, dialect: DatabaseDialect): string {
  if (dialect === 'mysql') {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }
  return str.replace(/'/g, "''")
}

/**
 * 格式化 SQL 标识符（表名、字段名、索引名）
 */
export function quoteIdent(ident: string, dialect: DatabaseDialect): string {
  const clean = cleanIdentifier(ident)
  if (dialect === 'mysql') {
    return `\`${clean}\``
  }
  return `"${clean}"`
}

/**
 * 适配不同方言的数据类型
 */
function normalizeTypeForDialect(typeStr: string, dialect: DatabaseDialect, isPk: boolean): string {
  const upper = (typeStr || '').trim().toUpperCase()
  if (!upper) {
    if (dialect === 'sqlite') return 'TEXT'
    return 'VARCHAR(255)'
  }

  if (dialect === 'postgres') {
    if (isPk && (upper.includes('INT') || upper === 'SERIAL' || upper === 'BIGSERIAL')) {
      return upper.includes('BIG') ? 'BIGSERIAL' : 'SERIAL'
    }
    if (upper === 'DATETIME') return 'TIMESTAMPTZ'
    if (upper === 'TINYINT' || upper === 'TINYINT(1)' || upper === 'TINYINT UNSIGNED') return 'SMALLINT'
    if (upper === 'BLOB') return 'BYTEA'
    if (upper.includes('INT UNSIGNED')) return upper.replace(' UNSIGNED', '')
    return upper
  }

  if (dialect === 'sqlite') {
    if (isPk && upper.includes('INT')) return 'INTEGER'
    if (upper.includes('VARCHAR') || upper === 'TEXT') return 'TEXT'
    if (upper.includes('INT')) return 'INTEGER'
    if (
      upper.includes('DECIMAL') ||
      upper.includes('NUMERIC') ||
      upper === 'REAL' ||
      upper === 'FLOAT' ||
      upper === 'DOUBLE'
    ) {
      return 'REAL'
    }
    if (upper === 'BLOB' || upper === 'BYTEA') return 'BLOB'
    return upper
  }

  // MySQL
  return upper
}

/**
 * 将单个实体表转化为标准 SQL DDL 脚本 (含 CREATE TABLE、表与字段 COMMENT、CREATE INDEX 索引定义)
 */
export function entityToSQL(entity: Entity, dialect: DatabaseDialect = 'mysql'): string {
  const lines: string[] = []
  const sqliteColItems: Array<{ def: string; comment?: string }> = []
  const primaryKeys: string[] = []
  const tableComment = (entity.comment || '').trim()
  const qTable = quoteIdent(entity.name, dialect)

  // 1. 列定义清单
  for (const attr of entity.attributes) {
    const qCol = quoteIdent(attr.name, dialect)
    const comment = (attr.comment || attr.description || '').trim()
    const colType = normalizeTypeForDialect(attr.db_type, dialect, attr.is_primary_key)

    if (dialect === 'mysql') {
      let line = `  ${qCol} ${colType}`
      if (attr.is_primary_key) {
        line += ' NOT NULL'
        if (colType.toUpperCase().includes('INT')) {
          line += ' AUTO_INCREMENT'
        }
        primaryKeys.push(qCol)
      } else if (!attr.is_nullable) {
        line += ' NOT NULL'
      } else {
        line += ' NULL'
      }

      if (attr.is_unique && !attr.is_primary_key) {
        line += ' UNIQUE'
      }

      if (comment) {
        line += ` COMMENT '${escapeSqlString(comment, 'mysql')}'`
      }
      lines.push(line)
    } else if (dialect === 'postgres') {
      let line = `  ${qCol} ${colType}`
      if (attr.is_primary_key) {
        line += ' PRIMARY KEY'
      } else if (!attr.is_nullable) {
        line += ' NOT NULL'
      }

      if (attr.is_unique && !attr.is_primary_key) {
        line += ' UNIQUE'
      }
      lines.push(line)
    } else {
      // SQLite
      let line = `  ${qCol} ${colType}`
      if (attr.is_primary_key) {
        if (colType.toUpperCase().includes('INT')) {
          line += ' PRIMARY KEY AUTOINCREMENT'
        } else {
          line += ' PRIMARY KEY'
        }
      } else if (!attr.is_nullable) {
        line += ' NOT NULL'
      }

      if (attr.is_unique && !attr.is_primary_key) {
        line += ' UNIQUE'
      }

      sqliteColItems.push({
        def: line,
        comment: comment ? comment.replace(/\n/g, ' ') : undefined,
      })
    }
  }

  // 2. MySQL 表级复合主键
  if (dialect === 'mysql' && primaryKeys.length > 0) {
    lines.push(`  PRIMARY KEY (${primaryKeys.join(', ')})`)
  }

  // 3. 构建 CREATE TABLE 语句
  const sqlChunks: string[] = []

  if (dialect === 'sqlite' && tableComment) {
    sqlChunks.push(`-- 表说明: ${tableComment.replace(/\n/g, ' ')}`)
  }

  let createTableStmt = ''
  if (dialect === 'sqlite') {
    const formattedLines = sqliteColItems.map((item, idx) => {
      const isLast = idx === sqliteColItems.length - 1
      const comma = isLast ? '' : ','
      if (item.comment) {
        return `${item.def}${comma} -- ${item.comment}`
      }
      return `${item.def}${comma}`
    })
    createTableStmt = `CREATE TABLE IF NOT EXISTS ${qTable} (\n${formattedLines.join('\n')}\n);`
  } else {
    createTableStmt = `CREATE TABLE ${qTable} (\n${lines.join(',\n')}\n)`
    if (dialect === 'mysql') {
      createTableStmt += ` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      if (tableComment) {
        createTableStmt += ` COMMENT='${escapeSqlString(tableComment, 'mysql')}'`
      }
    }
    createTableStmt += ';'
  }
  sqlChunks.push(createTableStmt)

  // 4. PostgreSQL 表与列的独立 COMMENT 语句
  if (dialect === 'postgres') {
    const commentStmts: string[] = []
    if (tableComment) {
      commentStmts.push(`COMMENT ON TABLE ${qTable} IS '${escapeSqlString(tableComment, 'postgres')}';`)
    }
    for (const attr of entity.attributes) {
      const comment = (attr.comment || attr.description || '').trim()
      if (comment) {
        const qCol = quoteIdent(attr.name, dialect)
        commentStmts.push(`COMMENT ON COLUMN ${qTable}.${qCol} IS '${escapeSqlString(comment, 'postgres')}';`)
      }
    }
    if (commentStmts.length > 0) {
      sqlChunks.push(commentStmts.join('\n'))
    }
  }

  // 5. 索引生成 (CREATE [UNIQUE] INDEX ...)
  if (entity.indexes && entity.indexes.length > 0) {
    const indexStmts: string[] = []
    for (const idx of entity.indexes) {
      if (!idx.name || !idx.columns || idx.columns.length === 0) continue
      const qIdx = quoteIdent(idx.name, dialect)
      const qCols = idx.columns.map((c) => quoteIdent(c, dialect)).join(', ')
      const uniqueKeyword = idx.is_unique ? 'UNIQUE ' : ''
      const ifNotExists = dialect === 'mysql' ? '' : 'IF NOT EXISTS '

      let idxStmt = `CREATE ${uniqueKeyword}INDEX ${ifNotExists}${qIdx} ON ${qTable} (${qCols})`
      if (dialect === 'mysql' && idx.comment) {
        idxStmt += ` COMMENT '${escapeSqlString(idx.comment, 'mysql')}'`
      }
      idxStmt += ';'

      indexStmts.push(idxStmt)

      if (dialect === 'postgres' && idx.comment) {
        indexStmts.push(`COMMENT ON INDEX ${qIdx} IS '${escapeSqlString(idx.comment, 'postgres')}';`)
      }
    }

    if (indexStmts.length > 0) {
      sqlChunks.push(indexStmts.join('\n'))
    }
  }

  return sqlChunks.join('\n\n')
}

/**
 * 将整个 ER 设计转换为完整 SQL 脚本
 */
export function designToSQL(design: ERDesign, dialect: DatabaseDialect = 'mysql'): string {
  if (design.entities.length === 0) {
    return '-- 画布暂无实体数据表'
  }

  const dialectLabel =
    dialect === 'postgres'
      ? 'PostgreSQL'
      : dialect === 'sqlite'
        ? 'SQLite'
        : 'MySQL / MariaDB'

  const chunks: string[] = [
    '-- =============================================',
    '-- ArchCanvas 自动生成的 SQL DDL 结构脚本',
    `-- 数据库方言: ${dialectLabel}`,
    `-- 导出时间: ${new Date().toLocaleString()}`,
    `-- 实体总数: ${design.entities.length} | 关联总数: ${design.relations.length}`,
    '-- =============================================\n',
  ]

  for (const entity of design.entities) {
    chunks.push(entityToSQL(entity, dialect))
    chunks.push('')
  }

  return chunks.join('\n').trim()
}


/**
 * 清理标识符包裹符（反引号、双引号、中括号）与库名前缀
 */
export function cleanIdentifier(name: string): string {
  if (!name) return ''
  let s = name.trim()
  if (s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1)
  else if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  else if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  const parts = s.split('.')
  return parts[parts.length - 1].replace(/[`"\[\]]/g, '').trim()
}

/**
 * 剔除 SQL 注释（支持 /* ... *\/ 块注释、-- 行注释和 # 行注释，且不影响引号内的字符串）
 */
export function stripSQLComments(sql: string): string {
  let result = ''
  let i = 0
  const n = sql.length
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false

  while (i < n) {
    const char = sql[i]
    const next = sql[i + 1]

    if (inSingleQuote) {
      result += char
      if (char === '\\' && i + 1 < n) {
        result += next
        i += 2
        continue
      }
      if (char === "'") {
        if (next === "'") {
          result += next
          i += 2
          continue
        }
        inSingleQuote = false
      }
      i++
      continue
    }

    if (inDoubleQuote) {
      result += char
      if (char === '\\' && i + 1 < n) {
        result += next
        i += 2
        continue
      }
      if (char === '"') {
        if (next === '"') {
          result += next
          i += 2
          continue
        }
        inDoubleQuote = false
      }
      i++
      continue
    }

    if (inBacktick) {
      result += char
      if (char === '`') {
        inBacktick = false
      }
      i++
      continue
    }

    if (char === "'") {
      inSingleQuote = true
      result += char
      i++
      continue
    }
    if (char === '"') {
      inDoubleQuote = true
      result += char
      i++
      continue
    }
    if (char === '`') {
      inBacktick = true
      result += char
      i++
      continue
    }

    // Block comment: /* ... */
    if (char === '/' && next === '*') {
      const closeIdx = sql.indexOf('*/', i + 2)
      if (closeIdx === -1) break
      i = closeIdx + 2
      continue
    }

    // Line comment: -- or #
    if ((char === '-' && next === '-') || char === '#') {
      const newlineIdx = sql.indexOf('\n', i)
      if (newlineIdx === -1) break
      i = newlineIdx + 1
      result += '\n'
      continue
    }

    result += char
    i++
  }

  return result
}

/**
 * 提取 SQL 列或约束条目中的行内注释（-- 或 /* ... *\/ 或 #），并返回纯净 SQL 与注释文本
 */
export function extractItemComment(rawItem: string): { cleanSql: string; comment?: string } {
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let comment: string | undefined
  let cleanSql = ''

  for (let i = 0; i < rawItem.length; i++) {
    const char = rawItem[i]
    const next = rawItem[i + 1]

    if (inSingleQuote) {
      cleanSql += char
      if (char === '\\' && i + 1 < rawItem.length) {
        cleanSql += next
        i++
        continue
      }
      if (char === "'") {
        if (next === "'") {
          cleanSql += next
          i++
          continue
        }
        inSingleQuote = false
      }
      continue
    }

    if (inDoubleQuote) {
      cleanSql += char
      if (char === '\\' && i + 1 < rawItem.length) {
        cleanSql += next
        i++
        continue
      }
      if (char === '"') {
        if (next === '"') {
          cleanSql += next
          i++
          continue
        }
        inDoubleQuote = false
      }
      continue
    }

    if (inBacktick) {
      cleanSql += char
      if (char === '`') inBacktick = false
      continue
    }

    if (char === "'") {
      inSingleQuote = true
      cleanSql += char
      continue
    }
    if (char === '"') {
      inDoubleQuote = true
      cleanSql += char
      continue
    }
    if (char === '`') {
      inBacktick = true
      cleanSql += char
      continue
    }

    // 块注释 /* ... */
    if (char === '/' && next === '*') {
      const closeIdx = rawItem.indexOf('*/', i + 2)
      if (closeIdx !== -1) {
        const c = rawItem.slice(i + 2, closeIdx).trim()
        if (c && !comment) comment = c
        i = closeIdx + 1
        continue
      }
    }

    // 行注释 -- 或 #
    if ((char === '-' && next === '-') || char === '#') {
      const startOffset = char === '#' ? 1 : 2
      const c = rawItem.slice(i + startOffset).trim()
      if (c && !comment) {
        comment = c.replace(/,\s*$/, '').trim()
      }
      break
    }

    cleanSql += char
  }

  cleanSql = cleanSql.replace(/,\s*$/, '').trim()
  return { cleanSql, comment }
}

/**
 * 将 CREATE TABLE 内部字段及约束按顶级逗号拆分，忽略括号内参数中的逗号，且保留行尾注释归属
 */
export function splitTableItems(body: string): string[] {
  const items: string[] = []
  let current = ''
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inBlockComment = false
  let inLineComment = false

  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    const next = body[i + 1]

    if (inBlockComment) {
      current += char
      if (char === '*' && next === '/') {
        current += next
        i++
        inBlockComment = false
      }
      continue
    }

    if (inLineComment) {
      current += char
      if (char === '\n') {
        inLineComment = false
      }
      continue
    }

    if (inSingleQuote) {
      current += char
      if (char === '\\' && i + 1 < body.length) {
        current += next
        i++
        continue
      }
      if (char === "'") {
        if (next === "'") {
          current += next
          i++
          continue
        }
        inSingleQuote = false
      }
      continue
    }

    if (inDoubleQuote) {
      current += char
      if (char === '\\' && i + 1 < body.length) {
        current += next
        i++
        continue
      }
      if (char === '"') {
        if (next === '"') {
          current += next
          i++
          continue
        }
        inDoubleQuote = false
      }
      continue
    }

    if (inBacktick) {
      current += char
      if (char === '`') inBacktick = false
      continue
    }

    if (char === "'") {
      inSingleQuote = true
      current += char
      continue
    }
    if (char === '"') {
      inDoubleQuote = true
      current += char
      continue
    }
    if (char === '`') {
      inBacktick = true
      current += char
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      current += char + next
      i++
      continue
    }

    if ((char === '-' && next === '-') || char === '#') {
      inLineComment = true
      current += char
      continue
    }

    if (char === '(') {
      depth++
      current += char
      continue
    }
    if (char === ')') {
      depth--
      current += char
      continue
    }

    if (char === ',' && depth === 0) {
      // 检查逗号所在行后方是否紧跟行注释，若有则包含入当前 item
      let lookahead = i + 1
      let sawLineComment = false
      while (lookahead < body.length && body[lookahead] !== '\n') {
        const c = body[lookahead]
        const n = body[lookahead + 1]
        if ((c === '-' && n === '-') || c === '#') {
          sawLineComment = true
          break
        }
        if (c !== ' ' && c !== '\t' && c !== '\r') {
          break
        }
        lookahead++
      }

      if (sawLineComment) {
        while (lookahead < body.length && body[lookahead] !== '\n') {
          lookahead++
        }
        const trailingCommentChunk = body.slice(i, lookahead)
        current += trailingCommentChunk
        i = lookahead
      }

      if (current.trim()) items.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) items.push(current.trim())
  return items
}

/**
 * 校验指定字符索引是否位于 SQL 字符串字面量或注释中
 */
export function isPositionInsideCommentOrString(sql: string, targetPos: number): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inBlockComment = false
  let inLineComment = false

  for (let i = 0; i < targetPos && i < sql.length; i++) {
    const char = sql[i]
    const next = sql[i + 1]

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
      }
      continue
    }

    if (inSingleQuote) {
      if (char === '\\' && i + 1 < targetPos) {
        i++
        continue
      }
      if (char === "'") {
        if (next === "'") {
          i++
          continue
        }
        inSingleQuote = false
      }
      continue
    }

    if (inDoubleQuote) {
      if (char === '\\' && i + 1 < targetPos) {
        i++
        continue
      }
      if (char === '"') {
        if (next === '"') {
          i++
          continue
        }
        inDoubleQuote = false
      }
      continue
    }

    if (inBacktick) {
      if (char === '`') inBacktick = false
      continue
    }

    if (char === "'") {
      inSingleQuote = true
      continue
    }
    if (char === '"') {
      inDoubleQuote = true
      continue
    }
    if (char === '`') {
      inBacktick = true
      continue
    }
    if (char === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    if ((char === '-' && next === '-') || char === '#') {
      inLineComment = true
      continue
    }
  }

  return inSingleQuote || inDoubleQuote || inBacktick || inBlockComment || inLineComment
}

/**
 * 从建表语句前缀文本中回溯提取表注释（兼容 SQLite 的 -- 表说明: xxx 以及单行注释）
 */
export function extractTableCommentFromPreamble(sqlBeforeTable: string): string {
  const lines = sqlBeforeTable.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue

    const explicitMatch = line.match(/^--\s*(?:表说明|表注释|表描述|comment)\s*[:：]\s*(.+)$/i)
    if (explicitMatch) {
      return explicitMatch[1].trim()
    }

    const blockExplicitMatch = line.match(/^\/\*\s*(?:表说明|表注释|表描述|comment)\s*[:：]\s*(.+?)\s*\*\/$/i)
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

/**
 * 逆向解析 SQL DDL 脚本为 ArchCanvas ER 领域模型
 */
export function parseSQLToDesign(sqlText: string): SQLImportResult {
  const warnings: string[] = []
  const createTableRegex = /CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[\]\w.]+)\s*\(/gi

  const rawTables: Array<{ name: string; body: string; comment?: string }> = []
  let match: RegExpExecArray | null

  while ((match = createTableRegex.exec(sqlText)) !== null) {
    if (isPositionInsideCommentOrString(sqlText, match.index)) {
      continue
    }

    const rawTableName = match[1]
    const tableName = cleanIdentifier(rawTableName)
    const startIndex = match.index + match[0].length

    const preamble = sqlText.slice(Math.max(0, match.index - 500), match.index)
    let tblComment = extractTableCommentFromPreamble(preamble)

    let depth = 1
    let endIndex = -1
    let inSingleQuote = false
    let inDoubleQuote = false
    let inBacktick = false
    let inBlockComment = false
    let inLineComment = false

    for (let i = startIndex; i < sqlText.length; i++) {
      const char = sqlText[i]
      const next = sqlText[i + 1]

      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false
          i++
        }
        continue
      }

      if (inLineComment) {
        if (char === '\n') {
          inLineComment = false
        }
        continue
      }

      if (inSingleQuote) {
        if (char === '\\' && i + 1 < sqlText.length) {
          i++
          continue
        }
        if (char === "'") {
          if (next === "'") {
            i++
            continue
          }
          inSingleQuote = false
        }
        continue
      }

      if (inDoubleQuote) {
        if (char === '\\' && i + 1 < sqlText.length) {
          i++
          continue
        }
        if (char === '"') {
          if (next === '"') {
            i++
            continue
          }
          inDoubleQuote = false
        }
        continue
      }

      if (inBacktick) {
        if (char === '`') inBacktick = false
        continue
      }

      if (char === "'") {
        inSingleQuote = true
        continue
      }
      if (char === '"') {
        inDoubleQuote = true
        continue
      }
      if (char === '`') {
        inBacktick = true
        continue
      }
      if (char === '/' && next === '*') {
        inBlockComment = true
        i++
        continue
      }
      if ((char === '-' && next === '-') || char === '#') {
        inLineComment = true
        continue
      }

      if (char === '(') depth++
      else if (char === ')') {
        depth--
        if (depth === 0) {
          endIndex = i
          break
        }
      }
    }

    if (endIndex === -1) continue

    const body = sqlText.slice(startIndex, endIndex)
    const restAfterParen = sqlText.slice(
      endIndex + 1,
      sqlText.indexOf(';', endIndex + 1) !== -1 ? sqlText.indexOf(';', endIndex + 1) : endIndex + 200,
    )
    const commentMatch = restAfterParen.match(/\bCOMMENT\s*=\s*['"]([^'"]*)['"]/i)
    if (commentMatch) {
      tblComment = commentMatch[1].trim()
    }

    rawTables.push({ name: tableName, body, comment: tblComment })
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
      id: localID('ent'),
      name: rawTable.name,
      comment: (rawTable as any).comment || undefined,
      attributes: [],
      indexes: [],
    }

    const items = splitTableItems(rawTable.body)
    const tablePrimaryKeys = new Set<string>()
    const tableUniqueKeys = new Set<string>()

    for (const rawItem of items) {
      const itemTrimmed = rawItem.trim()
      if (!itemTrimmed) continue

      const { cleanSql, comment: inlineComment } = extractItemComment(itemTrimmed)
      const item = cleanSql.trim()
      if (!item) continue

      // PRIMARY KEY (col1, col2)
      const pkMatch = item.match(/^(?:CONSTRAINT\s+[`"\[\]\w]+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i)
      if (pkMatch) {
        const cols = pkMatch[1].split(',').map(cleanIdentifier)
        cols.forEach((c) => tablePrimaryKeys.add(c.toLowerCase()))
        continue
      }

      // FOREIGN KEY (col) REFERENCES target (target_col)
      const fkMatch = item.match(
        /^(?:CONSTRAINT\s+[`"\[\]\w]+\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([`"\[\]\w.]+)\s*(?:\(([^)]+)\))?/i,
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

      // UNIQUE KEY / INDEX (col1, col2)
      const ukMatch = item.match(
        /^(?:CONSTRAINT\s+[`"\[\]\w]+\s+)?UNIQUE\s*(?:KEY|INDEX)?\s*([`"\[\]\w]+)?\s*\(([^)]+)\)(?:\s+COMMENT\s+['"]([^'"]*)['"])?/i,
      )
      if (ukMatch) {
        const cols = ukMatch[2].split(',').map(cleanIdentifier)
        cols.forEach((c) => tableUniqueKeys.add(c.toLowerCase()))
        const idxName = cleanIdentifier(ukMatch[1] || `uk_${entity.name}_${cols.join('_')}`)
        entity.indexes = entity.indexes || []
        entity.indexes.push({
          name: idxName,
          columns: cols,
          is_unique: true,
          comment: ukMatch[3]?.trim() || inlineComment,
        })
        continue
      }

      // KEY `idx_name` (`col1`, `col2`) 或 INDEX `idx_name` (`col1`)
      const keyMatch = item.match(
        /^(?:KEY|INDEX)\s+([`"\[\]\w]+)?\s*\(([^)]+)\)(?:\s+COMMENT\s+['"]([^'"]*)['"])?/i,
      )
      if (keyMatch) {
        const cols = keyMatch[2].split(',').map(cleanIdentifier)
        const idxName = cleanIdentifier(keyMatch[1] || `idx_${entity.name}_${cols.join('_')}`)
        entity.indexes = entity.indexes || []
        entity.indexes.push({
          name: idxName,
          columns: cols,
          is_unique: false,
          comment: keyMatch[3]?.trim() || inlineComment,
        })
        continue
      }

      // 忽略特殊检查约束 (FULLTEXT, SPATIAL, CHECK)
      if (/^(?:FULLTEXT|SPATIAL|CHECK)\b/i.test(item)) {
        continue
      }

      // 解析字段定义: colName type [constraints...]
      const colMatch = item.match(/^([`"\[\]\w]+)\s+(.+)$/s)
      if (!colMatch) continue

      const colName = cleanIdentifier(colMatch[1])
      const rest = colMatch[2].trim()

      // 提取数据类型
      const typeMatch = rest.match(/^([a-zA-Z]+(?:\s*\([^)]*\))?(?:\s+(?:UNSIGNED|ZEROFILL|PRECISION|VARYING))?)/i)
      const dbType = typeMatch ? typeMatch[1].trim().toUpperCase() : 'VARCHAR(255)'

      // 判定内联约束
      const isPk =
        /\bPRIMARY\s+KEY\b/i.test(rest) ||
        /\bAUTO_INCREMENT\b/i.test(rest) ||
        /\bAUTOINCREMENT\b/i.test(rest) ||
        /\bIDENTITY\b/i.test(rest)
      const isUnique = /\bUNIQUE\b/i.test(rest)
      const isNotNull = /\bNOT\s+NULL\b/i.test(rest)
      const isNullable = isPk ? false : isNotNull ? false : true

      // 提取 COMMENT '...' 或 COMMENT "..."，若无则使用提取出的行内注释
      let description = ''
      const commentMatch = rest.match(/\bCOMMENT\s*['"]([^'"]*)['"]/i)
      if (commentMatch) {
        description = commentMatch[1].trim()
      } else if (inlineComment) {
        description = inlineComment.trim()
      }

      // 判定 PostgreSQL / SQLite 风格内联 REFERENCES
      const inlineRefMatch = rest.match(/\bREFERENCES\s+([`"\[\]\w.]+)\s*(?:\(([`"\[\]\w]+)\))?/i)
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
        id: localID('attr'),
        name: colName,
        comment: description,
        db_type: dbType,
        code_type: defaultCodeType(dbType),
        is_primary_key: isPk,
        is_nullable: isNullable,
        is_unique: isUnique,
        description,
      })
    }

    // 应用表级复合主键及唯一键
    for (const attr of entity.attributes) {
      const lowerCol = attr.name.toLowerCase()
      if (tablePrimaryKeys.has(lowerCol)) {
        attr.is_primary_key = true
        attr.is_nullable = false
      }
      if (tableUniqueKeys.has(lowerCol)) {
        attr.is_unique = true
      }
    }

    entities.push(entity)
    entityMap.set(entity.name.toLowerCase(), entity)
  }

  const clean = stripSQLComments(sqlText)

  // 额外解析独立建索引语句：CREATE [UNIQUE] INDEX ... ON table (cols)
  const standaloneIndexRegex =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[\]\w.]+)\s+ON\s+([`"\[\]\w.]+)\s*\(([^)]+)\)(?:\s+COMMENT\s+['"]([^'"]*)['"])?/gi
  let idxMatch: RegExpExecArray | null
  while ((idxMatch = standaloneIndexRegex.exec(clean)) !== null) {
    const isUnique = Boolean(idxMatch[1])
    const idxName = cleanIdentifier(idxMatch[2])
    const targetTable = cleanIdentifier(idxMatch[3]).toLowerCase()
    const cols = idxMatch[4].split(',').map(cleanIdentifier)
    const idxComment = idxMatch[5]?.trim()

    const ent = entityMap.get(targetTable)
    if (ent) {
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

  // 额外解析 PostgreSQL 风格的 COMMENT ON TABLE / COLUMN / INDEX
  function extractQuotedComment(singleQuoteMatch?: string, doubleQuoteMatch?: string): string {
    const raw = singleQuoteMatch ?? doubleQuoteMatch ?? ''
    return raw.replace(/''/g, "'").replace(/\\'/g, "'").replace(/""/g, '"').replace(/\\"/g, '"').trim()
  }

  const commentTableRegex = /COMMENT\s+ON\s+TABLE\s+([`"\[\]\w.]+)\s+IS\s+(?:'((?:''|\\'|[^'])*)'|"((?:""|\\"|[^"])*)")/gi
  let tcMatch: RegExpExecArray | null
  while ((tcMatch = commentTableRegex.exec(clean)) !== null) {
    const tbl = cleanIdentifier(tcMatch[1]).toLowerCase()
    const comm = extractQuotedComment(tcMatch[2], tcMatch[3])
    const ent = entityMap.get(tbl)
    if (ent && !ent.comment) {
      ent.comment = comm
    }
  }

  const commentColRegex = /COMMENT\s+ON\s+COLUMN\s+([`"\[\]\w.]+)\.([`"\[\]\w.]+)\s+IS\s+(?:'((?:''|\\'|[^'])*)'|"((?:""|\\"|[^"])*)")/gi
  let ccMatch: RegExpExecArray | null
  while ((ccMatch = commentColRegex.exec(clean)) !== null) {
    const tbl = cleanIdentifier(ccMatch[1]).toLowerCase()
    const col = cleanIdentifier(ccMatch[2]).toLowerCase()
    const comm = extractQuotedComment(ccMatch[3], ccMatch[4])
    const ent = entityMap.get(tbl)
    if (ent) {
      const attr = ent.attributes.find((a) => a.name.toLowerCase() === col)
      if (attr) {
        attr.comment = comm
        if (!attr.description) attr.description = comm
      }
    }
  }

  const commentIdxRegex = /COMMENT\s+ON\s+INDEX\s+([`"\[\]\w.]+)\s+IS\s+(?:'((?:''|\\'|[^'])*)'|"((?:""|\\"|[^"])*)")/gi
  let icMatch: RegExpExecArray | null
  while ((icMatch = commentIdxRegex.exec(clean)) !== null) {
    const idxName = cleanIdentifier(icMatch[1]).toLowerCase()
    const comm = extractQuotedComment(icMatch[2], icMatch[3])
    for (const ent of entityMap.values()) {
      if (ent.indexes) {
        const foundIdx = ent.indexes.find((i) => i.name.toLowerCase() === idxName)
        if (foundIdx && !foundIdx.comment) {
          foundIdx.comment = comm
          break
        }
      }
    }
  }

  // 关系处理
  const relations: Relation[] = []
  const relationKeys = new Set<string>()

  function addRelation(sourceEntity: Entity, targetEntity: Entity) {
    const key = `${sourceEntity.id}->${targetEntity.id}`
    if (relationKeys.has(key)) return
    relationKeys.add(key)
    relations.push({
      id: localID('rel'),
      source_entity_id: sourceEntity.id,
      target_entity_id: targetEntity.id,
      cardinality: 'one_to_many',
    })
  }

  // 1. 显式物理外键
  for (const fk of rawFKs) {
    const parentEntity = entityMap.get(fk.targetTable.toLowerCase())
    const childEntity = entityMap.get(fk.sourceTable.toLowerCase())
    if (parentEntity && childEntity) {
      addRelation(parentEntity, childEntity)
    } else {
      warnings.push(`外键引用目标表不存在：${fk.sourceTable}.${fk.sourceCol} -> ${fk.targetTable}`)
    }
  }

  // 2. 企业常用逻辑外键推断（如 orders.user_id 自动匹配 users 表，满足互联网大厂禁止物理外键的规范）
  for (const entity of entities) {
    for (const attr of entity.attributes) {
      if (attr.is_primary_key) continue
      const fkNameMatch = attr.name.toLowerCase().match(/^([a-z0-9_]+)_id$/)
      if (fkNameMatch) {
        const prefix = fkNameMatch[1]
        const candidates = [prefix, `${prefix}s`, `${prefix}es`]
        for (const candidate of candidates) {
          const parent = entityMap.get(candidate)
          if (parent && parent.id !== entity.id) {
            const key = `${parent.id}->${entity.id}`
            if (!relationKeys.has(key)) {
              addRelation(parent, entity)
              warnings.push(`自动识别逻辑外键：${entity.name}.${attr.name} 关联至 ${parent.name}`)
            }
            break
          }
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

/**
 * 示例电商系统 SQL DDL 脚本，供用户一键体验
 */
export const SAMPLE_SQL = `-- 示例：电商交易系统标准表结构
CREATE TABLE \`users\` (
  \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '用户唯一主键',
  \`username\` varchar(64) NOT NULL COMMENT '登录名',
  \`email\` varchar(128) NOT NULL COMMENT '电子邮箱',
  \`status\` tinyint(4) NOT NULL DEFAULT '1' COMMENT '状态:1-正常,0-封禁',
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_username\` (\`username\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户基础表';

CREATE TABLE \`products\` (
  \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '商品主键',
  \`title\` varchar(128) NOT NULL COMMENT '商品标题',
  \`price\` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '售价',
  \`stock\` int(11) NOT NULL DEFAULT '0' COMMENT '库存数量',
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品信息表';

CREATE TABLE \`orders\` (
  \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '订单主键',
  \`user_id\` bigint(20) unsigned NOT NULL COMMENT '下单用户ID',
  \`order_sn\` varchar(64) NOT NULL COMMENT '订单编号',
  \`total_amount\` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '订单总金额',
  \`status\` varchar(32) NOT NULL DEFAULT 'pending' COMMENT '订单状态',
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下单时间',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_order_sn\` (\`order_sn\`),
  CONSTRAINT \`fk_orders_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单主表';

CREATE TABLE \`order_items\` (
  \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '明细主键',
  \`order_id\` bigint(20) unsigned NOT NULL COMMENT '关联订单ID',
  \`product_id\` bigint(20) unsigned NOT NULL COMMENT '关联商品ID',
  \`price\` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '购买单价',
  \`quantity\` int(11) NOT NULL DEFAULT '1' COMMENT '购买数量',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单商品明细表';
`
