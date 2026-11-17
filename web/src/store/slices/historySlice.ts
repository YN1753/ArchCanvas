import type { StateCreator } from 'zustand'

import { api, type SaveERDesignResult } from '../../api/client'
import { normalizeConceptualDesign } from '../../domain/conceptNormalize'
import { ensureLayout } from '../../flow/layout'
import type { ConceptualDesign, Entity, ERDesign, Position } from '../../types/dsl'
import { validateDesign } from '../../validate/dsl'
import {
  applyPatch,
  createPatch,
  invertPatch,
  type DomainPatchPair,
  type HistoryDomainKey,
  type HistoryEntry,
} from '../patch'
import type { HistorySlice, SaveState, Store } from '../types'
import { errorMessage, saveChenPositions } from '../utils'

const SAVE_DEBOUNCE_MS = 700
const HISTORY_DEBOUNCE_MS = 600
const MAX_HISTORY = 50

interface DomainPatchTracker<T> {
  lastSnapshotTime: number
  lastDebounceKey: string | null
  pendingBaseline: T | null
  debounceBaseline: T | null
}

function createPatchTracker<T>(): DomainPatchTracker<T> {
  return {
    lastSnapshotTime: 0,
    lastDebounceKey: null,
    pendingBaseline: null,
    debounceBaseline: null,
  }
}

function resetPatchTracker<T>(tracker: DomainPatchTracker<T>): void {
  tracker.lastSnapshotTime = 0
  tracker.lastDebounceKey = null
  tracker.pendingBaseline = null
  tracker.debounceBaseline = null
}

function captureSnapshot<T>(
  tracker: DomainPatchTracker<T>,
  current: T,
  debounceKey?: string,
): void {
  const now = Date.now()
  if (
    debounceKey &&
    tracker.lastDebounceKey === debounceKey &&
    now - tracker.lastSnapshotTime < HISTORY_DEBOUNCE_MS
  ) {
    tracker.lastSnapshotTime = now
    tracker.pendingBaseline = tracker.debounceBaseline ?? current
    return
  }

  tracker.lastSnapshotTime = now
  tracker.lastDebounceKey = debounceKey ?? null
  tracker.pendingBaseline = current
  tracker.debounceBaseline = current
}

function buildDomainPair<T>(before: T, after: T): DomainPatchPair | null {
  const redo = createPatch(before, after)
  if (redo.length === 0) return null
  return {
    undo: invertPatch(redo),
    redo,
  }
}

function recordDomainPatch<T>(params: {
  domainKey: HistoryDomainKey
  tracker: DomainPatchTracker<T>
  nextValue: T
  pastStack: HistoryEntry[]
  futureStack: HistoryEntry[]
  onStackStateChange: (canUndo: boolean, canRedo: boolean) => void
}): void {
  const { domainKey, tracker, nextValue, pastStack, futureStack, onStackStateChange } = params

  if (tracker.pendingBaseline === null || tracker.pendingBaseline === nextValue) {
    return
  }

  const baseline = tracker.pendingBaseline
  tracker.pendingBaseline = null

  const now = Date.now()
  const topEntry = pastStack[pastStack.length - 1]
  const isDebouncing =
    tracker.lastDebounceKey !== null &&
    topEntry !== undefined &&
    topEntry.debounceKey === tracker.lastDebounceKey &&
    topEntry.patches[domainKey] !== undefined &&
    tracker.debounceBaseline !== null &&
    now - tracker.lastSnapshotTime < HISTORY_DEBOUNCE_MS

  if (isDebouncing) {
    const pair = buildDomainPair(tracker.debounceBaseline, nextValue)
    if (pair) {
      pastStack[pastStack.length - 1] = {
        patches: { ...topEntry.patches, [domainKey]: pair },
        debounceKey: tracker.lastDebounceKey ?? undefined,
      }
    } else {
      const remainingPatches = { ...topEntry.patches }
      delete remainingPatches[domainKey]
      if (Object.keys(remainingPatches).length > 0) {
        pastStack[pastStack.length - 1] = {
          patches: remainingPatches,
          debounceKey: topEntry.debounceKey,
        }
      } else {
        pastStack.pop()
      }
      tracker.lastDebounceKey = null
      tracker.debounceBaseline = null
      onStackStateChange(pastStack.length > 0, futureStack.length > 0)
    }
    return
  }

  const pair = buildDomainPair(baseline, nextValue)
  if (pair) {
    pastStack.push({
      patches: { [domainKey]: pair },
      debounceKey: tracker.lastDebounceKey ?? undefined,
    })
    if (pastStack.length > MAX_HISTORY) {
      pastStack.shift()
    }
    futureStack.length = 0
    onStackStateChange(true, false)
  }
}

