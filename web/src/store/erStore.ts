import { create } from 'zustand'

import { createAiChatSlice } from './slices/aiChatSlice'
import { createConceptualSlice } from './slices/conceptualSlice'
import { createErDesignSlice } from './slices/erDesignSlice'
import { createHistorySlice } from './slices/historySlice'
import { createProjectSlice } from './slices/projectSlice'
import { createUiSlice } from './slices/uiSlice'
import type { Store } from './types'

export const useStore = create<Store>()((...a) => ({
  ...createHistorySlice(...a),
  ...createProjectSlice(...a),
  ...createErDesignSlice(...a),
  ...createConceptualSlice(...a),
  ...createAiChatSlice(...a),
  ...createUiSlice(...a),
}))
