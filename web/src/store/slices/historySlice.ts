import type { StateCreator } from 'zustand'

import { api } from '../../api/client'
import { ensureLayout } from '../../flow/layout'
import type { ConceptualDesign, Entity, ERDesign } from '../../types/dsl'
import { validateDesign } from '../../validate/dsl'
import { applyPatch, createPatch, invertPatch, type HistoryEntry } from '../patch'
import type { HistorySlice, SaveState, Store } from '../types'
import { errorMessage, saveChenPositions } from '../utils'

const SAVE_DEBOUNCE_MS = 700
const MAX_HISTORY = 50

export const createHistorySlice: StateCreator<Store, [], [], HistorySlice> = (set, get) => {
  /** 本地变更计数：用来判断一次保存请求返回时，用户是否又改了东西。 */
  let mutationCount = 0
  let dirtyErVersion = 0
  let savedErVersion = 0
  let dirtyConceptualVersion = 0
  let savedConceptualVersion = 0

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saveConceptualTimer: ReturnType<typeof setTimeout> | null = null
  let savePending = false
  let saveConceptualPending = false
  let inFlightErPromise: Promise<void> | null = null
  let inFlightConceptualPromise: Promise<void> | null = null

  let erSaveState: SaveState = 'idle'
  let erSaveError: string | null = null
  let conceptualSaveState: SaveState = 'idle'
  let conceptualSaveError: string | null = null

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

  function syncCombinedSaveState(extras?: Partial<Store>) {
    let combinedState: SaveState = 'idle'
    let combinedError: string | null = null
    if (erSaveState === 'saving' || conceptualSaveState === 'saving') {
      combinedState = 'saving'
    } else if (erSaveState === 'error' || conceptualSaveState === 'error') {
      combinedState = 'error'
      combinedError = erSaveError ?? conceptualSaveError
    } else if (erSaveState === 'saved' || conceptualSaveState === 'saved') {
      combinedState = 'saved'
    }
    set({
      saveState: combinedState,
      saveError: combinedError,
      ...extras,
    })
  }

  function recompute(design: ERDesign, extras?: Partial<Store>) {
    if (pendingBaseline !== null && pendingBaseline !== design) {
      const baseline = pendingBaseline
      pendingBaseline = null

      const now = Date.now()
      const isDebouncing =
        lastDebounceKey !== null &&
        pastStack.length > 0 &&
        pastStack[pastStack.length - 1].debounceKey === lastDebounceKey &&
        pastStack[pastStack.length - 1].redo !== undefined &&
        debounceBaseline !== null &&
        now - lastSnapshotTime < 600

      if (isDebouncing) {
        const redo = createPatch(debounceBaseline, design)
        if (redo.length > 0) {
          const undo = invertPatch(redo)
          pastStack[pastStack.length - 1] = {
            undo,
            redo,
            debounceKey: lastDebounceKey ?? undefined,
          }
        } else {
          // 防抖窗口内编辑回退到初始原值，弹出残留栈顶补丁
          pastStack.pop()
          lastDebounceKey = null
          debounceBaseline = null
          set({
            canUndo: pastStack.length > 0,
            canRedo: futureStack.length > 0,
          })
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
        } else {
          pastStack.pop()
          lastConceptualDebounceKey = null
          debounceConceptualBaseline = null
          set({
            canUndo: pastStack.length > 0,
            canRedo: futureStack.length > 0,
          })
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

  function startErSaveTimer() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }

  function scheduleSave() {
    mutationCount += 1
    dirtyErVersion += 1
    startErSaveTimer()
  }

  function startConceptualSaveTimer() {
    if (saveConceptualTimer !== null) {
      clearTimeout(saveConceptualTimer)
    }
    saveConceptualTimer = setTimeout(() => {
      saveConceptualTimer = null
      void flushSaveConceptual()
    }, SAVE_DEBOUNCE_MS)
  }

  function scheduleSaveConceptual() {
    mutationCount += 1
    dirtyConceptualVersion += 1
    startConceptualSaveTimer()
  }

  async function flushSaveConceptual(): Promise<void> {
    const { project, conceptualDesign } = get()
    if (!project) return
    const targetProjectId = project.id
    if (inFlightConceptualPromise) {
      saveConceptualPending = true
      return
    }

    const versionAtStart = dirtyConceptualVersion
    conceptualSaveState = 'saving'
    conceptualSaveError = null
    syncCombinedSaveState()

    const run = (async () => {
      try {
        await api.saveConceptualDesign(targetProjectId, conceptualDesign)
        if (get().project?.id !== targetProjectId) {
          return
        }
        savedConceptualVersion = Math.max(savedConceptualVersion, versionAtStart)
        conceptualSaveState = 'saved'
        conceptualSaveError = null
        syncCombinedSaveState()
      } catch (err) {
        if (get().project?.id !== targetProjectId) {
          return
        }
        conceptualSaveState = 'error'
        conceptualSaveError = errorMessage(err)
        syncCombinedSaveState()
      } finally {
        inFlightConceptualPromise = null
        if (saveConceptualPending && get().project?.id === targetProjectId) {
          saveConceptualPending = false
          startConceptualSaveTimer()
        } else {
          saveConceptualPending = false
        }
      }
    })()

    inFlightConceptualPromise = run
    return run
  }

  async function flushSave(): Promise<void> {
    const { project, design } = get()
    if (!project) {
      return
    }
    const targetProjectId = project.id
    if (inFlightErPromise) {
      savePending = true
      return
    }

    const countAtStart = mutationCount
    const versionAtStart = dirtyErVersion
    erSaveState = 'saving'
    erSaveError = null
    syncCombinedSaveState()

    const run = (async () => {
      try {
        const result = await api.saveERDesign(targetProjectId, design)
        if (get().project?.id !== targetProjectId) {
          return
        }
        savedErVersion = Math.max(savedErVersion, versionAtStart)
        const changedDuringRequest = mutationCount !== countAtStart
        erSaveState = 'saved'
        erSaveError = null
        syncCombinedSaveState({
          serverWarnings: result.warnings ?? [],
        })

        // 保存期间用户又改了东西时，不要用服务端返回值覆盖本地编辑。
        if (!changedDuringRequest) {
          const localEntities = get().design.entities
          const localRelations = get().design.relations
          const currentPositions = new Map(localEntities.map((e) => [e.id, e.position]))
          const posByName = new Map(localEntities.map((e) => [e.name.toLowerCase(), e.position]))
          const mergedEntities = result.design.entities.map((e) => ({
            ...e,
            position: e.position ?? currentPositions.get(e.id) ?? posByName.get(e.name.toLowerCase()),
          }))

          const entityIdByLowerName = new Map(mergedEntities.map((e) => [e.name.toLowerCase(), e.id]))
          const oldEntityNameById = new Map(localEntities.map((e) => [e.id, e.name.toLowerCase()]))

          const currentSel = get().selection
          let nextSelection = currentSel
          if (currentSel?.kind === 'entity') {
            const stillValid = mergedEntities.some((e) => e.id === currentSel.id)
            if (!stillValid) {
              const oldName = oldEntityNameById.get(currentSel.id)
              const mappedId = oldName ? entityIdByLowerName.get(oldName) : undefined
              if (mappedId) {
                nextSelection = { kind: 'entity', id: mappedId }
              }
            }
          } else if (currentSel?.kind === 'relation') {
            const stillValid = result.design.relations.some((r) => r.id === currentSel.id)
            if (!stillValid) {
              const oldRel = localRelations.find((r) => r.id === currentSel.id)
              if (oldRel) {
                const mappedSrc =
                  entityIdByLowerName.get(oldEntityNameById.get(oldRel.source_entity_id) ?? '') ??
                  oldRel.source_entity_id
                const mappedTgt =
                  entityIdByLowerName.get(oldEntityNameById.get(oldRel.target_entity_id) ?? '') ??
                  oldRel.target_entity_id
                const matched = result.design.relations.find(
                  (r) =>
                    r.source_entity_id === mappedSrc &&
                    r.target_entity_id === mappedTgt &&
                    r.cardinality === oldRel.cardinality,
                )
                if (matched) {
                  nextSelection = { kind: 'relation', id: matched.id }
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
          erSaveState = 'error'
          erSaveError = errorMessage(error)
          syncCombinedSaveState()
        }
      } finally {
        inFlightErPromise = null
        if (savePending && get().project?.id === targetProjectId) {
          savePending = false
          startErSaveTimer()
        } else {
          savePending = false
        }
      }
    })()

    inFlightErPromise = run
    return run
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
    inFlightErPromise = null
    inFlightConceptualPromise = null
    savePending = false
    saveConceptualPending = false
    dirtyErVersion = 0
    savedErVersion = 0
    dirtyConceptualVersion = 0
    savedConceptualVersion = 0
    erSaveState = 'idle'
    erSaveError = null
    conceptualSaveState = 'idle'
    conceptualSaveError = null
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
      saveState: 'idle',
      saveError: null,
      canUndo: false,
      canRedo: false,
    })
  }

  function mutate(next: ERDesign, debounceKey?: string, extras?: Partial<Store>) {
    recordSnapshot(debounceKey)
    recompute(next, extras)
    scheduleSave()
  }

  function mutateConceptual(next: ConceptualDesign, debounceKey?: string, extras?: Partial<Store>) {
    recordConceptualSnapshot(debounceKey)
    recomputeConceptual(next, extras)
    scheduleSaveConceptual()
  }

  function mutateBoth(nextDesign: ERDesign, nextConceptual: ConceptualDesign, extras?: Partial<Store>) {
    const prevDesign = get().design
    const prevConceptual = get().conceptualDesign
    const redo = createPatch(prevDesign, nextDesign)
    const conceptualRedo = createPatch(prevConceptual, nextConceptual)

    lastDebounceKey = null
    lastSnapshotTime = 0
    pendingBaseline = null
    debounceBaseline = null
    lastConceptualDebounceKey = null
    lastConceptualSnapshotTime = 0
    pendingConceptualBaseline = null
    debounceConceptualBaseline = null

    if (redo.length > 0 || conceptualRedo.length > 0) {
      pastStack.push({
        ...(redo.length > 0 ? { undo: invertPatch(redo), redo } : {}),
        ...(conceptualRedo.length > 0
          ? { conceptualUndo: invertPatch(conceptualRedo), conceptualRedo }
          : {}),
      })
      if (pastStack.length > MAX_HISTORY) {
        pastStack.shift()
      }
      futureStack = []
    }

    set({
      design: nextDesign,
      report: validateDesign(nextDesign),
      conceptualDesign: nextConceptual,
      canUndo: pastStack.length > 0,
      canRedo: false,
      ...extras,
    })

    if (redo.length > 0) {
      scheduleSave()
    }
    if (conceptualRedo.length > 0) {
      scheduleSaveConceptual()
    }
  }

  function withEntities(updater: (entities: Entity[]) => Entity[], debounceKey?: string) {
    const { design } = get()
    mutate({ ...design, entities: updater(design.entities) }, debounceKey)
  }

  function mutateChenPositions(
    nextPositions: Record<string, { x: number; y: number }>,
    nextConceptual?: ConceptualDesign,
  ) {
    const prevPositions = structuredClone(get().chenPositions)
    const targetPositions = structuredClone(nextPositions)
    const entry: HistoryEntry = {
      chenPositionsUndo: prevPositions,
      chenPositionsRedo: targetPositions,
    }

    let conceptualChanged = false
    if (nextConceptual !== undefined) {
      const currentConceptual = get().conceptualDesign
      const cRedo = createPatch(currentConceptual, nextConceptual)
      if (cRedo.length > 0) {
        entry.conceptualRedo = cRedo
        entry.conceptualUndo = invertPatch(cRedo)
        conceptualChanged = true
      }
    }

    const posChanged = JSON.stringify(prevPositions) !== JSON.stringify(targetPositions)
    if (!posChanged && !conceptualChanged) {
      return
    }

    lastDebounceKey = null
    lastSnapshotTime = 0
    pendingBaseline = null
    debounceBaseline = null
    lastConceptualDebounceKey = null
    lastConceptualSnapshotTime = 0
    pendingConceptualBaseline = null
    debounceConceptualBaseline = null

    pastStack.push(entry)
    if (pastStack.length > MAX_HISTORY) {
      pastStack.shift()
    }
    futureStack = []

    const project = get().project
    if (project) {
      saveChenPositions(project.id, targetPositions)
    }

    if (conceptualChanged && nextConceptual !== undefined) {
      mutationCount += 1
      set({
        conceptualDesign: nextConceptual,
        chenPositions: targetPositions,
        canUndo: true,
        canRedo: false,
      })
      scheduleSaveConceptual()
    } else {
      set({
        chenPositions: targetPositions,
        canUndo: true,
        canRedo: false,
      })
    }
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
    mutateBoth,
    mutateChenPositions,
    withEntities,

    undo() {
      if (pastStack.length === 0) return
      const entry = pastStack.pop()!
      futureStack.push(entry)

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
        const nextChenPositions =
          entry.chenPositionsUndo !== undefined
            ? structuredClone(entry.chenPositionsUndo)
            : { ...get().chenPositions }
        if (entry.chenPositionsUndo === undefined) {
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
        }
        if (project) {
          saveChenPositions(project.id, nextChenPositions)
        }

        set({
          conceptualDesign: previousConceptual,
          chenPositions: nextChenPositions,
          selection: entry.undo && entry.undo.length > 0 ? get().selection : validSelection ? currentSelection : null,
        })
        scheduleSaveConceptual()
      } else if (entry.chenPositionsUndo !== undefined) {
        const restoredPositions = structuredClone(entry.chenPositionsUndo)
        const project = get().project
        if (project) {
          saveChenPositions(project.id, restoredPositions)
        }
        set({ chenPositions: restoredPositions })
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
        const nextChenPositions =
          entry.chenPositionsRedo !== undefined
            ? structuredClone(entry.chenPositionsRedo)
            : { ...get().chenPositions }
        if (entry.chenPositionsRedo === undefined) {
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
        }
        if (project) {
          saveChenPositions(project.id, nextChenPositions)
        }

        set({
          conceptualDesign: nextConceptual,
          chenPositions: nextChenPositions,
          selection: entry.redo && entry.redo.length > 0 ? get().selection : validSelection ? currentSelection : null,
        })
        scheduleSaveConceptual()
      } else if (entry.chenPositionsRedo !== undefined) {
        const restoredPositions = structuredClone(entry.chenPositionsRedo)
        const project = get().project
        if (project) {
          saveChenPositions(project.id, restoredPositions)
        }
        set({ chenPositions: restoredPositions })
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
      const hadErTimer = saveTimer !== null
      if (saveTimer !== null) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const hadConceptualTimer = saveConceptualTimer !== null
      if (saveConceptualTimer !== null) {
        clearTimeout(saveConceptualTimer)
        saveConceptualTimer = null
      }

      const targetProjectId = get().project?.id
      if (!targetProjectId) {
        return
      }

      // 1. 先等待当前已在途的请求返回，防止切换项目时提前放行丢弃最新编辑
      if (inFlightErPromise) {
        await inFlightErPromise
      }
      if (inFlightConceptualPromise) {
        await inFlightConceptualPromise
      }

      // 清理在途请求收尾阶段可能挂上的重试定时器，改为立即落盘
      if (saveTimer !== null) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      if (saveConceptualTimer !== null) {
        clearTimeout(saveConceptualTimer)
        saveConceptualTimer = null
      }

      if (get().project?.id !== targetProjectId) {
        return
      }

      const tasks: Promise<void>[] = []
      const needErFlush =
        hadErTimer ||
        savePending ||
        dirtyErVersion > savedErVersion ||
        erSaveState === 'error' ||
        erSaveState === 'idle'
      const needConceptualFlush =
        hadConceptualTimer ||
        saveConceptualPending ||
        dirtyConceptualVersion > savedConceptualVersion ||
        conceptualSaveState === 'error'

      if (needErFlush) {
        savePending = false
        tasks.push(flushSave())
      }
      if (needConceptualFlush) {
        saveConceptualPending = false
        tasks.push(flushSaveConceptual())
      }

      if (tasks.length > 0) {
        await Promise.all(tasks)
      }
    },
  }
}
