import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractTrailingComment,
  findMatchingParen,
  isPositionInsideCommentOrString,
  scanSQLTokens,
  splitTopLevelSQLItems,
  stripSQLComments,
} from './lexer'

describe('Single-Pass SQL Lexical Cursor', () => {
  it('handles escaped quotes, comments inside strings, and parens inside comments', () => {
    const sql = `CREATE TABLE "t" (
      code VARCHAR(16) DEFAULT 'a''b) -- not comment', -- real ) comment
      /* block ( ) comment */
      amount DECIMAL(10, 2) NOT NULL
    );`

    const openParen = sql.indexOf('(')
    const closeParen = findMatchingParen(sql, openParen)
    assert.equal(sql.slice(closeParen, closeParen + 2), ');')

    const body = sql.slice(openParen + 1, closeParen)
    const items = splitTopLevelSQLItems(body)
    assert.equal(items.length, 2)

    const first = extractTrailingComment(items[0])
    assert.equal(first.cleanSql, "code VARCHAR(16) DEFAULT 'a''b) -- not comment'")
    assert.equal(first.comment, 'real ) comment')

    const second = extractTrailingComment(items[1])
    assert.equal(second.cleanSql, 'amount DECIMAL(10, 2) NOT NULL')
    assert.equal(second.comment, 'block ( ) comment')
  })

  it('strips line and block comments while preserving string literals and newlines', () => {
    const raw = "-- header\nSELECT '--keep', /* drop */ '#keep' FROM `tbl` # trailing\nWHERE id = 1;"
    const stripped = stripSQLComments(raw)
    assert.ok(!stripped.includes('header'))
    assert.ok(!stripped.includes('drop'))
    assert.ok(!stripped.includes('trailing'))
    assert.ok(stripped.includes("'--keep'"))
    assert.ok(stripped.includes("'#keep'"))
    assert.ok(stripped.includes('\nWHERE id = 1;'))
  })

  it('detects offsets inside strings or comments accurately', () => {
    const sql = "-- CREATE TABLE fake (\nCREATE TABLE real_tbl (id INT);"
    const fakeOffset = sql.indexOf('CREATE TABLE fake')
    const realOffset = sql.indexOf('CREATE TABLE real_tbl')
    assert.equal(isPositionInsideCommentOrString(sql, fakeOffset), true)
    assert.equal(isPositionInsideCommentOrString(sql, realOffset), false)
    assert.ok(scanSQLTokens(sql).length > 0)
  })
})
