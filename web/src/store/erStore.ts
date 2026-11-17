import { create } from 'zustand'

import { createAiChatSlice } from './slices/aiChatSlice'
import { createConceptualSlice } from './slices/conceptualSlice'
import { createErDesignSlice } from './slices/erDesignSlice'
import { createHistorySlice } from './slices/historySlice'
import { createProjectSlice } from './slices/projectSlice'
import { createUiSlice } from './slices/uiSlice'
import type { Store } from './types'
import type { Cardinality, ERDesign } from '../types/dsl'

export const useStore = create<Store>()((...a) => ({
  ...createHistorySlice(...a),
  ...createProjectSlice(...a),
  ...createErDesignSlice(...a),
  ...createConceptualSlice(...a),
  ...createAiChatSlice(...a),
  ...createUiSlice(...a),
}))

export type {
  AiChatSlice,
  ConceptualSlice,
  DataDialogTab,
  ErDesignSlice,
  HistorySlice,
  ProjectSlice,
  SaveState,
  Selection,
  Store,
  Toast,
  UiSlice,
} from './types'

export type { Cardinality, ERDesign }
