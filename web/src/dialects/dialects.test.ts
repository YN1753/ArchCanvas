import assert from 'node:assert'
import { describe, it } from 'node:test'

import { getDialect, listDialects } from './index'

describe('Dialect Strategy Registry', () => {
  it('lists MySQL, PostgreSQL, and SQLite strategies in canonical order', () => {
    const dialects = listDialects()
    assert.deepStrictEqual(
      dialects.map((d) => d.id),
      ['mysql', 'postgres', 'sqlite'],
    )
    for (const d of dialects) {
      assert.ok(d.label.length > 0)
      assert.ok(d.shortLabel.length > 0)
      assert.ok(d.recommendedTypes.length > 0)
      assert.ok(d.sampleSQL.includes('CREATE TABLE'))
    }
  })

  it('quotes identifiers and escapes string literals per dialect rules', () => {
    const mysql = getDialect('mysql')
    const pg = getDialect('postgres')
    const sqlite = getDialect('sqlite')

    assert.strictEqual(mysql.quoteIdent('users'), '`users`')
    assert.strictEqual(pg.quoteIdent('users'), '"users"')
    assert.strictEqual(sqlite.quoteIdent('users'), '"users"')

    assert.strictEqual(mysql.escapeString("User's \\ Note"), "User\\'s \\\\ Note")
    assert.strictEqual(pg.escapeString("User's Note"), "User''s Note")
    assert.strictEqual(sqlite.escapeString("User's Note"), "User''s Note")
  })

  it('normalizes column types and auto-increment primary keys per dialect', () => {
    const mysql = getDialect('mysql')
    const pg = getDialect('postgres')
    const sqlite = getDialect('sqlite')

    assert.strictEqual(pg.normalizeColumnType('BIGINT UNSIGNED', true), 'BIGSERIAL')
    assert.strictEqual(pg.normalizeColumnType('BIGSERIAL', false), 'BIGINT')
    assert.strictEqual(pg.normalizeColumnType('TINYINT(1)', false), 'BOOLEAN')

    assert.strictEqual(mysql.normalizeColumnType('BIGSERIAL', true), 'BIGINT')
    assert.strictEqual(mysql.normalizeColumnType('TIMESTAMPTZ', false), 'DATETIME')

    assert.strictEqual(sqlite.normalizeColumnType('VARCHAR(128)', false), 'TEXT')
    assert.strictEqual(sqlite.normalizeColumnType('DECIMAL(10,2)', false), 'REAL')
    assert.strictEqual(sqlite.formatDefaultClause('TRUE'), ' DEFAULT 1')
  })
})
