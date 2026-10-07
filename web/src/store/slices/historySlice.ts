import type { StateCreator } from 'zustand'

import { api } from '../../api/client'
import { ensureLayout } from '../../flow/layout'
import type { Entity, ERDesign } from '../../types/dsl'
import { validateDesign } from '../../validate/dsl'
import { applyPatch, createPatch, invertPatch, type HistoryEntry } from '../patch'
import type { HistorySlice, Store } from '../types'
import { errorMessage } from '../utils'

const SAVE_DEBOUNCE_MS = 700
const MAX_HISTORY = 50

/** 本地变更计数：用来判断一次保存请求返回时，用户是否又改了东西。 */
let mutationCount = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveConceptualTimer: ReturnType<typeof setTimeout> | null = null
let saveInFlight = false
let savePending = false

let pastStack: HistoryEntry[] = []
let futureStack: HistoryEntry[] = []
let lastSnapshotTime = 0
let lastDebounceKey: string | null = null
let pendingBaseline: ERDesign | null = null
let debounceBaseline: ERDesign | null = null

export const createHistorySlice: StateCreator<Store, [], [], HistorySlice> = (set, get) => {
  function recompute(design: ERDesign, extras?: Partial<Store>) {
    if (pendingBaseline !== null && pendingBaseline !== design) {
      const baseline = pendingBaseline
      pendingBaseline = null

      const now = Date.now()
      const isDebouncing =
        lastDebounceKey !== null &&
        pastStack.length > 0 &&
        pastStack[pastStack.length - 1].debounceKey === lastDebounceKey &&
        debounceBaseline !== null &&
        now - lastSnapshotTime < 600

      if (isDebouncing) {
        // 当前处于连续防抖会话中，更新栈顶 entry 的 redo/undo 为从首次 baseline 到当前最新 design 的 diff
        const redo = createPatch(debounceBaseline, design)
        if (redo.length > 0) {
          const undo = invertPatch(redo)
          pastStack[pastStack.length - 1] = {
            undo,
            redo,
            debounceKey: lastDebounceKey ?? undefined,
          }
        }
      } else {
        const redo = createPatch(baseline, design)
        if (redo.length > 0) {
          const undo = invertPatch(redo)
          pastStack.push({
            undo,
            redo,
            debounceKey: lastDebounceKey ?? undefined,
          })
          if (pastStack.length > MAX_HISTORY) {
            pastStack.shift()
          }
          futureStack = []
          set({
            canUndo: true,
            canRedo: false,
          })
        }
      }
    }

    set({
      design,
      report: validateDesign(design),
      ...extras,
    })
  }

  function scheduleSave() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }

  function scheduleSaveConceptual() {
    if (saveConceptualTimer !== null) {
      clearTimeout(saveConceptualTimer)
    }
    saveConceptualTimer = setTimeout(() => {
      saveConceptualTimer = null
      void flushSaveConceptual()
    }, SAVE_DEBOUNCE_MS)
  }

  async function flushSaveConceptual() {
    const { project, conceptualDesign } = get()
    if (!project) return
    set({ saveState: 'saving' })
    try {
      await api.saveConceptualDesign(project.id, conceptualDesign)
      set({ saveState: 'saved', saveError: null })
    } catch (err) {
      set({ saveState: 'error', saveError: errorMessage(err) })
    }
  }

  async function flushSave() {
    const { project, design } = get()
    if (!project) {
      return
    }
    if (saveInFlight) {
      savePending = true
      return
    }

    const countAtStart = mutationCount
    saveInFlight = true
    set({ saveState: 'saving', saveError: null })

    try {
      const result = await api.saveERDesign(project.id, design)
      const changedDuringRequest = mutationCount !== countAtStart
      set({
        saveState: 'saved',
        saveError: null,
        serverWarnings: result.warnings ?? [],
      })
      // 保存期间用户又改了东西时，不要用服务端返回值覆盖本地编辑。
      if (!changedDuringRequest) {
        const currentPositions = new Map(get().design.entities.map((e) => [e.id, e.position]))
        const posByName = new Map(get().design.entities.map((e) => [e.name.toLowerCase(), e.position]))
        const mergedEntities = result.design.entities.map((e) => ({
          ...e,
          position: e.position ?? currentPositions.get(e.id) ?? posByName.get(e.name.toLowerCase()),
        }))

        // 如果用户当前选中的实体 ID 被后端分配了新 UUIDv7，按名称平滑迁移选中态
        const currentSel = get().selection
        let nextSelection = currentSel
        if (currentSel?.kind === 'entity') {
          const stillValid = mergedEntities.some((e) => e.id === currentSel.id)
          if (!stillValid) {
            const oldEntity = get().design.entities.find((e) => e.id === currentSel.id)
            if (oldEntity) {
              const matched = mergedEntities.find(
                (e) => e.name.toLowerCase() === oldEntity.name.toLowerCase(),
              )
              if (matched) {
                nextSelection = { kind: 'entity', id: matched.id }
              }
            }
          }
        }

        recompute(ensureLayout({ ...result.design, entities: mergedEntities }), {
          selection: nextSelection,
        })
      }
    } catch (error) {
      set({ saveState: 'error', saveError: errorMessage(error) })
    } finally {
      saveInFlight = false
      if (savePending) {
        savePending = false
        scheduleSave()
      }
    }
  }

  function recordSnapshot(debounceKey?: string) {
    const now = Date.now()
    if (debounceKey && lastDebounceKey === debounceKey && now - lastSnapshotTime < 600) {
      lastSnapshotTime = now
      pendingBaseline = debounceBaseline ?? get().design
      return
    }

    lastSnapshotTime = now
    lastDebounceKey = debounceKey ?? null
    const currentDesign = get().design
    pendingBaseline = currentDesign
    debounceBaseline = currentDesign
  }

  function resetHistory() {
    pastStack = []
    futureStack = []
    lastSnapshotTime = 0
    lastDebounceKey = null
    pendingBaseline = null
    debounceBaseline = null
    set({
      canUndo: false,
      canRedo: false,
    })
  }

  function mutate(next: ERDesign, debounceKey?: string) {
    recordSnapshot(debounceKey)
    mutationCount += 1
    recompute(next)
    scheduleSave()
  }

  function withEntities(updater: (entities: Entity[]) => Entity[], debounceKey?: string) {
    const { design } = get()
    mutate({ ...design, entities: updater(design.entities) }, debounceKey)
  }

  return {
    saveState: 'idle',
    saveError: null,
    canUndo: false,
    canRedo: false,
    serverWarnings: [],

    recompute,
    scheduleSave,
    flushSave,
    scheduleSaveConceptual,
    flushSaveConceptual,
    recordSnapshot,
    resetHistory,
    mutate,
    withEntities,

    undo() {
      if (pastStack.length === 0) return
      const entry = pastStack.pop()!
      const current = get().design
      const previous = applyPatch(current, entry.undo)

      futureStack.push(entry)
      lastDebounceKey = null
      lastSnapshotTime = 0
      pendingBaseline = null
      debounceBaseline = null
      mutationCount += 1

      const currentSelection = get().selection
      const validEntity =
        currentSelection?.kind === 'entity' && previous.entities.some((e) => e.id === currentSelection.id)
      const validRelation =
        currentSelection?.kind === 'relation' && previous.relations.some((r) => r.id === currentSelection.id)

      recompute(previous, {
        selection: validEntity || validRelation ? currentSelection : null,
      })
      scheduleSave()
      set({
        canUndo: pastStack.length > 0,
        canRedo: true,
      })
    },

    redo() {
      if (futureStack.length === 0) return
      const entry = futureStack.pop()!
      const current = get().design
      const next = applyPatch(current, entry.redo)

      pastStack.push(entry)
      lastDebounceKey = null
      lastSnapshotTime = 0
      pendingBaseline = null
      debounceBaseline = null
      mutationCount += 1

      const currentSelection = get().selection
      const validEntity =
        currentSelection?.kind === 'entity' && next.entities.some((e) => e.id === currentSelection.id)
      const validRelation =
        currentSelection?.kind === 'relation' && next.relations.some((r) => r.id === currentSelection.id)

      recompute(next, {
        selection: validEntity || validRelation ? currentSelection : null,
      })
      scheduleSave()
      set({
        canUndo: true,
        canRedo: futureStack.length > 0,
      })
    },

    async saveNow() {
      if (saveTimer !== null) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      if (saveConceptualTimer !== null) {
        clearTimeout(saveConceptualTimer)
        saveConceptualTimer = null
      }
      await Promise.all([flushSave(), flushSaveConceptual()])
    },
  }
}
