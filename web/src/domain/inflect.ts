/**
 * 统一命名与英语词形变化（单复数 / snake_case / PascalCase / camelCase）领域内核。
 * 与后端 `pkg/naming` 规则严格对齐，消除前端各模块各自切分单复数导致的行为分叉。
 */

const INVARIANT_WORDS = new Set([
  'series',
  'species',
  'news',
  'data',
  'media',
  'sms',
  'dns',
  'cors',
  'rbac',
  'cms',
  'wms',
  'oms',
  'tms',
  'erp',
  'pos',
  'ibs',
  'oss',
  'equipment',
  'information',
  'staff',
  'goods',
  'logistics',
  'fish',
  'sheep',
  'deer',
  'police',
])

/** 单数以 s 结尾（但并非不可数名词，复数需要变形或加 es） */
const SINGULAR_ENDING_WITH_S = new Set([
  'status',
  'campus',
  'virus',
  'corpus',
  'census',
  'bonus',
  'alias',
  'canvas',
  'bus',
  'gas',
  'address',
  'access',
  'process',
  'business',
  'class',
  'pass',
  'express',
  'analysis',
  'basis',
  'diagnosis',
  'thesis',
  'crisis',
  'axis',
  'synopsis',
  'hypothesis',
])

const IRREGULAR_PLURAL_TO_SINGULAR: Record<string, string> = {
  people: 'person',
  men: 'man',
  women: 'woman',
  children: 'child',
  teeth: 'tooth',
  feet: 'foot',
  mice: 'mouse',
  geese: 'goose',
  indices: 'index',
  indexes: 'index',
  vertices: 'vertex',
  matrices: 'matrix',
  criteria: 'criterion',
  phenomena: 'phenomenon',
  leaves: 'leaf',
  lives: 'life',
  knives: 'knife',
  wolves: 'wolf',
  shelves: 'shelf',
  halves: 'half',
  analyses: 'analysis',
  diagnoses: 'diagnosis',
  theses: 'thesis',
  crises: 'crisis',
  synopses: 'synopsis',
  hypotheses: 'hypothesis',
  statuses: 'status',
  campuses: 'campus',
  bonuses: 'bonus',
  viruses: 'virus',
  corpuses: 'corpus',
  censuses: 'census',
  aliases: 'alias',
  canvases: 'canvas',
  buses: 'bus',
  gases: 'gas',
  quizzes: 'quiz',
  oxen: 'ox',
  heroes: 'hero',
  potatoes: 'potato',
  tomatoes: 'tomato',
}

const IRREGULAR_SINGULAR_TO_PLURAL: Record<string, string> = {
  person: 'people',
  man: 'men',
  woman: 'women',
  child: 'children',
  tooth: 'teeth',
  foot: 'feet',
  mouse: 'mice',
  goose: 'geese',
  index: 'indexes',
  vertex: 'vertices',
  matrix: 'matrices',
  criterion: 'criteria',
  phenomenon: 'phenomena',
  leaf: 'leaves',
  life: 'lives',
  knife: 'knives',
  wolf: 'wolves',
  shelf: 'shelves',
  half: 'halves',
  analysis: 'analyses',
  basis: 'bases',
  diagnosis: 'diagnoses',
  thesis: 'theses',
  crisis: 'crises',
  axis: 'axes',
  synopsis: 'synopses',
  hypothesis: 'hypotheses',
  status: 'statuses',
  campus: 'campuses',
  bonus: 'bonuses',
  virus: 'viruses',
  corpus: 'corpuses',
  census: 'censuses',
  alias: 'aliases',
  canvas: 'canvases',
  bus: 'buses',
  gas: 'gases',
  quiz: 'quizzes',
  ox: 'oxen',
  hero: 'heroes',
  potato: 'potatoes',
  tomato: 'tomatoes',
}

const KNOWN_IRREGULAR_SINGULARS = new Set(Object.keys(IRREGULAR_SINGULAR_TO_PLURAL))
const KNOWN_IRREGULAR_PLURALS = new Set(Object.keys(IRREGULAR_PLURAL_TO_SINGULAR))

