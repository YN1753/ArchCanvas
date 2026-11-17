/**
 * 单趟 SQL 词法状态机游标（Single-Pass SQL Lexical Cursor）。
 *
 * 统一处理单引号 `'...'`（兼容 `''` 与 `\'`）、双引号 `"..."`（兼容 `""` 与 `\"`）、
 * 反引号 `` `...` ``（兼容 `` `` ``）、行注释 `--` / `#`、块注释 `/* ... *\/` 与括号层级，
 * 消除 SQL 导出/逆向解析器中重复编写的多套引号/注释扫描循环。
 */

export type SQLTokenKind =
  | 'code'
  | 'single_quote'
  | 'double_quote'
  | 'backtick'
  | 'line_comment'
  | 'block_comment'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'semicolon'

export interface SQLToken {
  kind: SQLTokenKind
  start: number
  end: number
  raw: string
  /** 仅在 `line_comment` / `block_comment` 时填充去除了注释定界符后的内部文本 */
  commentText?: string
  /** 是否闭合（例如未闭合的 `/*` 块注释为 `false`） */
  closed?: boolean
  /** 该 Token 起始位置所处的圆括号嵌套深度 */
  depth: number
}

function readQuotedEnd(sql: string, start: number, limit: number, quoteChar: "'" | '"' | '`'): number {
  let i = start + 1
  const allowBackslash = quoteChar !== '`'
  while (i < limit) {
    const ch = sql[i]
    const next = i + 1 < limit ? sql[i + 1] : ''
    if (allowBackslash && ch === '\\' && i + 1 < limit) {
      i += 2
      continue
    }
    if (ch === quoteChar) {
      if (next === quoteChar) {
        i += 2
        continue
      }
      return i + 1
    }
    i += 1
  }
  return limit
}

/**
 * 单趟扫描 SQL 文本并产出结构化词法 Token 流。
 */
export function scanSQLTokens(sql: string, startIndex = 0, endLimit = sql.length): SQLToken[] {
  const tokens: SQLToken[] = []
  const n = Math.min(sql.length, endLimit)
  let i = Math.max(0, startIndex)
  let depth = 0
  let codeStart = -1

  const flushCode = (end: number) => {
    if (codeStart !== -1 && end > codeStart) {
      tokens.push({
        kind: 'code',
        start: codeStart,
        end,
        raw: sql.slice(codeStart, end),
        depth,
      })
    }
    codeStart = -1
  }

  while (i < n) {
    const ch = sql[i]
    const next = i + 1 < n ? sql[i + 1] : ''

    if (ch === "'" || ch === '"' || ch === '`') {
      flushCode(i)
      const end = readQuotedEnd(sql, i, n, ch)
      const kind: SQLTokenKind =
        ch === "'" ? 'single_quote' : ch === '"' ? 'double_quote' : 'backtick'
      tokens.push({
        kind,
        start: i,
        end,
        raw: sql.slice(i, end),
        closed: end <= n && sql[end - 1] === ch && end > i + 1,
        depth,
      })
      i = end
      continue
    }

    // 块注释 /* ... */
    if (ch === '/' && next === '*') {
      flushCode(i)
      const closeIdx = sql.indexOf('*/', i + 2)
      const closed = closeIdx !== -1 && closeIdx + 2 <= n
      const end = closed ? closeIdx + 2 : n
      tokens.push({
        kind: 'block_comment',
        start: i,
        end,
        raw: sql.slice(i, end),
        commentText: closed ? sql.slice(i + 2, closeIdx).trim() : sql.slice(i + 2, n).trim(),
        closed,
        depth,
      })
      i = end
      continue
    }

    // 行注释 -- 或 #（不包含末尾换行符 \n，保证换行结构保留给后续 code token）
    if ((ch === '-' && next === '-') || ch === '#') {
      flushCode(i)
      const prefixLen = ch === '#' ? 1 : 2
      const nlIdx = sql.indexOf('\n', i + prefixLen)
      const end = nlIdx === -1 || nlIdx > n ? n : nlIdx
      tokens.push({
        kind: 'line_comment',
        start: i,
        end,
        raw: sql.slice(i, end),
        commentText: sql.slice(i + prefixLen, end).trim(),
        closed: true,
        depth,
      })
      i = end
      continue
    }

    if (ch === '(') {
      flushCode(i)
      tokens.push({ kind: 'lparen', start: i, end: i + 1, raw: '(', depth })
      depth += 1
      i += 1
      continue
    }

    if (ch === ')') {
      flushCode(i)
      const tokenDepth = Math.max(0, depth - 1)
      depth = tokenDepth
      tokens.push({ kind: 'rparen', start: i, end: i + 1, raw: ')', depth: tokenDepth })
      i += 1
      continue
    }

    if (ch === ',') {
      flushCode(i)
      tokens.push({ kind: 'comma', start: i, end: i + 1, raw: ',', depth })
      i += 1
      continue
    }

    if (ch === ';') {
      flushCode(i)
      tokens.push({ kind: 'semicolon', start: i, end: i + 1, raw: ';', depth })
      i += 1
      continue
    }

    if (codeStart === -1) {
      codeStart = i
    }
    i += 1
  }

  flushCode(n)
  return tokens
}