interface HistoryDomainDescriptor<T = unknown> {
  readonly key: HistoryDomainKey
  readonly tracker: DomainPatchTracker<T>
  getSnapshot(): T
  applySnapshot(snapshot: T, entry: HistoryEntry): void
  scheduleSave(): void
}

interface DebouncedSaver {
  readonly state: SaveState
  readonly error: string | null
  schedule: () => void
  flush: () => Promise<void>
  cancelTimer: () => boolean
  waitForInFlight: () => Promise<void>
  needsFlush: (hadTimer: boolean, flushOnIdle: boolean) => boolean
  reset: () => void
}

function createDebouncedSaver<TResult>(config: {
  get: () => Store
  getMutationCount: () => number
  onStateChange: (extras?: Partial<Store>) => void
  saveOnTemplateForkedDirectly?: boolean
  performSave: (projectId: string) => Promise<TResult>
  onSuccess?: (result: TResult, changedDuringRequest: boolean) => void
}): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  let inFlightPromise: Promise<void> | null = null
  let dirtyVersion = 0
  let savedVersion = 0
  let saveState: SaveState = 'idle'
  let saveError: string | null = null

  function startTimer() {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, SAVE_DEBOUNCE_MS)
  }

  async function flush(): Promise<void> {
    let { project } = config.get()
    if (!project) return

    if (project.is_template) {
      const forkedId = await config.get().ensureWritableProject()
      if (!forkedId) return
      if (config.saveOnTemplateForkedDirectly) {
        savedVersion = dirtyVersion
        saveState = 'saved'
        saveError = null
        config.onStateChange()
        return
      }
      project = config.get().project
      if (!project) return
    }

    const targetProjectId = project.id
    if (inFlightPromise) {
      pending = true
      return
    }

    const countAtStart = config.getMutationCount()
    const versionAtStart = dirtyVersion
    saveState = 'saving'
    saveError = null
    config.onStateChange()

    const run = (async () => {
      try {
        const result = await config.performSave(targetProjectId)
        if (config.get().project?.id !== targetProjectId) {
          return
        }
        savedVersion = Math.max(savedVersion, versionAtStart)
        const changedDuringRequest = config.getMutationCount() !== countAtStart
        saveState = 'saved'
        saveError = null
        if (config.onSuccess) {
          config.onSuccess(result, changedDuringRequest)
        } else {
          config.onStateChange()
        }
      } catch (err) {
        if (config.get().project?.id === targetProjectId) {
          saveState = 'error'
          saveError = errorMessage(err)
          config.onStateChange()
        }
      } finally {
        inFlightPromise = null
        if (pending && config.get().project?.id === targetProjectId) {
          pending = false
          startTimer()
        } else {
          pending = false
        }
      }
    })()

    inFlightPromise = run
    return run
  }

  return {
    get state() {
      return saveState
    },
    get error() {
      return saveError
    },
    schedule() {
      dirtyVersion += 1
      startTimer()
    },
    flush,
    cancelTimer() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
        return true
      }
      return false
    },
    async waitForInFlight() {
      if (inFlightPromise) {
        await inFlightPromise
      }
    },
    needsFlush(hadTimer: boolean, flushOnIdle: boolean) {
      const shouldFlush =
        hadTimer ||
        pending ||
        dirtyVersion > savedVersion ||
        saveState === 'error' ||
        (flushOnIdle && saveState === 'idle')
      if (shouldFlush) {
        pending = false
      }
      return shouldFlush
    },
    reset() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      inFlightPromise = null
      pending = false
      dirtyVersion = 0
      savedVersion = 0
      saveState = 'idle'
      saveError = null
    },
  }
}

