import { POSTGRES_SAMPLE_SQL } from '../sql/samples'
import {
  buildStandardDefaultClause,
  cleanDialectIdent,
  isIntegerSQLType,
  type DialectStrategy,
} from './types'

function escapePostgresString(str: string): string {
  return str.replace(/'/g, "''")
}

function quotePostgresIdent(ident: string): string {
  const clean = cleanDialectIdent(ident)
  return `"${clean.replace(/"/g, '""')}"`
}

export const postgresDialect: DialectStrategy = {
  id: 'postgres',
  label: 'PostgreSQL',
  versionLabel: 'PostgreSQL',
  shortLabel: 'PG',
  headerTitle: 'PostgreSQL',
  exportDescription: '生成的 PostgreSQL 标准 DDL 脚本，包含表/字段注释及 IF NOT EXISTS 索引定义。',
  driverDescription: '支持高级字段与扩展',
  defaultPort: 5432,
  recommendedTypes: [
    'BIGSERIAL',
    'BIGINT',
    'SERIAL',
    'INTEGER',
    'SMALLINT',
    'VARCHAR(64)',
    'VARCHAR(128)',
    'VARCHAR(255)',
    'TEXT',
    'BOOLEAN',
    'TIMESTAMPTZ',
    'DATE',
    'NUMERIC(10,2)',
    'JSONB',
    'UUID',
    'BYTEA',
  ],
  sampleSQL: POSTGRES_SAMPLE_SQL,

  quoteIdent: quotePostgresIdent,

  escapeString: escapePostgresString,

  normalizeColumnType(typeStr: string, isAutoIncPk: boolean): string {
    const upper = (typeStr || '').trim().toUpperCase()
    if (!upper) return 'VARCHAR(255)'
    const withoutUnsigned = upper.replace(/\s+UNSIGNED\b/g, '').trim()
    const base = withoutUnsigned.split('(')[0].trim()

    if (isAutoIncPk && (isIntegerSQLType(upper) || base === 'SERIAL' || base === 'BIGSERIAL')) {
      return base.includes('BIG') ? 'BIGSERIAL' : 'SERIAL'
    }
    if (base === 'BIGSERIAL' && !isAutoIncPk) return 'BIGINT'
    if (base === 'SERIAL' && !isAutoIncPk) return 'INTEGER'
    if (upper === 'TINYINT(1)' || base === 'BOOL' || base === 'BOOLEAN') return 'BOOLEAN'
    if (base === 'TINYINT') return 'SMALLINT'
    if (base === 'MEDIUMINT' || base === 'INT') return 'INTEGER'
    if (base === 'BIGINT') return 'BIGINT'
    if (base === 'DATETIME') return 'TIMESTAMPTZ'
    if (base === 'DOUBLE') return 'DOUBLE PRECISION'
    if (base === 'LONGTEXT' || base === 'MEDIUMTEXT') return 'TEXT'
    if (base === 'BLOB' || base === 'LONGBLOB') return 'BYTEA'
    return withoutUnsigned
  },

  formatDefaultClause(rawDefault: string | null | undefined): string {
    return buildStandardDefaultClause(rawDefault, escapePostgresString)
  },

  formatTablePreamble(): null {
    return null
  },

  createTablePrefix(quotedTable: string): string {
    return `CREATE TABLE ${quotedTable} (`
  },

  formatColumn({ attr, quotedCol, normalizedType, defaultClause, isCompositePk }) {
    let line = `  ${quotedCol} ${normalizedType}`
    if (attr.is_primary_key) {
      line += isCompositePk ? ' NOT NULL' : ' PRIMARY KEY'
    } else if (!attr.is_nullable) {
      line += ' NOT NULL'
    }

    line += defaultClause

    if (attr.is_unique && !attr.is_primary_key) {
      line += ' UNIQUE'
    }
    return { definition: line }
  },

  shouldEmitTablePrimaryKey(_pkCount: number, isCompositePk: boolean): boolean {
    return isCompositePk
  },

  createTableSuffix(): string {
    return ');'
  },

  formatCommentStatements(entity, quotedTable): string[] {
    const stmts: string[] = []
    const tableComment = (entity.comment || '').trim()
    if (tableComment) {
      stmts.push(`COMMENT ON TABLE ${quotedTable} IS '${escapePostgresString(tableComment)}';`)
    }
    for (const attr of entity.attributes) {
      const comment = (attr.comment || attr.description || '').trim()
      if (comment) {
        const quotedCol = quotePostgresIdent(attr.name)
        stmts.push(
          `COMMENT ON COLUMN ${quotedTable}.${quotedCol} IS '${escapePostgresString(comment)}';`,
        )
      }
    }
    return stmts
  },

  formatIndexStatements(index, quotedIndex, quotedTable, quotedColumns): string[] {
    const uniqueKeyword = index.is_unique ? 'UNIQUE ' : ''
    const stmts = [
      `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS ${quotedIndex} ON ${quotedTable} (${quotedColumns});`,
    ]
    if (index.comment) {
      stmts.push(`COMMENT ON INDEX ${quotedIndex} IS '${escapePostgresString(index.comment)}';`)
    }
    return stmts
  },
}
