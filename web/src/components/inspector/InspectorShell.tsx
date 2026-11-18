import { useMemo } from 'react'

import { legacyConceptSyntheticId } from '../../domain/conceptNormalize'
import { getChenBackingMode } from '../../flow/chenAdapter'
import { useStore } from '../../store/erStore'
import ConceptEntityInspector from './ConceptEntityInspector'
import ConceptRelationInspector from './ConceptRelationInspector'
import OverviewInspector from './OverviewInspector'
import PhysicalEntityInspector from './PhysicalEntityInspector'
import PhysicalRelationInspector from './PhysicalRelationInspector'

export default function InspectorShell() {
  const selection = useStore((state) => state.selection)
  const canvasViewMode = useStore((state) => state.canvasViewMode)
  const conceptualDesign = useStore((state) => state.conceptualDesign)
  const design = useStore((state) => state.design)
  const agentPhase = useStore((state) => state.agentPhase)
  const isChenView = canvasViewMode === 'chen'
  const chenBackingMode = getChenBackingMode({ conceptualDesign, design, agentPhase })
  const inspectorOpen = useStore((state) => state.inspectorOpen)
  const setInspectorOpen = useStore((state) => state.setInspectorOpen)
  const select = useStore((state) => state.select)

  const hasConcept = useStore((state) =>
    selection?.kind === 'entity'
      ? state.conceptualDesign.concepts.some(
          (c) =>
            c.id === selection.id ||
            c.name.toLowerCase() === selection.id.toLowerCase() ||
            legacyConceptSyntheticId(c.name) === selection.id,
        )
      : false,
  )
  const hasPhysicalEntity = useStore((state) =>
    selection?.kind === 'entity'
      ? state.design.entities.some((e) => e.id === selection.id)
      : false,
  )

  const hasConceptRelation = useStore((state) =>
    selection?.kind === 'relation'
      ? state.conceptualDesign.relations.some(
          (r) => r.id === selection.id || `rel-${r.id}` === selection.id,
        )
      : false,
  )
  const hasPhysicalRelation = useStore((state) =>
    selection?.kind === 'relation'
      ? state.design.relations.some((r) => r.id === selection.id)
      : false,
  )

  const handleClose = () => {
    setInspectorOpen(false)
    select(null)
  }

  const inspectorTitle = useMemo(() => {
    if (!selection) return '项目设计诊断总览'
    if (isChenView && chenBackingMode === 'conceptual') {
      if (selection.kind === 'entity') {
        return hasConcept
          ? '业务概念属性检查器'
          : hasPhysicalEntity
            ? '数据实体表检查器'
            : '概念实体检查器'
      }
      if (selection.kind === 'relation') {
        return hasConceptRelation ? '概念联系关系配置' : '关联关系属性配置'
      }
      return '业务概念检查器'
    }
    if (selection.kind === 'entity') {
      return hasPhysicalEntity
        ? '物理表属性检查器'
        : hasConcept
          ? '业务概念属性检查器'
          : '实体属性检查器'
    }
    if (selection.kind === 'relation') {
      return hasPhysicalRelation ? '物理外键与关联配置' : '关系属性配置'
    }
    return '架构检查器'
  }, [
    selection,
    isChenView,
    chenBackingMode,
    hasConcept,
    hasPhysicalEntity,
    hasConceptRelation,
    hasPhysicalRelation,
  ])

  const renderEntityContent = () => {
    if (!selection || selection.kind !== 'entity') return null
    if (isChenView && chenBackingMode === 'conceptual') {
      if (hasConcept) return <ConceptEntityInspector conceptID={selection.id} />
      if (hasPhysicalEntity) return <PhysicalEntityInspector entityID={selection.id} />
      return <ConceptEntityInspector conceptID={selection.id} />
    }
    if (hasPhysicalEntity) return <PhysicalEntityInspector entityID={selection.id} />
    if (hasConcept) return <ConceptEntityInspector conceptID={selection.id} />
    return <PhysicalEntityInspector entityID={selection.id} />
  }

  const renderRelationContent = () => {
    if (!selection || selection.kind !== 'relation') return null
    if (isChenView && chenBackingMode === 'conceptual') {
      if (hasConceptRelation) return <ConceptRelationInspector relationID={selection.id} />
      if (hasPhysicalRelation) return <PhysicalRelationInspector relationID={selection.id} />
      return <ConceptRelationInspector relationID={selection.id} />
    }
    if (hasPhysicalRelation) return <PhysicalRelationInspector relationID={selection.id} />
    if (hasConceptRelation) return <ConceptRelationInspector relationID={selection.id} />
    return <PhysicalRelationInspector relationID={selection.id} />
  }

  return (
    <aside
      aria-label="架构属性检查器"
      inert={!inspectorOpen || undefined}
      className={`transition-all duration-200 ease-in-out flex flex-col border-l-[1.5px] border-[#1f1f1f] bg-[#faf7f0] select-none shadow-sm z-30 shrink-0 overflow-hidden ${
        inspectorOpen
          ? 'absolute inset-y-0 right-0 w-[340px] max-w-[92vw] xl:static opacity-100 shadow-[-4px_0_16px_rgba(0,0,0,0.08)] xl:shadow-sm'
          : 'w-0 opacity-0 border-l-0 pointer-events-none'
      }`}
    >
      <div className="w-[340px] flex h-full flex-col">
        <div className="flex items-center justify-between border-b-[1.5px] border-[#1f1f1f] bg-white px-4 py-3 shadow-[0px_2px_0px_#1f1f1f]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#df4e3e]" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#1f1f1f]">
              {inspectorTitle}
            </h2>
          </div>

          <button
            type="button"
            aria-label="收起检查器"
            onClick={handleClose}
            className="rounded-lg p-1 text-stone-500 hover:bg-stone-100 hover:text-[#1f1f1f] transition cursor-pointer"
            title="收起检查器"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-4 no-scrollbar">
          {selection?.kind === 'entity' ? renderEntityContent() : null}
          {selection?.kind === 'relation' ? renderRelationContent() : null}
          {!selection ? <OverviewInspector /> : null}
        </div>
      </div>
    </aside>
  )
}
