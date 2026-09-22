import { defaultCodeType, localID, type Entity, type ERDesign, type Relation } from '../types/dsl'

/**
 * 将单个实体表转化为标准 SQL DDL (CREATE TABLE 语句)
 */
export function entityToSQL(entity: Entity): string {
  const lines: string[] = []
  const primaryKeys: string[] = []

  for (const attr of entity.attributes) {
    let line = `  \`${attr.name}\` ${attr.db_type || 'VARCHAR(255)'}`

    if (attr.is_primary_key) {
      line += ' NOT NULL'
      if (attr.db_type.toUpperCase().includes('INT')) {
        line += ' AUTO_INCREMENT'
      }
      primaryKeys.push(`\`${attr.name}\``)
    } else if (!attr.is_nullable) {
      line += ' NOT NULL'
    } else {
      line += ' NULL'
    }

    if (attr.is_unique && !attr.is_primary_key) {
      line += ' UNIQUE'
    }

    if (attr.description) {
      line += ` COMMENT '${attr.description.replace(/'/g, "\\'")}'`
    }

    lines.push(line)
  }

  if (primaryKeys.length > 0) {
    lines.push(`  PRIMARY KEY (${primaryKeys.join(', ')})`)
  }

  return `CREATE TABLE \`${entity.name}\` (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
}

/**
 * 将整个 ER 设计转换为完整 SQL 脚本
 */
export function designToSQL(design: ERDesign): string {
  if (design.entities.length === 0) {
    return '-- 画布暂无实体数据表'
  }

  const chunks: string[] = [
    '-- =============================================',
    '-- ArchCanvas 自动生成的 SQL DDL 结构脚本',
    `-- 导出时间: ${new Date().toLocaleString()}`,
    `-- 实体总数: ${design.entities.length} | 关联总数: ${design.relations.length}`,
    '-- =============================================\n',
  ]

  for (const entity of design.entities) {
    chunks.push(entityToSQL(entity))
    chunks.push('')
  }

  return chunks.join('\n')
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
 * 将 CREATE TABLE 内部字段及约束按顶级逗号拆分，忽略括号内参数（如 DECIMAL(10,2)）中的逗号
 */
export function splitTableItems(body: string): string[] {
  const items: string[] = []
  let current = ''
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false

  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (char === "'" && !inDoubleQuote && !inBacktick) {
      if (inSingleQuote && body[i - 1] !== '\\') inSingleQuote = false
      else if (!inSingleQuote) inSingleQuote = true
    } else if (char === '"' && !inSingleQuote && !inBacktick) {
      if (inDoubleQuote && body[i - 1] !== '\\') inDoubleQuote = false
      else if (!inDoubleQuote) inDoubleQuote = true
    } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
      inBacktick = !inBacktick
    } else if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (char === '(') depth++
      else if (char === ')') depth--
      else if (char === ',' && depth === 0) {
        if (current.trim()) items.push(current.trim())
        current = ''
        continue
      }
    }
    current += char
  }
  if (current.trim()) items.push(current.trim())
  return items
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
  const clean = stripSQLComments(sqlText)
  const warnings: string[] = []
  const createTableRegex = /CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[\]\w.]+)\s*\(/gi

  const rawTables: Array<{ name: string; body: string }> = []
  let match: RegExpExecArray | null
  while ((match = createTableRegex.exec(clean)) !== null) {
    const rawTableName = match[1]
    const tableName = cleanIdentifier(rawTableName)
    const startIndex = match.index + match[0].length

    let depth = 1
    let endIndex = -1
    let inSingleQuote = false
    let inDoubleQuote = false
    let inBacktick = false

    for (let i = startIndex; i < clean.length; i++) {
      const char = clean[i]
      if (char === "'" && !inDoubleQuote && !inBacktick) {
        if (inSingleQuote && clean[i - 1] !== '\\') inSingleQuote = false
        else if (!inSingleQuote) inSingleQuote = true
      } else if (char === '"' && !inSingleQuote && !inBacktick) {
        if (inDoubleQuote && clean[i - 1] !== '\\') inDoubleQuote = false
        else if (!inDoubleQuote) inDoubleQuote = true
      } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
        inBacktick = !inBacktick
      } else if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
        if (char === '(') depth++
        else if (char === ')') {
          depth--
          if (depth === 0) {
            endIndex = i
            break
          }
        }
      }
    }

    if (endIndex === -1) continue

    const body = clean.slice(startIndex, endIndex)
    rawTables.push({ name: tableName, body })
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
      attributes: [],
    }

    const items = splitTableItems(rawTable.body)
    const tablePrimaryKeys = new Set<string>()
    const tableUniqueKeys = new Set<string>()

    for (const rawItem of items) {
      const item = rawItem.trim()
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
        /^(?:CONSTRAINT\s+[`"\[\]\w]+\s+)?UNIQUE\s*(?:KEY|INDEX)?\s*(?:[`"\[\]\w]+)?\s*\(([^)]+)\)/i,
      )
      if (ukMatch) {
        const cols = ukMatch[1].split(',').map(cleanIdentifier)
        cols.forEach((c) => tableUniqueKeys.add(c.toLowerCase()))
        continue
      }

      // 忽略常规辅助索引定义 (KEY, INDEX, FULLTEXT, SPATIAL, CHECK)
      if (/^(?:KEY|INDEX|FULLTEXT|SPATIAL|CHECK)\b/i.test(item)) {
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

      // 提取 COMMENT '...' 或 COMMENT "..."
      let description = ''
      const commentMatch = rest.match(/\bCOMMENT\s*['"]([^'"]*)['"]/i)
      if (commentMatch) {
        description = commentMatch[1].trim()
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
