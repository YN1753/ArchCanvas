import type {
  AvailableModelsResponse,
  ERDesignAnalysisResult,
  GetModelsParams,
  ModelItem,
  Project,
  ProjectMessage,
  ProviderInfo,
  SaveModelParams,
} from '../api/client'
import type {
  Attribute,
  BusinessConcept,
  CanvasViewMode,
  ConceptAttribute,
  ConceptCardinality,
  ConceptRelation,
  ConceptualDesign,
  DatabaseDialect,
  Entity,
  ERDesign,
  Position,
  Relation,
  SchemaReviewReport,
} from '../types/dsl'
import type { ValidationReport } from '../validate/dsl'

export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'relation'; id: string }
  | null

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface Toast {
  kind: 'info' | 'error'
  text: string
}

export type DataDialogTab =
  | 'export-sql'
  | 'export-json'
  | 'export-mermaid'
  | 'export-image'
  | 'import-sql'
  | 'import-json'

// 1. History & Persistence Slice
export interface HistorySlice {
  saveState: SaveState
  saveError: string | null
  canUndo: boolean
  canRedo: boolean
  serverWarnings: string[]

  undo: () => void
  redo: () => void
  saveNow: () => Promise<void>

  // 内部状态同步与快照动作
  recompute: (design: ERDesign, extras?: Partial<Store>) => void
  scheduleSave: () => void
  flushSave: () => Promise<void>
  scheduleSaveConceptual: () => void
  flushSaveConceptual: () => Promise<void>
  recordSnapshot: (debounceKey?: string) => void
  resetHistory: () => void
  mutate: (next: ERDesign, debounceKey?: string) => void
  mutateConceptual: (next: ConceptualDesign, debounceKey?: string, extras?: Partial<Store>) => void
  withEntities: (updater: (entities: Entity[]) => Entity[], debounceKey?: string) => void
}

// 2. Project & Model Slice
export interface ProjectSlice {
  ready: boolean
  bootError: string | null
  projects: Project[]
  project: Project | null

  models: ModelItem[]
  providers: ProviderInfo[]
  selectedModel: { provider: string; model: string; base_url?: string } | null
  modelsLoading: boolean
  modelsError: string | null

  bootstrap: () => Promise<void>
  selectProject: (id: string) => Promise<void>
  createProject: (name: string, description?: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  updateProject: (id: string, name: string, description?: string) => Promise<void>

  fetchModels: (params?: GetModelsParams) => Promise<AvailableModelsResponse | null>
  selectModel: (provider: string, model: string, base_url?: string) => void
  saveAndSwitchModel: (params: SaveModelParams) => Promise<boolean>
}

// 3. ER Design (Physical) Slice
export interface ErDesignSlice {
  design: ERDesign
  report: ValidationReport

  moveEntity: (id: string, position: { x: number; y: number }) => void
  moveEntities: (moves: Array<{ id: string; position: { x: number; y: number } }>) => void
  addEntity: (position?: { x: number; y: number }) => void
  renameEntity: (id: string, name: string) => void
  updateEntity: (id: string, patch: Partial<Entity>) => void
  deleteEntity: (id: string) => void

  addAttribute: (entityID: string) => void
  updateAttribute: (entityID: string, attributeID: string, patch: Partial<Attribute>) => void
  deleteAttribute: (entityID: string, attributeID: string) => void
  moveAttribute: (entityID: string, attributeID: string, direction: -1 | 1) => void

  addRelation: (sourceEntityID: string, targetEntityID: string) => void
  updateRelation: (id: string, patch: Partial<Relation>) => void
  deleteRelation: (id: string) => void

  autoLayout: () => void
  importDesign: (design: ERDesign) => void
}

// 4. Conceptual Design (Chen ER) Slice
export interface ConceptualSlice {
  conceptualDesign: ConceptualDesign
  chenPositions: Record<string, Position>

  updateChenPositions: (moves: Array<{ id: string; position: { x: number; y: number } }>) => void
  resetChenPositions: () => void
  saveConceptualDesign: (design: ConceptualDesign) => Promise<void>

  addConcept: (position?: { x: number; y: number }) => void
  updateConcept: (id: string, patch: Partial<BusinessConcept>) => void
  deleteConcept: (id: string) => void

  addConceptAttribute: (conceptID: string) => void
  updateConceptAttribute: (conceptID: string, attributeID: string, patch: Partial<ConceptAttribute>) => void
  deleteConceptAttribute: (conceptID: string, attributeID: string) => void
  moveConceptAttribute: (conceptID: string, attributeID: string, direction: -1 | 1) => void

  addConceptRelation: (sourceID: string, targetID: string, cardinality?: ConceptCardinality) => void
  updateConceptRelation: (relationID: string, patch: Partial<ConceptRelation>) => void
  deleteConceptRelation: (relationID: string) => void
}

// 5. AI Chat & Multi-Stage Architecture Slice
export interface AiChatSlice {
  aiRunning: boolean
  aiThinking: string
  aiStatus: string
  aiError: string | null
  aiResult: ERDesignAnalysisResult | null

  messages: ProjectMessage[]
  messagesLoading: boolean
  aiSidebarOpen: boolean

  agentPhase: 'idle' | 'concept_ready' | 'deriving_physical' | 'physical_ready' | 'reviewing'
  targetDialect: DatabaseDialect
  reviewReport: SchemaReviewReport | null
  reviewDrawerOpen: boolean

  setAiSidebarOpen: (open: boolean) => void
  toggleAiSidebar: () => void
  fetchProjectMessages: (projectId: string) => Promise<void>
  clearProjectMessages: () => Promise<void>

  setAgentPhase: (phase: 'idle' | 'concept_ready' | 'deriving_physical' | 'physical_ready' | 'reviewing') => void
  setTargetDialect: (dialect: DatabaseDialect) => void
  setReviewDrawerOpen: (open: boolean) => void
  setReviewReport: (report: SchemaReviewReport | null) => void

  runAI: (input: string) => Promise<void>
  proposeConcepts: (input: string) => Promise<void>
  derivePhysical: (dialect?: DatabaseDialect) => Promise<void>
  reviewSchema: (dialect?: DatabaseDialect) => Promise<void>
  dismissAiResult: () => void
}

// 6. UI & Selection Slice
export interface UiSlice {
  selection: Selection
  hoveredEntityId: string | null
  hoveredRelationId: string | null
  focusedEntityId: string | null
  toast: Toast | null

  canvasViewMode: CanvasViewMode
  dslView: 'canvas' | 'code'
  inspectorOpen: boolean
  dataDialogOpen: boolean
  dataDialogTab: DataDialogTab

  select: (selection: Selection) => void
  focusEntity: (idOrName: string) => void
  setHoveredEntityId: (id: string | null) => void
  setHoveredRelationId: (id: string | null) => void
  setInspectorOpen: (open: boolean) => void
  toggleInspector: () => void
  openDataDialog: (tab?: DataDialogTab) => void
  closeDataDialog: () => void
  dismissToast: () => void

  setCanvasViewMode: (mode: CanvasViewMode) => void
  setDslView: (view: 'canvas' | 'code') => void
}

export type Store = HistorySlice &
  ProjectSlice &
  ErDesignSlice &
  ConceptualSlice &
  AiChatSlice &
  UiSlice
