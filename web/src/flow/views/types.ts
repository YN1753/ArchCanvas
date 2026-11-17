import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'

import type { Selection } from '../../store/types'
import type {
  CanvasViewMode,
  ConceptCardinality,
  ConceptualDesign,
  ERDesign,
  Position,
} from '../../types/dsl'

export type AgentPhase =
  | 'idle'
  | 'concept_ready'
  | 'deriving_physical'
  | 'physical_ready'
  | 'reviewing'

export interface CanvasViewContext {
  design: ERDesign
  conceptualDesign: ConceptualDesign
  agentPhase: AgentPhase
  selection: Selection
  chenPositions: Record<string, Position>
}

export interface CanvasLayoutCache {
  topologyKey: string
  positions: Record<string, Position>
}

export interface CanvasViewActions {
  addEntity: (position?: Position) => string
  moveEntities: (moves: Array<{ id: string; position: Position }>) => void
  deleteEntity: (id: string) => void
  deleteAttribute: (entityID: string, attributeID: string) => void
  addRelation: (sourceEntityID: string, targetEntityID: string) => void
  deleteRelation: (id: string) => void
  autoLayout: () => void

  addConcept: (position?: Position) => void
  deleteConcept: (id: string) => void
  deleteConceptAttribute: (conceptID: string, attributeID: string) => void
  addConceptRelation: (
    sourceID: string,
    targetID: string,
    cardinality?: ConceptCardinality,
  ) => void
  deleteConceptRelation: (relationID: string) => void
  updateChenPositions: (moves: Array<{ id: string; position: Position }>) => void
  resetChenPositions: () => void
}

export interface CanvasEmptyStateCopy {
  readonly title: string
  readonly subtitle: string
  readonly createTitle: string
  readonly createSubtitle: string
}

export interface FlowProjectionResult {
  nodes: Node[]
  edges: Edge[]
}

export interface CanvasViewAdapter {
  readonly mode: CanvasViewMode
  readonly badgeLabel: string
  readonly exportSuffix: string
  readonly emptyState: CanvasEmptyStateCopy

  hasContent(ctx: CanvasViewContext): boolean
  computeTopologyKey(ctx: CanvasViewContext): string
  projectToFlow(
    ctx: CanvasViewContext,
    cacheRef: { current: CanvasLayoutCache | null },
  ): FlowProjectionResult
  syncSelection(nodes: Node[], edges: Edge[], selection: Selection): FlowProjectionResult
  prepareInitialMount(ctx: CanvasViewContext, actions: CanvasViewActions): void
  createPrimaryElement(
    ctx: CanvasViewContext,
    actions: CanvasViewActions,
    position?: Position,
  ): void
  processNodeChanges(
    changes: NodeChange[],
    currentNodes: Node[],
    ctx: CanvasViewContext,
    actions: CanvasViewActions,
  ): NodeChange[]
  processEdgeChanges(
    changes: EdgeChange[],
    currentNodes: Node[],
    currentEdges: Edge[],
    ctx: CanvasViewContext,
    actions: CanvasViewActions,
  ): void
  applyNodePositionChanges(draggedNodes: Node[], actions: CanvasViewActions): void
  handleConnect(
    connection: Connection,
    ctx: CanvasViewContext,
    actions: CanvasViewActions,
  ): void
  resolveSelection(
    target: { kind: 'node'; node: Node } | { kind: 'edge'; edge: Edge },
    ctx: CanvasViewContext,
  ): Selection | undefined
  runAutoLayout(
    getLatestCtx: () => CanvasViewContext,
    actions: CanvasViewActions,
    cacheRef: { current: CanvasLayoutCache | null },
  ): FlowProjectionResult | null
}

export function snapPositionToGrid(pos: Position, grid = 20): Position {
  return {
    x: Math.round(pos.x / grid) * grid,
    y: Math.round(pos.y / grid) * grid,
  }
}
