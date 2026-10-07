import type { StateCreator } from 'zustand'

import { api } from '../../api/client'
import { ensureLayout } from '../../flow/layout'
import type { ConceptualDesign, Entity, ERDesign } from '../../types/dsl'
import { validateDesign } from '../../validate/dsl'
import { applyPatch, createPatch, invertPatch, type HistoryEntry } from '../patch'
import type { HistorySlice, Store } from '../types'
import { errorMessage, saveChenPositions } from '../utils'

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

let lastConceptualSnapshotTime = 0
let lastConceptualDebounceKey: string | null = null
let pendingConceptualBaseline: ConceptualDesign | null = null
let debounceConceptualBaseline: ConceptualDesign | null = null

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

  function recomputeConceptual(conceptualDesign: ConceptualDesign, extras?: Partial<Store>) {
    if (pendingConceptualBaseline !== null && pendingConceptualBaseline !== conceptualDesign) {
      const baseline = pendingConceptualBaseline
      pendingConceptualBaseline = null

      const now = Date.now()
      const isDebouncing =
        lastConceptualDebounceKey !== null &&
        pastStack.length > 0 &&
        pastStack[pastStack.length - 1].debounceKey === lastConceptualDebounceKey &&
        pastStack[pastStack.length - 1].conceptualRedo !== undefined &&
        debounceConceptualBaseline !== null &&
        now - lastConceptualSnapshotTime < 600

      if (isDebouncing) {
        const redo = createPatch(debounceConceptualBaseline, conceptualDesign)
        if (redo.length > 0) {
          const undo = invertPatch(redo)
          pastStack[pastStack.length - 1] = {
            conceptualUndo: undo,
            conceptualRedo: redo,
            debounceKey: lastConceptualDebounceKey ?? undefined,
          }
        }
      } else {
        const redo = createPatch(baseline, conceptualDesign)
        if (redo.length > 0) {
          const undo = invertPatch(redo)
          pastStack.push({
            conceptualUndo: undo,
            conceptualRedo: redo,
            debounceKey: lastConceptualDebounceKey ?? undefined,
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
      conceptualDesign,
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
    const targetProjectId = project.id
    set({ saveState: 'saving' })
    try {
      await api.saveConceptualDesign(targetProjectId, conceptualDesign)
      // 若请求返回期间用户已切换至其他项目，丢弃无效回包
      if (get().project?.id !== targetProjectId) {
        return
      }
      set({ saveState: 'saved', saveError: null })
    } catch (err) {
      if (get().project?.id !== targetProjectId) {
        return
      }
      set({ saveState: 'error', saveError: errorMessage(err) })
    }
  }

  async function flushSave() {
    const { project, design } = get()
    if (!project) {
      return
    }
    const targetProjectId = project.id
    if (saveInFlight) {
      savePending = true
      return
    }

    const countAtStart = mutationCount
    saveInFlight = true
    set({ saveState: 'saving', saveError: null })

    try {
      const result = await api.saveERDesign(targetProjectId, design)
      // 若请求返回期间用户已切换至其他项目，丢弃并避免污染新项目画布状态
      if (get().project?.id !== targetProjectId) {
        return
      }
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
      if (get().project?.id === targetProjectId) {
        set({ saveState: 'error', saveError: errorMessage(error) })
      }
    } finally {
      saveInFlight = false
      if (savePending && get().project?.id === targetProjectId) {
        savePending = false
        scheduleSave()
      } else {
        savePending = false
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

  function recordConceptualSnapshot(debounceKey?: string) {
    const now = Date.now()
    if (debounceKey && lastConceptualDebounceKey === debounceKey && now - lastConceptualSnapshotTime < 600) {
      lastConceptualSnapshotTime = now
      pendingConceptualBaseline = debounceConceptualBaseline ?? get().conceptualDesign
      return
    }

    lastConceptualSnapshotTime = now
    lastConceptualDebounceKey = debounceKey ?? null
    const currentConceptual = get().conceptualDesign
    pendingConceptualBaseline = currentConceptual
    debounceConceptualBaseline = currentConceptual
  }

  function resetHistory() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (saveConceptualTimer !== null) {
      clearTimeout(saveConceptualTimer)
      saveConceptualTimer = null
    }
    saveInFlight = false
    savePending = false
    pastStack = []
    futureStack = []
    lastSnapshotTime = 0
    lastDebounceKey = null
    pendingBaseline = null
    debounceBaseline = null
    lastConceptualSnapshotTime = 0
    lastConceptualDebounceKey = null
    pendingConceptualBaseline = null
    debounceConceptualBaseline = null
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

  function mutateConceptual(next: ConceptualDesign, debounceKey?: string, extras?: Partial<Store>) {
    recordConceptualSnapshot(debounceKey)
    mutationCount += 1
    recomputeConceptual(next, extras)
    scheduleSaveConceptual()
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
    mutateConceptual,
    withEntities,

    undo() {
      if (pastStack.length === 0) return
      const entry = pastStack.pop()!
      futureStack.push(entry)
      mutationCount += 1

      if (entry.conceptualUndo && entry.conceptualUndo.length > 0) {
        const currentConceptual = get().conceptualDesign
        const previousConceptual = applyPatch(currentConceptual, entry.conceptualUndo)
        lastConceptualDebounceKey = null
        lastConceptualSnapshotTime = 0
        pendingConceptualBaseline = null
        debounceConceptualBaseline = null

        const currentSelection = get().selection
        let validSelection = false
        if (currentSelection?.kind === 'entity') {
          validSelection = (previousConceptual.concepts || []).some(
            (c) => c.id === currentSelection.id || c.name === currentSelection.id,
          )
        } else if (currentSelection?.kind === 'relation') {
          validSelection = (previousConceptual.relations || []).some(
            (r) => r.id === currentSelection.id,
          )
        }

        const project = get().project
        const nextChenPositions = { ...get().chenPositions }
        for (const c of previousConceptual.concepts || []) {
          const cid = c.id || `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
          if (c.position) {
            nextChenPositions[cid] = c.position
            if (c.id) nextChenPositions[c.id] = c.position
          }
        }
        for (const r of previousConceptual.relations || []) {
          if (r.position) {
            if (r.id) nextChenPositions[r.id] = r.position
            nextChenPositions[`rel-${r.id}`] = r.position
          }
        }
        if (project) {
          saveChenPositions(project.id, nextChenPositions)
        }

        set({
          conceptualDesign: previousConceptual,
          chenPositions: nextChenPositions,
          selection: validSelection ? currentSelection : null,
        })
        scheduleSaveConceptual()
      }

      if (entry.undo && entry.undo.length > 0) {
        const current = get().design
        const previous = applyPatch(current, entry.undo)

        lastDebounceKey = null
        lastSnapshotTime = 0
        pendingBaseline = null
        debounceBaseline = null

        const currentSelection = get().selection
        const validEntity =
          currentSelection?.kind === 'entity' && previous.entities.some((e) => e.id === currentSelection.id)
        const validRelation =
          currentSelection?.kind === 'relation' && previous.relations.some((r) => r.id === currentSelection.id)

        recompute(previous, {
          selection: validEntity || validRelation ? currentSelection : null,
        })
        scheduleSave()
      }

      set({
        canUndo: pastStack.length > 0,
        canRedo: true,
      })
    },

    redo() {
      if (futureStack.length === 0) return
      const entry = futureStack.pop()!
      pastStack.push(entry)
      mutationCount += 1

      if (entry.conceptualRedo && entry.conceptualRedo.length > 0) {
        const currentConceptual = get().conceptualDesign
        const nextConceptual = applyPatch(currentConceptual, entry.conceptualRedo)
        lastConceptualDebounceKey = null
        lastConceptualSnapshotTime = 0
        pendingConceptualBaseline = null
        debounceConceptualBaseline = null

        const currentSelection = get().selection
        let validSelection = false
        if (currentSelection?.kind === 'entity') {
          validSelection = (nextConceptual.concepts || []).some(
            (c) => c.id === currentSelection.id || c.name === currentSelection.id,
          )
        } else if (currentSelection?.kind === 'relation') {
          validSelection = (nextConceptual.relations || []).some(
            (r) => r.id === currentSelection.id,
          )
        }

        const project = get().project
        const nextChenPositions = { ...get().chenPositions }
        for (const c of nextConceptual.concepts || []) {
          const cid = c.id || `concept_${c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
          if (c.position) {
            nextChenPositions[cid] = c.position
            if (c.id) nextChenPositions[c.id] = c.position
          }
        }
        for (const r of nextConceptual.relations || []) {
          if (r.position) {
            if (r.id) nextChenPositions[r.id] = r.position
            nextChenPositions[`rel-${r.id}`] = r.position
          }
        }
        if (project) {
          saveChenPositions(project.id, nextChenPositions)
        }

        set({
          conceptualDesign: nextConceptual,
          chenPositions: nextChenPositions,
          selection: validSelection ? currentSelection : null,
        })
        scheduleSaveConceptual()
      }

      if (entry.redo && entry.redo.length > 0) {
        const current = get().design
        const next = applyPatch(current, entry.redo)

        lastDebounceKey = null
        lastSnapshotTime = 0
        pendingBaseline = null
        debounceBaseline = null

        const currentSelection = get().selection
        const validEntity =
          currentSelection?.kind === 'entity' && next.entities.some((e) => e.id === currentSelection.id)
        const validRelation =
          currentSelection?.kind === 'relation' && next.relations.some((r) => r.id === currentSelection.id)

        recompute(next, {
          selection: validEntity || validRelation ? currentSelection : null,
        })
        scheduleSave()
      }

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
