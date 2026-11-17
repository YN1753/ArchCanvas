import { toFlowEdges, toFlowNodes } from '../adapter'
import { snapPositionToGrid, type CanvasViewAdapter } from './types'

export const relationalViewAdapter: CanvasViewAdapter = {
  mode: 'relational',
  badgeLabel: '物理表模型',
  exportSuffix: 'physical_schema',
  emptyState: {
    title: '在纸上先画架构',
    subtitle: '双击画布扔一张表，或把业务说清楚，让 AI 帮你起草',
    createTitle: '空白建实体',
    createSubtitle: '像贴便签一样新建一张表',
  },

  hasContent(ctx) {
    return ctx.design.entities.length > 0
  },

  computeTopologyKey() {
    return ''
  },

  projectToFlow(ctx) {
    const selEntId = ctx.selection?.kind === 'entity' ? ctx.selection.id : null
    const selRelId = ctx.selection?.kind === 'relation' ? ctx.selection.id : null
    return {
      nodes: toFlowNodes(ctx.design, selEntId),
      edges: toFlowEdges(ctx.design, selRelId),
    }
  },

  syncSelection(nodes, edges, selection) {
    const selEntId = selection?.kind === 'entity' ? selection.id : null
    const selRelId = selection?.kind === 'relation' ? selection.id : null
    const nextNodes = nodes.map((n) => {
      const nextSelected = n.id === selEntId
      return Boolean(n.selected) === nextSelected ? n : { ...n, selected: nextSelected }
    })
    const nextEdges = edges.map((e) => {
      const nextSelected = e.id === selRelId
      return Boolean(e.selected) === nextSelected ? e : { ...e, selected: nextSelected }
    })
    return { nodes: nextNodes, edges: nextEdges }
  },

  prepareInitialMount(ctx, actions) {
    const needsAutoLayout =
      ctx.design.entities.length > 1 &&
      ctx.design.entities.every((e) => !e.position || (e.position.x === 0 && e.position.y === 0))
    if (needsAutoLayout) {
      actions.autoLayout()
    }
  },

  createPrimaryElement(_ctx, actions, position) {
    actions.addEntity(position)
  },

  processNodeChanges(changes, _currentNodes, _ctx, actions) {
    for (const change of changes) {
      if (change.type === 'remove') {
        actions.deleteEntity(change.id)
      }
    }
    return changes.filter((change) => change.type === 'position')
  },

  processEdgeChanges(changes, _currentNodes, _currentEdges, _ctx, actions) {
    for (const change of changes) {
      if (change.type === 'remove') {
        actions.deleteRelation(change.id)
      }
    }
  },

  applyNodePositionChanges(draggedNodes, actions) {
    if (draggedNodes.length === 0) return
    actions.moveEntities(
      draggedNodes.map((n) => ({
        id: n.id,
        position: snapPositionToGrid(n.position),
      })),
    )
  },

  handleConnect(connection, _ctx, actions) {
    if (!connection.source || !connection.target) return
    actions.addRelation(connection.source, connection.target)
  },

  resolveSelection(target) {
    if (target.kind === 'node') {
      return { kind: 'entity', id: target.node.id }
    }
    return { kind: 'relation', id: target.edge.id }
  },

  runAutoLayout(_getLatestCtx, actions) {
    actions.autoLayout()
    return null
  },
}