/**
 * 剔除 SQL 中的行注释与块注释，完整保留引号字面量与换行符。
 */
export function stripSQLComments(sql: string): string {
  const tokens = scanSQLTokens(sql)
  let out = ''
  for (const tok of tokens) {
    if (tok.kind === 'block_comment' || tok.kind === 'line_comment') {
      continue
    }
    out += tok.raw
  }
  return out
}

/**
 * 提取单条字段/约束定义中的行内或尾部注释，并返回剥离了尾随逗号的纯净 SQL。
 */
export function extractTrailingComment(rawItem: string): { cleanSql: string; comment?: string } {
  const tokens = scanSQLTokens(rawItem)
  let cleanSql = ''
  let comment: string | undefined

  for (const tok of tokens) {
    if (tok.kind === 'block_comment') {
      if (tok.closed) {
        if (tok.commentText && !comment) {
          comment = tok.commentText
        }
        continue
      }
      cleanSql += tok.raw
      continue
    }

    if (tok.kind === 'line_comment') {
      const cleaned = tok.commentText?.replace(/,\s*$/, '').trim()
      if (cleaned && !comment) {
        comment = cleaned
      }
      break
    }

    cleanSql += tok.raw
  }

  cleanSql = cleanSql.replace(/,\s*$/, '').trim()
  return { cleanSql, comment }
}

/**
 * 按顶层逗号（`depth === 0`）切分 `CREATE TABLE (...)` 主体条目，
 * 同时将紧跟在逗号同一行后的行尾注释归属到当前列条目。
 */
export function splitTopLevelSQLItems(body: string): string[] {
  const tokens = scanSQLTokens(body)
  const items: string[] = []
  let current = ''

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.kind === 'comma' && tok.depth === 0) {
      const nextTok = tokens[i + 1]
      const afterNext = tokens[i + 2]

      if (nextTok?.kind === 'line_comment') {
        current += `,${nextTok.raw}`
        i += 1
      } else if (
        nextTok?.kind === 'code' &&
        /^[ \t\r]+$/.test(nextTok.raw) &&
        afterNext?.kind === 'line_comment'
      ) {
        current += `,${nextTok.raw}${afterNext.raw}`
        i += 2
      }

      const trimmed = current.trim()
      if (trimmed) {
        items.push(trimmed)
      }
      current = ''
      continue
    }

    current += tok.raw
  }

  const tail = current.trim()
  if (tail) {
    items.push(tail)
  }
  return items
}

/**
 * 从左括号 `(` 所在索引 `openParenIndex` 出发，跳过引号与注释查找配对的闭合右括号 `)` 索引。
 * 未找到时返回 `-1`。
 */
export function findMatchingParen(sql: string, openParenIndex: number): number {
  const tokens = scanSQLTokens(sql, openParenIndex + 1)
  let depth = 1
  for (const tok of tokens) {
    if (tok.kind === 'lparen') {
      depth += 1
    } else if (tok.kind === 'rparen') {
      depth -= 1
      if (depth === 0) {
        return tok.start
      }
    }
  }
  return -1
}

/**
 * 从指定起点向后查找第一个位于引号/注释之外的分号 `;` 位置（至多扫描 `maxDistance` 字符）。
 */
export function findStatementSemicolon(sql: string, startIndex: number, maxDistance = 500): number {
  const limit = Math.min(sql.length, startIndex + maxDistance)
  const tokens = scanSQLTokens(sql, startIndex, limit)
  for (const tok of tokens) {
    if (tok.kind === 'semicolon') {
      return tok.start
    }
  }
  return limit
}

/**
 * 判断字符偏移量 `targetPos` 是否处于引号字面量或 SQL 注释内部。
 */
export function isPositionInsideCommentOrString(sql: string, targetPos: number): boolean {
  if (targetPos <= 0) return false
  const limit = Math.min(sql.length, targetPos + 1)
  const tokens = scanSQLTokens(sql, 0, limit)
  for (const tok of tokens) {
    if (targetPos >= tok.start && targetPos < tok.end) {
      return (
        tok.kind === 'single_quote' ||
        tok.kind === 'double_quote' ||
        tok.kind === 'backtick' ||
        tok.kind === 'line_comment' ||
        tok.kind === 'block_comment'
      )
    }
  }
  return false
}
