import type { ChenEdgeType } from '../components/chen/ChenEdge'
import { detectJunctionTable, UNIFIED_AUDIT_COLUMNS as TECHNICAL_AUDIT_FIELDS } from '../domain/junction'
import type { ConceptualDesign, ERDesign, Position } from '../types/dsl'
import {
  getRowXOffsets,
  resolveChenCollisions,
  type ChenNode,
} from './chen/collision'
import { CHEN_NODE_DIMENSIONS, getChenNodeSize } from './chen/dimensions'
import { getNearestChenHandles, getSelfLoopPath } from './chen/geometry'
import { conceptualToChenIR, erDesignToChenIR, type ChenGraphIR } from './chen/ir'
import {
  computeChen2DLayout,
  type ChenLayoutInputEntity,
  type ChenLayoutInputRelation,
  type ChenLayoutOutput,
} from './chen/layout2d'
import { projectChenIRToFlow } from './chen/project'

export {
  CHEN_NODE_DIMENSIONS,
  computeChen2DLayout,
  conceptualToChenIR,
  detectJunctionTable,
  erDesignToChenIR,
  getChenNodeSize,
  getNearestChenHandles,
  getRowXOffsets,
  getSelfLoopPath,
  projectChenIRToFlow,
  resolveChenCollisions,
  TECHNICAL_AUDIT_FIELDS,
}

export type {
  ChenGraphIR,
  ChenLayoutInputEntity,
  ChenLayoutInputRelation,
  ChenLayoutOutput,
  ChenNode,
}

/**
 * 将物理 ER 设计转换为标准陈氏概念模型图（Chen's ER Model）
 */
export function toChenFlowElements(
  design: ERDesign,
  selectedId?: string | null,
  customPositions?: Record<string, Position>,
): { nodes: ChenNode[]; edges: ChenEdgeType[] } {
  return projectChenIRToFlow(erDesignToChenIR(design), { selectedId, customPositions })
}

/**
 * 将 Layer 1 业务概念模型（ConceptualDesign）转换为标准陈氏图（Chen's ER Model）
 */
export function conceptualToChenFlowElements(
  conceptualDesign: ConceptualDesign,
  selectedId?: string | null,
  customPositions?: Record<string, Position>,
): { nodes: ChenNode[]; edges: ChenEdgeType[] } {
  return projectChenIRToFlow(conceptualToChenIR(conceptualDesign), { selectedId, customPositions })
}

export type ChenBackingMode = 'conceptual' | 'physical'

/**
 * 判定当前陈氏概念视图实际承载与编辑的数据源：
 * - 'conceptual': 直接消费并编辑 Layer 1 业务概念模型 (`conceptualDesign`)
 * - 'physical': 反向投影并同步编辑物理表模型 (`design`)
 */
export function getChenBackingMode(params: {
  conceptualDesign?: ConceptualDesign
  design?: ERDesign
  agentPhase?: string
}): ChenBackingMode {
  const hasConcepts = Boolean(params.conceptualDesign?.concepts?.length)
  const hasEntities = Boolean(params.design?.entities?.length)

  if (
    hasConcepts &&
    (params.agentPhase === 'concept_ready' || params.agentPhase === 'deriving_physical' || !hasEntities)
  ) {
    return 'conceptual'
  }

  return hasEntities ? 'physical' : 'conceptual'
}

/**
 * 统一陈氏图渲染适配器：优先零损失消费原生业务概念模型，降级适配物理表
 */
export function renderChenFlowElements(params: {
  conceptualDesign?: ConceptualDesign
  design?: ERDesign
  agentPhase?: string
  selectedId?: string | null
  customPositions?: Record<string, Position>
}): { nodes: ChenNode[]; edges: ChenEdgeType[] } {
  const { conceptualDesign, design, selectedId, customPositions } = params
  const mode = getChenBackingMode(params)

  if (mode === 'conceptual' && conceptualDesign?.concepts?.length) {
    return conceptualToChenFlowElements(conceptualDesign, selectedId, customPositions)
  }
  if (mode === 'physical' && design?.entities?.length) {
    return toChenFlowElements(design, selectedId, customPositions)
  }
  if (conceptualDesign?.concepts?.length) {
    return conceptualToChenFlowElements(conceptualDesign, selectedId, customPositions)
  }
  return { nodes: [], edges: [] }
}
