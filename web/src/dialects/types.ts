import type { Attribute, DatabaseDialect, Entity, IndexDefinition } from '../types/dsl'

export interface ColumnDDLContext {
  attr: Attribute
  quotedCol: string
  normalizedType: string
  defaultClause: string
  comment: string
  isCompositePk: boolean
}

export interface FormattedColumnItem {
  definition: string
  trailingLineComment?: string
}

export interface DialectStrategy {
  readonly id: DatabaseDialect
  readonly label: string
  readonly versionLabel: string
  readonly shortLabel: string
  readonly headerTitle: string
  readonly exportDescription: string
  readonly driverDescription: string
  readonly defaultPort: number
  readonly recommendedTypes: readonly string[]
  readonly sampleSQL: string

  quoteIdent(cleanIdent: string): string
  escapeString(value: string): string
  normalizeColumnType(typeStr: string, isAutoIncPk: boolean): string
  formatDefaultClause(rawDefault: string | null | undefined): string

  formatTablePreamble(tableComment: string): string | null
  createTablePrefix(quotedTable: string): string
  formatColumn(ctx: ColumnDDLContext): FormattedColumnItem
  shouldEmitTablePrimaryKey(pkCount: number, isCompositePk: boolean): boolean
  createTableSuffix(tableComment: string): string
  formatCommentStatements(entity: Entity, quotedTable: string): string[]
  formatIndexStatements(
    index: IndexDefinition,
    quotedIndex: string,
    quotedTable: string,
    quotedColumns: string,
  ): string[]
}

export function cleanDialectIdent(name: string): string {
  if (!name) return ''
  let s = name.trim()
  if (s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1)
  else if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  else if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  const parts = s.split('.')
  return parts[parts.length - 1].replace(/[`"[\]]/g, '').trim()
}

export function isIntegerSQLType(upperType: string): boolean {
  const trimmed = upperType.trim()
  if (trimmed === 'TINYINT(1)') {
    return false
  }
  const base = trimmed.split('(')[0].replace(/\s+UNSIGNED\b/g, '').trim()
  return /^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|INT2|INT4|INT8|SERIAL|BIGSERIAL|SMALLSERIAL)$/.test(
    base,
  )
}

export function buildStandardDefaultClause(
  rawDefault: string | null | undefined,
  escapeString: (value: string) => string,
  options?: { booleanAsBit?: boolean },
): string {
  if (rawDefault === undefined || rawDefault === null) return ''
  const trimmed = String(rawDefault).trim()
  if (!trimmed) return ''

  const upper = trimmed.toUpperCase()
  if (
    upper === 'NULL' ||
    upper === 'CURRENT_TIMESTAMP' ||
    upper === 'CURRENT_DATE' ||
    upper === 'CURRENT_TIME' ||
    upper === 'NOW()' ||
    upper === 'TRUE' ||
    upper === 'FALSE' ||
    /^-?\d+(?:\.\d+)?$/.test(trimmed)
  ) {
    if ((upper === 'TRUE' || upper === 'FALSE') && options?.booleanAsBit) {
      return upper === 'TRUE' ? ' DEFAULT 1' : ' DEFAULT 0'
    }
    return ` DEFAULT ${trimmed}`
  }

  const unquoted =
    trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")
      ? trimmed.slice(1, -1)
      : trimmed
  return ` DEFAULT '${escapeString(unquoted)}'`
}