export const createHistorySlice: StateCreator<Store, [], [], HistorySlice> = (set, get) => {
  let mutationCount = 0
  let pastStack: HistoryEntry[] = []
  let futureStack: HistoryEntry[] = []

  const erTracker = createPatchTracker<ERDesign>()
  const conceptualTracker = createPatchTracker<ConceptualDesign>()
  const chenPositionsTracker = createPatchTracker<Record<string, Position>>()

  const erSaver: DebouncedSaver = createDebouncedSaver<SaveERDesignResult>({
    get,
    getMutationCount: () => mutationCount,
    onStateChange: syncCombinedSaveState,
    saveOnTemplateForkedDirectly: true,
    performSave: (projectId) => api.saveERDesign(projectId, get().design),
    onSuccess: (result, changedDuringRequest) => {
      syncCombinedSaveState({ serverWarnings: result.warnings ?? [] })
      if (changedDuringRequest) return

      const localEntities = get().design.entities
      const localRelations = get().design.relations
      const currentPositions = new Map(localEntities.map((e) => [e.id, e.position]))
      const posByName = new Map(localEntities.map((e) => [e.name.toLowerCase(), e.position]))
      const mergedEntities = result.design.entities.map((e) => ({
        ...e,
        position:
          e.position ?? currentPositions.get(e.id) ?? posByName.get(e.name.toLowerCase()),
      }))

      const entityIdByLowerName = new Map(
        mergedEntities.map((e) => [e.name.toLowerCase(), e.id]),
      )
      const oldEntityNameById = new Map(
        localEntities.map((e) => [e.id, e.name.toLowerCase()]),
      )

      const currentSel = get().selection
      let nextSelection = currentSel
      if (currentSel?.kind === 'entity') {
        if (!mergedEntities.some((e) => e.id === currentSel.id)) {
          const oldName = oldEntityNameById.get(currentSel.id)
          const mappedId = oldName ? entityIdByLowerName.get(oldName) : undefined
          if (mappedId) {
            nextSelection = { kind: 'entity', id: mappedId }
          }
        }
      } else if (currentSel?.kind === 'relation') {
        if (!result.design.relations.some((r) => r.id === currentSel.id)) {
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
    },
  })

  const conceptualSaver: DebouncedSaver = createDebouncedSaver<string>({
    get,
    getMutationCount: () => mutationCount,
    onStateChange: syncCombinedSaveState,
    performSave: (projectId) => api.saveConceptualDesign(projectId, get().conceptualDesign),
  })

  function syncCombinedSaveState(extras?: Partial<Store>) {
    let combinedState: SaveState = 'idle'
    let combinedError: string | null = null
    if (erSaver.state === 'saving' || conceptualSaver.state === 'saving') {
      combinedState = 'saving'
    } else if (erSaver.state === 'error' || conceptualSaver.state === 'error') {
      combinedState = 'error'
      combinedError = erSaver.error ?? conceptualSaver.error
    } else if (erSaver.state === 'saved' || conceptualSaver.state === 'saved') {
      combinedState = 'saved'
    }
    set({
      saveState: combinedState,
      saveError: combinedError,
      ...extras,
    })
  }

  function scheduleSave() {
    mutationCount += 1
    erSaver.schedule()
  }

  function scheduleSaveConceptual() {
    mutationCount += 1
    conceptualSaver.schedule()
  }

  function recompute(design: ERDesign, extras?: Partial<Store>) {
    recordDomainPatch({
      domainKey: 'erDesign',
      tracker: erTracker,
      nextValue: design,
      pastStack,
      futureStack,
      onStackStateChange: (canUndo, canRedo) => set({ canUndo, canRedo }),
    })

    set({
      design,
      report: validateDesign(design),
      ...extras,
    })
  }

  function recomputeConceptual(conceptualDesign: ConceptualDesign, extras?: Partial<Store>) {
    recordDomainPatch({
      domainKey: 'conceptualDesign',
      tracker: conceptualTracker,
      nextValue: conceptualDesign,
      pastStack,
      futureStack,
      onStackStateChange: (canUndo, canRedo) => set({ canUndo, canRedo }),
    })

    set({
      conceptualDesign,
      ...extras,
    })
  }

  /**
   * 声明式多领域历史描述符表（OCP 扩展点：新增可撤销领域无需改动 `stepHistory` 主循环）
   */
  const domainDescriptors: readonly HistoryDomainDescriptor[] = [
    {
      key: 'conceptualDesign',
      tracker: conceptualTracker,
      getSnapshot: () => get().conceptualDesign,
      applySnapshot: (rawSnapshot, entry) => {
        const updatedConceptual = normalizeConceptualDesign(rawSnapshot as ConceptualDesign)
        const currentSelection = get().selection
        let validSelection = false
        if (currentSelection?.kind === 'entity') {
          validSelection = updatedConceptual.concepts.some(
            (c) => c.id === currentSelection.id || c.name === currentSelection.id,
          )
        } else if (currentSelection?.kind === 'relation') {
          validSelection = updatedConceptual.relations.some(
            (r) => r.id === currentSelection.id,
          )
        }

        const hasExplicitChenPositionsPatch = entry.patches.chenPositions !== undefined
        const nextChenPositions = { ...get().chenPositions }
        if (!hasExplicitChenPositionsPatch) {
          for (const c of updatedConceptual.concepts) {
            if (c.position && c.id) {
              nextChenPositions[c.id] = c.position
            }
          }
          for (const r of updatedConceptual.relations) {
            if (r.position && r.id) {
              nextChenPositions[r.id] = r.position
              nextChenPositions[`rel-${r.id}`] = r.position
            }
          }
          const project = get().project
          if (project) {
            saveChenPositions(project.id, nextChenPositions)
          }
        }

        set({
          conceptualDesign: updatedConceptual,
          ...(!hasExplicitChenPositionsPatch ? { chenPositions: nextChenPositions } : {}),
          selection:
            entry.patches.erDesign !== undefined
              ? get().selection
              : validSelection
                ? currentSelection
                : null,
        })
      },
      scheduleSave: scheduleSaveConceptual,
    } satisfies HistoryDomainDescriptor<ConceptualDesign> as HistoryDomainDescriptor,
    {
      key: 'chenPositions',
      tracker: chenPositionsTracker,
      getSnapshot: () => get().chenPositions,
      applySnapshot: (rawSnapshot) => {
        const restoredPositions = structuredClone(rawSnapshot as Record<string, Position>)
        const project = get().project
        if (project) {
          saveChenPositions(project.id, restoredPositions)
        }
        set({ chenPositions: restoredPositions })
      },
      scheduleSave: () => {},
    } satisfies HistoryDomainDescriptor<Record<string, Position>> as HistoryDomainDescriptor,
    {
      key: 'erDesign',
      tracker: erTracker,
      getSnapshot: () => get().design,
      applySnapshot: (rawSnapshot) => {
        const updatedEr = rawSnapshot as ERDesign
        const currentSelection = get().selection
        const validEntity =
          currentSelection?.kind === 'entity' &&
          updatedEr.entities.some((e) => e.id === currentSelection.id)
        const validRelation =
          currentSelection?.kind === 'relation' &&
          updatedEr.relations.some((r) => r.id === currentSelection.id)

        recompute(updatedEr, {
          selection: validEntity || validRelation ? currentSelection : null,
        })
      },
      scheduleSave,
    } satisfies HistoryDomainDescriptor<ERDesign> as HistoryDomainDescriptor,
  ]

  function recordSnapshot(debounceKey?: string) {
    captureSnapshot(erTracker, get().design, debounceKey)
  }

  function recordConceptualSnapshot(debounceKey?: string) {
    captureSnapshot(conceptualTracker, get().conceptualDesign, debounceKey)
  }

  function resetHistory() {
    erSaver.reset()
    conceptualSaver.reset()
    pastStack = []
    futureStack = []
    for (const descriptor of domainDescriptors) {
      resetPatchTracker(descriptor.tracker)
    }
    set({
      saveState: 'idle',
      saveError: null,
      canUndo: false,
      canRedo: false,
    })
  }

  function pushMultiDomainEntry(patches: Partial<Record<HistoryDomainKey, DomainPatchPair>>): boolean {
    if (Object.keys(patches).length === 0) {
      return false
    }
    for (const descriptor of domainDescriptors) {
      resetPatchTracker(descriptor.tracker)
    }
    pastStack.push({ patches })
    if (pastStack.length > MAX_HISTORY) {
      pastStack.shift()
    }
    futureStack = []
    return true
  }

  function mutate(next: ERDesign, debounceKey?: string, extras?: Partial<Store>) {
    recordSnapshot(debounceKey)
    recompute(next, extras)
    scheduleSave()
  }

  function mutateConceptual(
    rawNext: ConceptualDesign,
    debounceKey?: string,
    extras?: Partial<Store>,
  ) {
    const next = normalizeConceptualDesign(rawNext)
    recordConceptualSnapshot(debounceKey)
    recomputeConceptual(next, extras)
    scheduleSaveConceptual()
  }

  function mutateBoth(
    nextDesign: ERDesign,
    rawNextConceptual: ConceptualDesign,
    extras?: Partial<Store>,
  ) {
    const nextConceptual = normalizeConceptualDesign(rawNextConceptual)
    const erPair = buildDomainPair(get().design, nextDesign)
    const conceptualPair = buildDomainPair(get().conceptualDesign, nextConceptual)

    const patches: Partial<Record<HistoryDomainKey, DomainPatchPair>> = {
      ...(erPair ? { erDesign: erPair } : {}),
      ...(conceptualPair ? { conceptualDesign: conceptualPair } : {}),
    }
    pushMultiDomainEntry(patches)

    set({
      design: nextDesign,
      report: validateDesign(nextDesign),
      conceptualDesign: nextConceptual,
      canUndo: pastStack.length > 0,
      canRedo: futureStack.length > 0,
      ...extras,
    })

    if (erPair) {
      scheduleSave()
    }
    if (conceptualPair) {
      scheduleSaveConceptual()
    }
  }

  function withEntities(updater: (entities: Entity[]) => Entity[], debounceKey?: string) {
    const { design } = get()
    mutate({ ...design, entities: updater(design.entities) }, debounceKey)
  }

  function mutateChenPositions(
    nextPositions: Record<string, Position>,
    rawNextConceptual?: ConceptualDesign,
  ) {
    const nextConceptual =
      rawNextConceptual !== undefined ? normalizeConceptualDesign(rawNextConceptual) : undefined
    const targetPositions = structuredClone(nextPositions)

    const posPair = buildDomainPair(get().chenPositions, targetPositions)
    const conceptualPair =
      nextConceptual !== undefined
        ? buildDomainPair(get().conceptualDesign, nextConceptual)
        : null

    const recorded = pushMultiDomainEntry({
      ...(posPair ? { chenPositions: posPair } : {}),
      ...(conceptualPair ? { conceptualDesign: conceptualPair } : {}),
    })
    if (!recorded) {
      return
    }

    const project = get().project
    if (project) {
      saveChenPositions(project.id, targetPositions)
    }

    if (conceptualPair && nextConceptual !== undefined) {
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

  /**
   * 统一参数化历史栈步进引擎：遍历注册领域描述符自动回放/前移补丁，零硬编码领域分支。
   */
  function stepHistory(direction: 'undo' | 'redo') {
    const sourceStack = direction === 'undo' ? pastStack : futureStack
    const destStack = direction === 'undo' ? futureStack : pastStack
    if (sourceStack.length === 0) return

    const entry = sourceStack.pop()!
    destStack.push(entry)

    for (const descriptor of domainDescriptors) {
      const pair = entry.patches[descriptor.key]
      const patchList = pair ? (direction === 'undo' ? pair.undo : pair.redo) : undefined
      if (!patchList || patchList.length === 0) continue

      resetPatchTracker(descriptor.tracker)
      const nextSnapshot = applyPatch(descriptor.getSnapshot(), patchList)
      descriptor.applySnapshot(nextSnapshot, entry)
      descriptor.scheduleSave()
    }

    set({
      canUndo: pastStack.length > 0,
      canRedo: futureStack.length > 0,
    })
  }

  return {
    saveState: 'idle',
    saveError: null,
    canUndo: false,
    canRedo: false,
    serverWarnings: [],

    recompute,
    scheduleSave,
    flushSave: () => erSaver.flush(),
    scheduleSaveConceptual,
    flushSaveConceptual: () => conceptualSaver.flush(),
    recordSnapshot,
    resetHistory,
    mutate,
    mutateConceptual,
    mutateBoth,
    mutateChenPositions,
    withEntities,

    undo() {
      stepHistory('undo')
    },

    redo() {
      stepHistory('redo')
    },

    async saveNow() {
      const hadErTimer = erSaver.cancelTimer()
      const hadConceptualTimer = conceptualSaver.cancelTimer()

      const targetProjectId = get().project?.id
      if (!targetProjectId) {
        return
      }

      await erSaver.waitForInFlight()
      await conceptualSaver.waitForInFlight()

      erSaver.cancelTimer()
      conceptualSaver.cancelTimer()

      if (get().project?.id !== targetProjectId) {
        return
      }

      const tasks: Promise<void>[] = []
      if (erSaver.needsFlush(hadErTimer, true)) {
        tasks.push(erSaver.flush())
      }
      if (conceptualSaver.needsFlush(hadConceptualTimer, false)) {
        tasks.push(conceptualSaver.flush())
      }

      if (tasks.length > 0) {
        await Promise.all(tasks)
      }
    },
  }
}
