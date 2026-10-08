import type { StateCreator } from 'zustand'

import type { CanvasViewMode } from '../../types/dsl'
import type { DataDialogTab, Selection, Store, UiSlice } from '../types'

export const createUiSlice: StateCreator<Store, [], [], UiSlice> = (set, get) => ({
  selection: null,
  hoveredEntityId: null,
  hoveredRelationId: null,
  focusedEntityId: null,
  toast: null,

  canvasViewMode: 'chen',
  dslView: 'canvas',
  inspectorOpen: false,
  dataDialogOpen: false,
  dataDialogTab: 'export-sql',

  select(selection: Selection) {
    set({
      selection,
      inspectorOpen: selection !== null,
    })
  },

  focusEntity(idOrName: string) {
    const { design } = get()
    const target = design.entities.find(
      (e) => e.id === idOrName || e.name.toLowerCase() === idOrName.toLowerCase(),
    )
    if (!target) return
    set({
      selection: { kind: 'entity', id: target.id },
      focusedEntityId: target.id,
      inspectorOpen: true,
    })
    window.setTimeout(() => {
      if (get().focusedEntityId === target.id) {
        set({ focusedEntityId: null })
      }
    }, 1800)
  },

  setHoveredEntityId(id: string | null) {
    set({ hoveredEntityId: id })
  },

  setHoveredRelationId(id: string | null) {
    set({ hoveredRelationId: id })
  },

  setInspectorOpen(open: boolean) {
    set({ inspectorOpen: open })
  },

  toggleInspector() {
    set((state) => ({ inspectorOpen: !state.inspectorOpen }))
  },

  openDataDialog(tab: DataDialogTab = 'export-sql') {
    set({ dataDialogOpen: true, dataDialogTab: tab })
  },

  closeDataDialog() {
    set({ dataDialogOpen: false })
  },

  dismissToast() {
    set({ toast: null })
  },

  showToast(text: string, kind: 'info' | 'error' = 'info') {
    set({ toast: { kind, text } })
  },

  setCanvasViewMode(mode: CanvasViewMode) {
    set({ canvasViewMode: mode })
  },

  setDslView(view: 'canvas' | 'code') {
    set({ dslView: view })
  },
})