/** 词根以 -ie 结尾的名词复数（仅去掉末尾 s，不可转为 -y） */
const IE_ROOT_PLURALS = new Set([
  'movies',
  'cookies',
  'zombies',
  'rookies',
  'brownies',
  'pies',
  'ties',
  'lies',
  'dies',
])

/** 词根以静音 e 结尾的 -ches 复数（仅去掉末尾 s） */
const SILENT_E_CHES_PLURALS = new Set(['caches', 'niches', 'avalanches', 'headaches'])

function singularizeToken(word: string): string {
  if (!word) return ''
  if (INVARIANT_WORDS.has(word) || SINGULAR_ENDING_WITH_S.has(word)) {
    return word
  }
  const irregular = IRREGULAR_PLURAL_TO_SINGULAR[word]
  if (irregular) {
    return irregular
  }
  if (KNOWN_IRREGULAR_SINGULARS.has(word)) {
    return word
  }
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) {
    return word
  }

  if (word.endsWith('ies') && word.length > 3) {
    if (IE_ROOT_PLURALS.has(word)) {
      return word.slice(0, -1)
    }
    return `${word.slice(0, -3)}y`
  }

  if (
    word.endsWith('sses') ||
    word.endsWith('xes') ||
    word.endsWith('zzes') ||
    word.endsWith('shes') ||
    (word.endsWith('ches') && !SILENT_E_CHES_PLURALS.has(word)) ||
    /^(?:waltzes|blitzes|topazes)$/.test(word)
  ) {
    return word.slice(0, -2)
  }

  if (word.endsWith('s') && word.length > 1) {
    return word.slice(0, -1)
  }

  return word
}

function pluralizeToken(word: string): string {
  if (!word) return ''
  if (INVARIANT_WORDS.has(word) || KNOWN_IRREGULAR_PLURALS.has(word)) {
    return word
  }
  const irregular = IRREGULAR_SINGULAR_TO_PLURAL[word]
  if (irregular) {
    return irregular
  }

  // 如果已经是规则复数形式，先还原单数幂等判定，避免 users -> userses
  if (word.endsWith('s') && !SINGULAR_ENDING_WITH_S.has(word) && !word.endsWith('ss')) {
    const sing = singularizeToken(word)
    if (sing !== word) {
      return word
    }
  }

  if (word.length > 1 && word.endsWith('y') && !/[aeiou]y$/.test(word)) {
    return `${word.slice(0, -1)}ies`
  }

  if (
    word.endsWith('ss') ||
    word.endsWith('x') ||
    word.endsWith('zz') ||
    word.endsWith('z') ||
    word.endsWith('ch') ||
    word.endsWith('sh')
  ) {
    return `${word}es`
  }

  return `${word}s`
}

export function toSnakeCase(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return trimmed
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
}

export function toPascalCase(input: string): string {
  const snake = toSnakeCase(input)
  if (!snake) return ''
  return snake
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input)
  if (!pascal) return ''
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/**
 * 将单词或复合 `snake_case` 标识符转换为单数形式（仅对最后一个下划线分段变形，保留前缀）。
 */
export function toSingular(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const normalized = /[A-Z]/.test(trimmed) ? toSnakeCase(trimmed) : trimmed.toLowerCase()
  const lastSep = normalized.lastIndexOf('_')
  if (lastSep >= 0) {
    const prefix = normalized.slice(0, lastSep + 1)
    const tail = normalized.slice(lastSep + 1)
    return tail ? `${prefix}${singularizeToken(tail)}` : normalized
  }
  return singularizeToken(normalized)
}

/**
 * 将单词或复合 `snake_case` 标识符转换为复数形式（仅对最后一个下划线分段变形，保留前缀）。
 */
export function toPlural(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const normalized = /[A-Z]/.test(trimmed) ? toSnakeCase(trimmed) : trimmed.toLowerCase()
  const lastSep = normalized.lastIndexOf('_')
  if (lastSep >= 0) {
    const prefix = normalized.slice(0, lastSep + 1)
    const tail = normalized.slice(lastSep + 1)
    return tail ? `${prefix}${pluralizeToken(tail)}` : normalized
  }
  return pluralizeToken(normalized)
}
