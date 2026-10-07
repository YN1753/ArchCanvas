/**
 * 轻量级不可变 RFC 6902 JSON Patch 差异计算与应用引擎。
 *
 * 专为 ER 建模状态树（ERDesign）的历史撤销/重做（Undo/Redo）设计：
 * 1. 废除每次微调时整棵 DSL 树的全量深拷贝；
 * 2. 仅计算并存储正向（redo）与逆向（undo）补丁包；
 * 3. 50 步历史栈内存占用从数兆字节（MB）锐减至数千字节（KB）。
 */

export type PatchOp = 'add' | 'remove' | 'replace'

export interface Patch {
  op: PatchOp
  path: string
  value?: unknown
  oldValue?: unknown
}

export interface HistoryEntry {
  undo: Patch[]
  redo: Patch[]
  debounceKey?: string
}

/**
 * 编码 JSON Pointer 特殊字符 (~ 与 /)。
 */
export function escapePointer(str: string): string {
  return str.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * 解码 JSON Pointer 特殊字符。
 */
export function unescapePointer(str: string): string {
  return str.replace(/~1/g, '/').replace(/~0/g, '~')
}

/**
 * 解析 JSON Pointer 路径为段数组。
 */
export function parsePointer(path: string): string[] {
  if (path === '' || path === '/') return []
  if (!path.startsWith('/')) {
    throw new Error(`Invalid JSON Pointer: ${path}`)
  }
  return path.slice(1).split('/').map(unescapePointer)
}

function getItemKey(item: unknown): string | null {
  if (item && typeof item === 'object') {
    if ('id' in item && typeof (item as Record<string, unknown>).id === 'string') {
      return (item as Record<string, unknown>).id as string
    }
    if ('name' in item && typeof (item as Record<string, unknown>).name === 'string') {
      return (item as Record<string, unknown>).name as string
    }
  }
  return null
}

function diffArray(before: unknown[], after: unknown[], path: string): Patch[] {
  if (before === after) return []

  // 情况 1: 长度相同，逐元素比对
  if (before.length === after.length) {
    const patches: Patch[] = []
    for (let i = 0; i < before.length; i++) {
      const keyBefore = getItemKey(before[i])
      const keyAfter = getItemKey(after[i])
      const subPath = `${path}/${i}`

      // 如果两个元素都具备 key 且不一致，说明发生了同级元素替换
      if (keyBefore !== null && keyAfter !== null && keyBefore !== keyAfter) {
        patches.push({ op: 'replace', path: subPath, value: after[i], oldValue: before[i] })
      } else {
        patches.push(...diffValues(before[i], after[i], subPath))
      }
    }
    return patches
  }

  // 情况 2: 单个新增 (after.length === before.length + 1)
  if (after.length === before.length + 1) {
    const keysBefore = new Set(before.map(getItemKey).filter((k): k is string => k !== null))
    let addedIdx = -1

    if (keysBefore.size > 0) {
      addedIdx = after.findIndex((item) => {
        const k = getItemKey(item)
        return k !== null && !keysBefore.has(k)
      })
    }

    // 如果未通过 key 匹配到，按首个不一致索引判定
    if (addedIdx === -1) {
      for (let i = 0; i < before.length; i++) {
        if (before[i] !== after[i]) {
          addedIdx = i
          break
        }
      }
      if (addedIdx === -1) {
        addedIdx = after.length - 1
      }
    }

    const patches: Patch[] = []
    // 插入点之前的元素 diff
    for (let i = 0; i < addedIdx; i++) {
      patches.push(...diffValues(before[i], after[i], `${path}/${i}`))
    }
    // 插入操作
    patches.push({ op: 'add', path: `${path}/${addedIdx}`, value: after[addedIdx] })
    // 插入点之后的元素 diff
    for (let i = addedIdx; i < before.length; i++) {
      patches.push(...diffValues(before[i], after[i + 1], `${path}/${i + 1}`))
    }
    return patches
  }

  // 情况 3: 单个删除 (before.length === after.length + 1)
  if (before.length === after.length + 1) {
    const keysAfter = new Set(after.map(getItemKey).filter((k): k is string => k !== null))
    let removedIdx = -1

    if (keysAfter.size > 0) {
      removedIdx = before.findIndex((item) => {
        const k = getItemKey(item)
        return k !== null && !keysAfter.has(k)
      })
    }

    // 如果未通过 key 匹配到，按首个不一致索引判定
    if (removedIdx === -1) {
      for (let i = 0; i < after.length; i++) {
        if (before[i] !== after[i]) {
          removedIdx = i
          break
        }
      }
      if (removedIdx === -1) {
        removedIdx = before.length - 1
      }
    }

    const patches: Patch[] = []
    // 删除点之前的元素 diff
    for (let i = 0; i < removedIdx; i++) {
      patches.push(...diffValues(before[i], after[i], `${path}/${i}`))
    }
    // 删除操作
    patches.push({ op: 'remove', path: `${path}/${removedIdx}`, oldValue: before[removedIdx] })
    // 删除点之后的元素 diff (after 中的元素与 before[i + 1] 对齐)
    for (let i = removedIdx; i < after.length; i++) {
      patches.push(...diffValues(before[i + 1], after[i], `${path}/${i}`))
    }
    return patches
  }

  // 情况 4: 批量增删或全量替换，直接针对当前数组路径做 replace
  return [{ op: 'replace', path, value: after, oldValue: before }]
}

function diffObject(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: string,
): Patch[] {
  const patches: Patch[] = []
  const keysBefore = Object.keys(before)
  const keysAfter = Object.keys(after)
  const allKeys = new Set([...keysBefore, ...keysAfter])

  for (const key of allKeys) {
    const valBefore = before[key]
    const valAfter = after[key]
    const subPath = path ? `${path}/${escapePointer(key)}` : `/${escapePointer(key)}`

    if (valBefore === undefined && valAfter !== undefined) {
      patches.push({ op: 'add', path: subPath, value: valAfter })
    } else if (valBefore !== undefined && valAfter === undefined) {
      patches.push({ op: 'remove', path: subPath, oldValue: valBefore })
    } else if (valBefore !== valAfter) {
      patches.push(...diffValues(valBefore, valAfter, subPath))
    }
  }

  return patches
}

function diffValues(before: unknown, after: unknown, path: string): Patch[] {
  if (before === after) return []

  if (
    before === null ||
    after === null ||
    before === undefined ||
    after === undefined ||
    typeof before !== 'object' ||
    typeof after !== 'object'
  ) {
    return [{ op: 'replace', path, value: after, oldValue: before }]
  }

  const isArrBefore = Array.isArray(before)
  const isArrAfter = Array.isArray(after)

  if (isArrBefore && isArrAfter) {
    return diffArray(before, after, path)
  }

  if (isArrBefore !== isArrAfter) {
    return [{ op: 'replace', path, value: after, oldValue: before }]
  }

  return diffObject(
    before as Record<string, unknown>,
    after as Record<string, unknown>,
    path,
  )
}

/**
 * 计算两个任意数据结构（例如 ERDesign）之间的 RFC 6902 JSON Patch 正向补丁包。
 */
export function createPatch(before: unknown, after: unknown): Patch[] {
  return diffValues(before, after, '')
}

/**
 * 逆转补丁包，生成用于 Undo 的反向操作列表。
 * 注意：必须逆序应用以确保数组索引与对象属性撤销顺序严格正确。
 */
export function invertPatch(patches: Patch[]): Patch[] {
  const result: Patch[] = []
  for (let i = patches.length - 1; i >= 0; i--) {
    const p = patches[i]
    if (p.op === 'replace') {
      result.push({
        op: 'replace',
        path: p.path,
        value: p.oldValue,
        oldValue: p.value,
      })
    } else if (p.op === 'add') {
      result.push({
        op: 'remove',
        path: p.path,
        oldValue: p.value,
      })
    } else if (p.op === 'remove') {
      result.push({
        op: 'add',
        path: p.path,
        value: p.oldValue,
      })
    }
  }
  return result
}

function applySinglePatch(root: any, patch: Patch): void {
  const segments = parsePointer(patch.path)
  if (segments.length === 0) return

  let curr = root
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    if (curr[seg] === undefined || curr[seg] === null) {
      const nextSeg = segments[i + 1]
      const isNextIndex = /^\d+$/.test(nextSeg)
      curr[seg] = isNextIndex ? [] : {}
    }
    curr = curr[seg]
  }

  const lastSeg = segments[segments.length - 1]
  const isArr = Array.isArray(curr)

  if (patch.op === 'add') {
    if (isArr) {
      if (lastSeg === '-') {
        curr.push(structuredClone(patch.value))
      } else {
        const idx = Number(lastSeg)
        curr.splice(idx, 0, structuredClone(patch.value))
      }
    } else {
      curr[lastSeg] = structuredClone(patch.value)
    }
  } else if (patch.op === 'remove') {
    if (isArr) {
      const idx = Number(lastSeg)
      curr.splice(idx, 1)
    } else {
      delete curr[lastSeg]
    }
  } else if (patch.op === 'replace') {
    if (isArr) {
      const idx = Number(lastSeg)
      curr[idx] = structuredClone(patch.value)
    } else {
      curr[lastSeg] = structuredClone(patch.value)
    }
  }
}

/**
 * 将一组补丁包无副作用（深拷贝根实例后）应用到基础对象上。
 */
export function applyPatch<T>(base: T, patches: Patch[]): T {
  if (!patches || patches.length === 0) return base
  let root: any = structuredClone(base)
  for (const patch of patches) {
    if (patch.path === '') {
      if (patch.op === 'replace') {
        root = structuredClone(patch.value)
      }
    } else {
      applySinglePatch(root, patch)
    }
  }
  return root
}
