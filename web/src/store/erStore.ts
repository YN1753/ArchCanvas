import { create } from 'zustand'

import { createAiChatSlice } from './slices/aiChatSlice'
import { createConceptualSlice } from './slices/conceptualSlice'
import { createErDesignSlice } from './slices/erDesignSlice'
import { createHistorySlice } from './slices/historySlice'
import { createProjectSlice } from './slices/projectSlice'
import { createUiSlice } from './slices/uiSlice'
import type { Store } from './types'
import type { Cardinality, Entity, ERDesign, Relation } from '../types/dsl'

export const useStore = create<Store>()((...a) => ({
  ...createHistorySlice(...a),
  ...createProjectSlice(...a),
  ...createErDesignSlice(...a),
  ...createConceptualSlice(...a),
  ...createAiChatSlice(...a),
  ...createUiSlice(...a),
}))

/** 组件里常用的便捷选择器：返回当前选中的实体 */
export function useSelectedEntity(): Entity | null {
  return useStore((state) => {
    if (state.selection?.kind !== 'entity') {
      return null
    }
    return state.design.entities.find((entity) => entity.id === state.selection!.id) ?? null
  })
}

/** 组件里常用的便捷选择器：返回当前选中的关联 */
export function useSelectedRelation(): Relation | null {
  return useStore((state) => {
    if (state.selection?.kind !== 'relation') {
      return null
    }
    return state.design.relations.find((relation) => relation.id === state.selection!.id) ?? null
  })
}

// 导出所有状态类型，保持全站向后兼容性
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
