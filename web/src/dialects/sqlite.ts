import { SQLITE_SAMPLE_SQL } from '../sql/samples'
import {
  buildStandardDefaultClause,
  cleanDialectIdent,
  isIntegerSQLType,
  type DialectStrategy,
} from './types'

function escapeSqliteString(str: string): string {
  return str.replace(/'/g, "''")
}

export const sqliteDialect: DialectStrategy = {
  id: 'sqlite',
  label: 'SQLite',
  versionLabel: 'SQLite',
  shortLabel: 'SQLITE',
  headerTitle: 'SQLite',
  exportDescription: '生成的 SQLite 标准建表脚本，包含自增主键与 IF NOT EXISTS 索引定义。',
  driverDescription: '单文件即跑，零运维',
  defaultPort: 0,
  recommendedTypes: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  sampleSQL: SQLITE_SAMPLE_SQL,

  quoteIdent(ident: string): string {
    const clean = cleanDialectIdent(ident)
    return `"${clean.replace(/"/g, '""')}"`
  },

  escapeString: escapeSqliteString,

  normalizeColumnType(typeStr: string, isAutoIncPk: boolean): string {
    const upper = (typeStr || '').trim().toUpperCase()
    if (!upper) return 'TEXT'
    const withoutUnsigned = upper.replace(/\s+UNSIGNED\b/g, '').trim()
    const base = withoutUnsigned.split('(')[0].trim()

    if (isAutoIncPk && isIntegerSQLType(upper)) return 'INTEGER'
    if (upper === 'TINYINT(1)' || base === 'BOOL' || base === 'BOOLEAN') return 'INTEGER'
    if (isIntegerSQLType(upper)) return 'INTEGER'
    if (
      base === 'VARCHAR' ||
      base === 'CHAR' ||
      base === 'TEXT' ||
      base === 'MEDIUMTEXT' ||
      base === 'LONGTEXT'
    ) {
      return 'TEXT'
    }
    if (
      base === 'DECIMAL' ||
      base === 'NUMERIC' ||
      base === 'REAL' ||
      base === 'FLOAT' ||
      base === 'DOUBLE' ||
      withoutUnsigned === 'DOUBLE PRECISION'
    ) {
      return 'REAL'
    }
    if (base === 'BLOB' || base === 'LONGBLOB' || base === 'BYTEA') return 'BLOB'
    return withoutUnsigned
  },

  formatDefaultClause(rawDefault: string | null | undefined): string {
    return buildStandardDefaultClause(rawDefault, escapeSqliteString, { booleanAsBit: true })
  },

  formatTablePreamble(tableComment: string): string | null {
    if (!tableComment) return null
    return `-- 表说明: ${tableComment.replace(/[\r\n]+/g, ' ')}`
  },

  createTablePrefix(quotedTable: string): string {
    return `CREATE TABLE IF NOT EXISTS ${quotedTable} (`
  },

  formatColumn({ attr, quotedCol, normalizedType, defaultClause, comment, isCompositePk }) {
    let line = `  ${quotedCol} ${normalizedType}`
    if (attr.is_primary_key) {
      if (isCompositePk) {
        line += ' NOT NULL'
      } else if (isIntegerSQLType(normalizedType)) {
        line += ' PRIMARY KEY AUTOINCREMENT'
      } else {
        line += ' PRIMARY KEY'
      }
    } else if (!attr.is_nullable) {
      line += ' NOT NULL'
    }

    line += defaultClause

    if (attr.is_unique && !attr.is_primary_key) {
      line += ' UNIQUE'
    }

    return {
      definition: line,
      trailingLineComment: comment ? comment.replace(/[\r\n]+/g, ' ') : undefined,
    }
  },

  shouldEmitTablePrimaryKey(_pkCount: number, isCompositePk: boolean): boolean {
    return isCompositePk
  },

  createTableSuffix(): string {
    return ');'
  },

  formatCommentStatements(): string[] {
    return []
  },

  formatIndexStatements(index, quotedIndex, quotedTable, quotedColumns): string[] {
    const uniqueKeyword = index.is_unique ? 'UNIQUE ' : ''
    return [
      `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS ${quotedIndex} ON ${quotedTable} (${quotedColumns});`,
    ]
  },
}
