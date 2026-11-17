import assert from 'node:assert'
import { describe, it } from 'node:test'

import { tokenizeCodeLine } from './codeTokenizer'

describe('Pure Lexical Code Tokenizer (Zero DOM HTML Sinks)', () => {
  it('tokenizes Go struct fields, struct tags, keywords, types, and comments losslessly', () => {
    const line = '\tID uint64 `gorm:"primaryKey" json:"id"` // 主键标识'
    const tokens = tokenizeCodeLine(line, 'internal/model/user.go')
    assert.strictEqual(tokens.map((t) => t.text).join(''), line)
    assert.ok(tokens.some((t) => t.type === 'type' && t.text === 'uint64'))
    assert.ok(tokens.some((t) => t.type === 'structTagKey' && t.text === 'gorm'))
    assert.ok(tokens.some((t) => t.type === 'structTagVal' && t.text === '"primaryKey"'))
    assert.ok(tokens.some((t) => t.type === 'comment' && t.text === '// 主键标识'))
  })

  it('tokenizes YAML key-value pairs while ignoring # inside quoted strings', () => {
    const line = '  dsn: "postgres://user:p#ss@localhost:5432/db" # 连接串'
    const tokens = tokenizeCodeLine(line, 'configs/config.yaml')
    assert.strictEqual(tokens.map((t) => t.text).join(''), line)
    assert.ok(tokens.some((t) => t.type === 'yamlKey' && t.text === '  dsn'))
    assert.ok(
      tokens.some(
        (t) => t.type === 'string' && t.text === '"postgres://user:p#ss@localhost:5432/db"',
      ),
    )
    assert.ok(tokens.some((t) => t.type === 'comment' && t.text === '# 连接串'))
  })

  it('preserves raw HTML/XSS characters literally without HTML string interpolation', () => {
    const hostile = 'const tpl = "<img src=x onerror=alert(1)>" // & <script>'
    const tokens = tokenizeCodeLine(hostile, 'cmd/server/main.go')
    assert.strictEqual(tokens.map((t) => t.text).join(''), hostile)
    assert.ok(tokens.some((t) => t.type === 'string' && t.text.includes('<img src=x')))
  })
})
