import type { ChenAttributeNodeData } from '../../components/chen/ChenAttributeNode'
import type { ChenEntityNodeData } from '../../components/chen/ChenEntityNode'
import type { ChenRelationNodeData } from '../../components/chen/ChenRelationNode'
import type { Position } from '../../types/dsl'
import { getChenBackingMode, renderChenFlowElements } from '../chenAdapter'
import { snapPositionToGrid, type CanvasViewAdapter, type CanvasViewContext } from './types'

function selectedAnyId(ctx: { selection: CanvasViewContext['selection'] }): string | null {
  return ctx.selection?.id ?? null
}

export const chenViewAdapter: CanvasViewAdapter = {
  mode: 'chen',
  badgeLabel: '陈氏概念模型',
  exportSuffix: 'chen_concept',
  emptyState: {
    title: '在白板上构思业务模型',
    subtitle: '双击白板新建业务概念，或把业务说清楚让 AI 帮你起草',
    createTitle: '空白建业务概念',
    createSubtitle: '在概念白板上新建一个核心实体',
  },

  hasContent(ctx) {
    return (ctx.conceptualDesign?.concepts?.length ?? 0) > 0 || ctx.design.entities.length > 0
  },

  computeTopologyKey(ctx) {
    const backingMode = getChenBackingMode(ctx)
    if (backingMode === 'conceptual') {
      const cSig = (ctx.conceptualDesign?.concepts ?? [])
        .map(
          (c) =>
            `${c.id ?? c.name}:${c.name}:${c.position ? `${c.position.x},${c.position.y}` : ''}:${(
              c.attributes ?? []
            )
              .map((a) => `${a.id ?? a.name}:${a.is_business_key ? 1 : 0}`)
              .join(',')}`,
        )
        .join('|')
      const rSig = (ctx.conceptualDesign?.relations ?? [])
        .map(
          (r) =>
            `${r.id ?? ''}:${r.source_concept}->${r.target_concept}:${r.cardinality}:${
              r.position ? `${r.position.x},${r.position.y}` : ''
            }`,
        )
        .join('|')
      return `c@@${cSig}@@${rSig}@@${JSON.stringify(ctx.chenPositions)}`
    }

    const eSig = ctx.design.entities
      .map(
        (e) =>
          `${e.id}:${e.name}:${String(e.is_junction_table)}:${e.attributes
            .map((a) => `${a.id}:${a.name}:${a.is_primary_key ? 1 : 0}`)
            .join(',')}`,
      )
      .join('|')
    const rSig = ctx.design.relations
      .map((r) => `${r.id}:${r.source_entity_id}->${r.target_entity_id}:${r.cardinality}`)
      .join('|')
    return `p@@${eSig}@@${rSig}@@${JSON.stringify(ctx.chenPositions)}`
  },

  projectToFlow(ctx, cacheRef) {
    const topologyKey = this.computeTopologyKey(ctx)
    const cached = cacheRef.current
    const effectiveCustomPositions =
      cached && cached.topologyKey === topologyKey
        ? { ...cached.positions, ...ctx.chenPositions }
        : ctx.chenPositions

    const projected = renderChenFlowElements({
      conceptualDesign: ctx.conceptualDesign,
      design: ctx.design,
      agentPhase: ctx.agentPhase,
      selectedId: selectedAnyId(ctx),
      customPositions: effectiveCustomPositions,
    })

    if (!cached || cached.topologyKey !== topologyKey) {
      const solvedPos: Record<string, Position> = {}
      for (const n of projected.nodes) {
        solvedPos[n.id] = { x: n.position.x, y: n.position.y }
      }
      cacheRef.current = {
        topologyKey,
        positions: solvedPos,
      }
    }

    return projected
  },

  syncSelection(nodes, edges, selection) {
    const selectedId = selection?.id ?? null
    const nextNodes = nodes.map((n) => {
      let nextSelected = false
      if (n.type === 'chenEntity') {
        const d = n.data as ChenEntityNodeData
        nextSelected = Boolean(
          selectedId &&
            (n.id === selectedId || d.concept?.id === selectedId || d.entity?.id === selectedId),
        )
      } else if (n.type === 'chenRelation') {
        const d = n.data as ChenRelationNodeData
        nextSelected = Boolean(selectedId && (n.id === selectedId || d.relationId === selectedId))
      }
      return Boolean(n.selected) === nextSelected ? n : { ...n, selected: nextSelected }
    })

    const nextEdges = edges.map((e) => {
      const nextSelected = Boolean(
        selectedId &&
          (e.source === `rel-${selectedId}` ||
            e.target === `rel-${selectedId}` ||
            e.source === selectedId ||
            e.target === selectedId),
      )
      return Boolean(e.selected) === nextSelected ? e : { ...e, selected: nextSelected }
    })

    return { nodes: nextNodes, edges: nextEdges }
  },

  prepareInitialMount() {
    // 陈氏视图在 renderChenFlowElements 中内置了 2D 拓扑聚类与零重叠求解，无需额外重排
  },

  createPrimaryElement(ctx, actions, position) {
    const backingMode = getChenBackingMode(ctx)
    if (backingMode === 'conceptual') {
      actions.addConcept(position)
      return
    }
    const newEntityId = actions.addEntity(position)
    if (position) {
      actions.updateChenPositions([{ id: newEntityId, position }])
    }
  },

  processNodeChanges(changes, currentNodes, ctx, actions) {
    const backingMode = getChenBackingMode(ctx)
    for (const change of changes) {
      if (change.type !== 'remove') continue
      if (backingMode === 'physical') {
        if (change.id.startsWith('junction-')) {
          actions.deleteEntity(change.id.slice('junction-'.length))
        } else if (change.id.startsWith('rel-')) {
          actions.deleteRelation(change.id.slice(4))
        } else if (change.id.startsWith('attr-')) {
          const attrNode = currentNodes.find((n) => n.id === change.id)
          const attrData = attrNode?.data as ChenAttributeNodeData | undefined
          if (attrData?.entityId && attrData?.attribute?.id) {
            actions.deleteAttribute(attrData.entityId, attrData.attribute.id)
          }
        } else {
          actions.deleteEntity(change.id)
        }
      } else if (change.id.startsWith('rel-')) {
        actions.deleteConceptRelation(change.id.slice(4))
      } else if (change.id.startsWith('attr-')) {
        const attrNode = currentNodes.find((n) => n.id === change.id)
        const attrData = attrNode?.data as ChenAttributeNodeData | undefined
        const entityId = attrData?.entityId
        const attrId = attrData?.conceptAttribute?.id || attrData?.conceptAttribute?.name
        if (entityId && attrId) {
          actions.deleteConceptAttribute(entityId, attrId)
        }
      } else {
        actions.deleteConcept(change.id)
      }
    }
    return changes
  },

  processEdgeChanges(changes, currentNodes, currentEdges, ctx, actions) {
    const backingMode = getChenBackingMode(ctx)
    for (const change of changes) {
      if (change.type !== 'remove') continue
      const edge = currentEdges.find((e) => e.id === change.id)
      if (!edge) continue

      const juncNodeId = edge.source?.startsWith('junction-')
        ? edge.source
        : edge.target?.startsWith('junction-')
          ? edge.target
          : null
      if (juncNodeId && backingMode === 'physical') {
        actions.deleteEntity(juncNodeId.slice('junction-'.length))
        continue
      }

      const relNodeId = edge.source?.startsWith('rel-')
        ? edge.source
        : edge.target?.startsWith('rel-')
          ? edge.target
          : null
      if (relNodeId) {
        if (backingMode === 'physical') {
          actions.deleteRelation(relNodeId.slice(4))
        } else {
          actions.deleteConceptRelation(relNodeId.slice(4))
        }
        continue
      }

      const attrNodeId = edge.source?.startsWith('attr-')
        ? edge.source
        : edge.target?.startsWith('attr-')
          ? edge.target
          : null
      if (attrNodeId) {
        const attrNode = currentNodes.find((n) => n.id === attrNodeId)
        const attrData = attrNode?.data as ChenAttributeNodeData | undefined
        if (backingMode === 'physical') {
          if (attrData?.entityId && attrData?.attribute?.id) {
            actions.deleteAttribute(attrData.entityId, attrData.attribute.id)
          }
        } else {
          const entityId = attrData?.entityId
          const attrId = attrData?.conceptAttribute?.id || attrData?.conceptAttribute?.name
          if (entityId && attrId) {
            actions.deleteConceptAttribute(entityId, attrId)
          }
        }
      }
    }
  },

  applyNodePositionChanges(draggedNodes, actions) {
    if (draggedNodes.length === 0) return
    actions.updateChenPositions(
      draggedNodes.map((n) => ({
        id: n.id,
        position: snapPositionToGrid(n.position),
      })),
    )
  },

  handleConnect(connection, ctx, actions) {
    if (!connection.source || !connection.target) return
    if (
      connection.source.startsWith('attr-') ||
      connection.target.startsWith('attr-') ||
      connection.source.startsWith('rel-') ||
      connection.target.startsWith('rel-') ||
      connection.source.startsWith('junction-') ||
      connection.target.startsWith('junction-')
    ) {
      return
    }
    const backingMode = getChenBackingMode(ctx)
    if (backingMode === 'physical') {
      actions.addRelation(connection.source, connection.target)
    } else {
      actions.addConceptRelation(connection.source, connection.target)
    }
  },

  resolveSelection(target, ctx) {
    if (target.kind === 'node') {
      const { node } = target
      if (node.type === 'chenRelation') {
        const data = node.data as ChenRelationNodeData
        if (data?.isJunctionTable && data.relationId) {
          return { kind: 'entity', id: data.relationId }
        }
        if (data?.relationId) {
          return { kind: 'relation', id: data.relationId }
        }
        return undefined
      }
      if (node.type === 'chenAttribute') {
        const data = node.data as ChenAttributeNodeData
        return data?.entityId ? { kind: 'entity', id: data.entityId } : undefined
      }
      if (node.type === 'chenEntity') {
        const data = node.data as ChenEntityNodeData
        const backingMode = getChenBackingMode(ctx)
        const targetId =
          (backingMode === 'physical' ? data?.entity?.id : data?.concept?.id) ||
          data?.conceptId ||
          node.id
        return { kind: 'entity', id: targetId }
      }
      return { kind: 'entity', id: node.id }
    }

    const { edge } = target
    if (edge.source?.startsWith('junction-')) {
      return { kind: 'entity', id: edge.source.slice('junction-'.length) }
    }
    if (edge.target?.startsWith('junction-')) {
      return { kind: 'entity', id: edge.target.slice('junction-'.length) }
    }
    if (edge.source?.startsWith('rel-')) {
      return { kind: 'relation', id: edge.source.slice(4) }
    }
    if (edge.target?.startsWith('rel-')) {
      return { kind: 'relation', id: edge.target.slice(4) }
    }
    return undefined
  },

  runAutoLayout(getLatestCtx, actions, cacheRef) {
    cacheRef.current = null
    actions.resetChenPositions()
    const latestCtx = getLatestCtx()
    return renderChenFlowElements({
      conceptualDesign: latestCtx.conceptualDesign,
      design: latestCtx.design,
      agentPhase: latestCtx.agentPhase,
      selectedId: selectedAnyId(latestCtx),
      customPositions: {},
    })
  },
}
