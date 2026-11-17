import type { DatabaseDialect } from '../types/dsl'
import { mysqlDialect } from './mysql'
import { postgresDialect } from './postgres'
import { sqliteDialect } from './sqlite'
import type { DialectStrategy } from './types'

export type { ColumnDDLContext, DialectStrategy, FormattedColumnItem } from './types'
export { cleanDialectIdent, isIntegerSQLType } from './types'

const DIALECT_REGISTRY = new Map<DatabaseDialect, DialectStrategy>([
  [mysqlDialect.id, mysqlDialect],
  [postgresDialect.id, postgresDialect],
  [sqliteDialect.id, sqliteDialect],
])

export const DEFAULT_DIALECT: DatabaseDialect = 'mysql'

export function registerDialect(strategy: DialectStrategy): void {
  DIALECT_REGISTRY.set(strategy.id, strategy)
}

export function getDialect(id: DatabaseDialect = DEFAULT_DIALECT): DialectStrategy {
  return DIALECT_REGISTRY.get(id) ?? mysqlDialect
}

export function listDialects(): DialectStrategy[] {
  return Array.from(DIALECT_REGISTRY.values())
}
