import type { CanvasViewMode } from '../../types/dsl'
import { chenViewAdapter } from './chenViewAdapter'
import { relationalViewAdapter } from './relationalViewAdapter'
import type { CanvasViewAdapter } from './types'

export type {
  CanvasEmptyStateCopy,
  CanvasLayoutCache,
  CanvasViewActions,
  CanvasViewAdapter,
  CanvasViewContext,
  FlowProjectionResult,
} from './types'

const VIEW_ADAPTER_REGISTRY = new Map<CanvasViewMode, CanvasViewAdapter>([
  [chenViewAdapter.mode, chenViewAdapter],
  [relationalViewAdapter.mode, relationalViewAdapter],
])

export function registerCanvasViewAdapter(adapter: CanvasViewAdapter): void {
  VIEW_ADAPTER_REGISTRY.set(adapter.mode, adapter)
}

export function getCanvasViewAdapter(mode: CanvasViewMode): CanvasViewAdapter {
  return VIEW_ADAPTER_REGISTRY.get(mode) ?? relationalViewAdapter
}

export function listCanvasViewAdapters(): CanvasViewAdapter[] {
  return Array.from(VIEW_ADAPTER_REGISTRY.values())
}
