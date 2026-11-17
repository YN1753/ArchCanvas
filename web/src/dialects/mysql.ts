import { MYSQL_SAMPLE_SQL } from '../sql/samples'
import {
  buildStandardDefaultClause,
  cleanDialectIdent,
  isIntegerSQLType,
  type DialectStrategy,
} from './types'

function escapeMysqlString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export const mysqlDialect: DialectStrategy = {
  id: 'mysql',
  label: 'MySQL',
  versionLabel: 'MySQL 8.0',
  shortLabel: 'MYSQL',
  headerTitle: 'MySQL / MariaDB',
  exportDescription: '生成的 MySQL / MariaDB 标准建表语句，包含表注释与 CREATE INDEX 索引定义。',
  driverDescription: '标准互联网架构',
  defaultPort: 3306,
  recommendedTypes: [
    'BIGINT',
    'BIGINT UNSIGNED',
    'INT',
    'TINYINT',
    'TINYINT(1)',
    'VARCHAR(64)',
    'VARCHAR(128)',
    'VARCHAR(255)',
    'TEXT',
    'DATETIME',
    'DATE',
    'DECIMAL(10,2)',
    'JSON',
    'BLOB',
  ],
  sampleSQL: MYSQL_SAMPLE_SQL,

  quoteIdent(ident: string): string {
    const clean = cleanDialectIdent(ident)
    return `\`${clean.replace(/`/g, '``')}\``
  },

  escapeString: escapeMysqlString,

  normalizeColumnType(typeStr: string): string {
    const upper = (typeStr || '').trim().toUpperCase()
    if (!upper) return 'VARCHAR(255)'
    const withoutUnsigned = upper.replace(/\s+UNSIGNED\b/g, '').trim()
    const base = withoutUnsigned.split('(')[0].trim()

    if (base === 'BIGSERIAL') return 'BIGINT'
    if (base === 'SERIAL') return 'INT'
    if (base === 'TIMESTAMPTZ') return 'DATETIME'
    if (base === 'BYTEA') return 'BLOB'
    if (withoutUnsigned === 'DOUBLE PRECISION') return 'DOUBLE'
    return upper
  },

  formatDefaultClause(rawDefault: string | null | undefined): string {
    return buildStandardDefaultClause(rawDefault, escapeMysqlString)
  },

  formatTablePreamble(): null {
    return null
  },

  createTablePrefix(quotedTable: string): string {
    return `CREATE TABLE ${quotedTable} (`
  },

  formatColumn({ attr, quotedCol, normalizedType, defaultClause, comment, isCompositePk }) {
    let line = `  ${quotedCol} ${normalizedType}`
    if (attr.is_primary_key) {
      line += ' NOT NULL'
      if (!isCompositePk && isIntegerSQLType(normalizedType)) {
        line += ' AUTO_INCREMENT'
      }
    } else if (!attr.is_nullable) {
      line += ' NOT NULL'
    } else {
      line += ' NULL'
    }

    line += defaultClause

    if (attr.is_unique && !attr.is_primary_key) {
      line += ' UNIQUE'
    }

    if (comment) {
      line += ` COMMENT '${escapeMysqlString(comment)}'`
    }
    return { definition: line }
  },

  shouldEmitTablePrimaryKey(pkCount: number): boolean {
    return pkCount > 0
  },

  createTableSuffix(tableComment: string): string {
    let suffix = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    if (tableComment) {
      suffix += ` COMMENT='${escapeMysqlString(tableComment)}'`
    }
    return `${suffix};`
  },

  formatCommentStatements(): string[] {
    return []
  },

  formatIndexStatements(index, quotedIndex, quotedTable, quotedColumns): string[] {
    const uniqueKeyword = index.is_unique ? 'UNIQUE ' : ''
    let stmt = `CREATE ${uniqueKeyword}INDEX ${quotedIndex} ON ${quotedTable} (${quotedColumns})`
    if (index.comment) {
      stmt += ` COMMENT '${escapeMysqlString(index.comment)}'`
    }
    return [`${stmt};`]
  },
}
