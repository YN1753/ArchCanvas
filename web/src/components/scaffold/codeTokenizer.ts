export type CodeTokenType =
  | 'plain'
  | 'comment'
  | 'keyword'
  | 'type'
  | 'function'
  | 'string'
  | 'number'
  | 'boolean'
  | 'yamlKey'
  | 'structTagPunct'
  | 'structTagKey'
  | 'structTagVal'

export interface CodeToken {
  type: CodeTokenType
  text: string
}

const YAML_VALUE_TOKEN_SOURCE =
  '("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')|\\b(true|false|yes|no)\\b|\\b(\\d+(?:\\.\\d+)?)\\b'

const GO_TOKEN_SOURCE = [
  '(\\/\\/.*$)',
  '`([^`]*)`',
  '("(?:[^"\\\\]|\\\\.)*")',
  '\\b(time\\.Time|gorm\\.DeletedAt|context\\.Context|gin\\.Context|string|int64|int32|int16|int8|int|uint64|uint32|uint16|uint8|uint|float64|float32|bool|byte|rune|any|error)\\b',
  '\\b(package|import|type|struct|interface|func|return|var|const|if|else|switch|case|default|for|range|go|defer|select|chan|make|new|nil|true|false)\\b',
  '\\b([A-Za-z_][A-Za-z0-9_]*)(?=\\()',
].join('|')

const STRUCT_TAG_PAIR_SOURCE = '(\\w+)(:)(".*?")'

function pushToken(tokens: CodeToken[], type: CodeTokenType, text: string): void {
  if (!text) return
  const last = tokens[tokens.length - 1]
  if (last && last.type === type) {
    last.text += text
    return
  }
  tokens.push({ type, text })
}

export function tokenizeYamlLine(line: string): CodeToken[] {
  if (!line) return []

  let commentIdx = -1
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (ch === '"' && !inSingle && line[i - 1] !== '\\') {
      inDouble = !inDouble
    } else if (ch === '#' && !inSingle && !inDouble) {
      commentIdx = i
      break
    }
  }

  if (commentIdx !== -1) {
    const beforeTokens = tokenizeYamlLine(line.slice(0, commentIdx))
    pushToken(beforeTokens, 'comment', line.slice(commentIdx))
    return beforeTokens
  }

  const tokens: CodeToken[] = []
  let rest = line
  const keyMatch = line.match(/^(\s*[\w.-]+)(:)(.*)$/)
  if (keyMatch) {
    pushToken(tokens, 'yamlKey', keyMatch[1])
    pushToken(tokens, 'plain', keyMatch[2])
    rest = keyMatch[3]
  }

  const re = new RegExp(YAML_VALUE_TOKEN_SOURCE, 'gi')
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(rest)) !== null) {
    if (match.index > cursor) {
      pushToken(tokens, 'plain', rest.slice(cursor, match.index))
    }
    const [full, strLit, boolLit, numLit] = match
    if (strLit !== undefined) {
      pushToken(tokens, 'string', full)
    } else if (boolLit !== undefined) {
      pushToken(tokens, 'boolean', full)
    } else if (numLit !== undefined) {
      pushToken(tokens, 'number', full)
    } else {
      pushToken(tokens, 'plain', full)
    }
    cursor = match.index + full.length
  }

  if (cursor < rest.length) {
    pushToken(tokens, 'plain', rest.slice(cursor))
  }

  return tokens
}

function tokenizeStructTagLiteral(inner: string, out: CodeToken[]): void {
  pushToken(out, 'structTagPunct', '`')
  const re = new RegExp(STRUCT_TAG_PAIR_SOURCE, 'g')
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(inner)) !== null) {
    if (match.index > cursor) {
      pushToken(out, 'structTagPunct', inner.slice(cursor, match.index))
    }
    pushToken(out, 'structTagKey', match[1])
    pushToken(out, 'structTagPunct', match[2])
    pushToken(out, 'structTagVal', match[3])
    cursor = match.index + match[0].length
  }
  if (cursor < inner.length) {
    pushToken(out, 'structTagPunct', inner.slice(cursor))
  }
  pushToken(out, 'structTagPunct', '`')
}

export function tokenizeGoLine(line: string): CodeToken[] {
  if (!line) return []

  const tokens: CodeToken[] = []
  const re = new RegExp(GO_TOKEN_SOURCE, 'g')
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(line)) !== null) {
    if (match.index > cursor) {
      pushToken(tokens, 'plain', line.slice(cursor, match.index))
    }
    const [full, comment, backtickInner, strLit, typeIdent, keyword, funcCall] = match
    if (comment !== undefined) {
      pushToken(tokens, 'comment', comment)
    } else if (backtickInner !== undefined) {
      tokenizeStructTagLiteral(backtickInner, tokens)
    } else if (strLit !== undefined) {
      pushToken(tokens, 'string', strLit)
    } else if (typeIdent !== undefined) {
      pushToken(tokens, 'type', typeIdent)
    } else if (keyword !== undefined) {
      pushToken(tokens, 'keyword', keyword)
    } else if (funcCall !== undefined) {
      pushToken(tokens, 'function', funcCall)
    } else {
      pushToken(tokens, 'plain', full)
    }
    cursor = match.index + full.length
  }

  if (cursor < line.length) {
    pushToken(tokens, 'plain', line.slice(cursor))
  }

  return tokens
}

export function tokenizeCodeLine(line: string, path: string): CodeToken[] {
  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    return tokenizeYamlLine(line)
  }
  return tokenizeGoLine(line)
}
