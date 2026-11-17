import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnect,
} from '@xyflow/react'

import {
  getCanvasViewAdapter,
  type CanvasLayoutCache,
  type CanvasViewActions,
  type CanvasViewContext,
} from '../../flow/views'
import { snapPositionToGrid } from '../../flow/views/types'
import { useStore } from '../../store/erStore'
import ChenAttributeNode from '../chen/ChenAttributeNode'
import ChenEdge from '../chen/ChenEdge'
import ChenEntityNode from '../chen/ChenEntityNode'
import ChenRelationNode from '../chen/ChenRelationNode'
import RelationEdgeView from '../RelationEdge'
import TableNodeView from '../TableNode'
import CanvasEmptyState from './CanvasEmptyState'
import CanvasFloatingToolbar from './CanvasFloatingToolbar'
import DslCodeView from './DslCodeView'

const nodeTypes = {
  table: TableNodeView,
  chenEntity: ChenEntityNode,
  chenRelation: ChenRelationNode,
  chenAttribute: ChenAttributeNode,
}
const edgeTypes = {
  relation: RelationEdgeView,
  chenEdge: ChenEdge,
}

export default function CanvasWorkspace() {
  const design = useStore((state) => state.design)
  const conceptualDesign = useStore((state) => state.conceptualDesign)
  const agentPhase = useStore((state) => state.agentPhase)
  const selection = useStore((state) => state.selection)
  const projectID = useStore((state) => state.project?.id ?? null)

  const select = useStore((state) => state.select)
  const moveEntities = useStore((state) => state.moveEntities)
  const deleteEntity = useStore((state) => state.deleteEntity)
  const deleteAttribute = useStore((state) => state.deleteAttribute)
  const deleteRelation = useStore((state) => state.deleteRelation)
  const addRelation = useStore((state) => state.addRelation)
  const addEntity = useStore((state) => state.addEntity)
  const autoLayout = useStore((state) => state.autoLayout)
  const openDataDialog = useStore((state) => state.openDataDialog)
  const setAiSidebarOpen = useStore((state) => state.setAiSidebarOpen)
  const dslView = useStore((state) => state.dslView)
  const setDslView = useStore((state) => state.setDslView)
  const setHoveredEntityId = useStore((state) => state.setHoveredEntityId)
  const setHoveredRelationId = useStore((state) => state.setHoveredRelationId)
  const focusedEntityId = useStore((state) => state.focusedEntityId)
  const canvasViewMode = useStore((state) => state.canvasViewMode)
  const chenPositions = useStore((state) => state.chenPositions)
  const updateChenPositions = useStore((state) => state.updateChenPositions)
  const resetChenPositions = useStore((state) => state.resetChenPositions)
  const addConcept = useStore((state) => state.addConcept)
  const deleteConcept = useStore((state) => state.deleteConcept)
  const addConceptRelation = useStore((state) => state.addConceptRelation)
  const deleteConceptRelation = useStore((state) => state.deleteConceptRelation)
  const deleteConceptAttribute = useStore((state) => state.deleteConceptAttribute)
  const dataDialogOpen = useStore((state) => state.dataDialogOpen)
  const reviewDrawerOpen = useStore((state) => state.reviewDrawerOpen)

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [zoomLevel, setZoomLevel] = useState(100)
  const [toolMode, setToolMode] = useState<'select' | 'pan'>('select')
  const initialFittedKeyRef = useRef<string | null>(null)
  const layoutCacheRef = useRef<CanvasLayoutCache | null>(null)

  const { fitView, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow()

  const adapter = useMemo(() => getCanvasViewAdapter(canvasViewMode), [canvasViewMode])

  const viewCtx: CanvasViewContext = useMemo(
    () => ({
      design,
      conceptualDesign,
      agentPhase,
      selection,
      chenPositions,
    }),
    [design, conceptualDesign, agentPhase, selection, chenPositions],
  )

  const viewActions: CanvasViewActions = useMemo(
    () => ({
      addEntity,
      moveEntities,
      deleteEntity,
      deleteAttribute,
      addRelation,
      deleteRelation,
      autoLayout,
      addConcept,
      deleteConcept,
      deleteConceptAttribute,
      addConceptRelation,
      deleteConceptRelation,
      updateChenPositions,
      resetChenPositions,
    }),
    [
      addEntity,
      moveEntities,
      deleteEntity,
      deleteAttribute,
      addRelation,
      deleteRelation,
      autoLayout,
      addConcept,
      deleteConcept,
      deleteConceptAttribute,
      addConceptRelation,
      deleteConceptRelation,
      updateChenPositions,
      resetChenPositions,
    ],
  )

  const isCanvasEmpty = !adapter.hasContent(viewCtx)

  useEffect(() => {
    if (!focusedEntityId) return
    void fitView({
      nodes: [{ id: focusedEntityId }],
      duration: 500,
      padding: 0.6,
      maxZoom: 1.1,
    })
  }, [focusedEntityId, fitView])

  useEffect(() => {
    const activeSelection = useStore.getState().selection
    const projected = adapter.projectToFlow(
      {
        design,
        conceptualDesign,
        agentPhase,
        selection: activeSelection,
        chenPositions,
      },
      layoutCacheRef,
    )
    setNodes(projected.nodes)
    setEdges(projected.edges)
  }, [adapter, design, conceptualDesign, agentPhase, chenPositions])

  useEffect(() => {
    setNodes((prevNodes) => adapter.syncSelection(prevNodes, [], selection).nodes)
    setEdges((prevEdges) => adapter.syncSelection([], prevEdges, selection).edges)
  }, [adapter, selection])

  useEffect(() => {
    if (!projectID || !adapter.hasContent(viewCtx)) return
    const key = `${projectID}:${canvasViewMode}`
    if (initialFittedKeyRef.current === key) return
    initialFittedKeyRef.current = key

    adapter.prepareInitialMount(viewCtx, viewActions)

    const timers = [60, 180, 360].map((delay) =>
      window.setTimeout(() => {
        void fitView({ padding: 0.18, duration: 300 })
      }, delay),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [projectID, canvasViewMode, adapter, viewCtx, viewActions, fitView])

  const handleNodesChange = (changes: NodeChange[]) => {
    const stateChanges = adapter.processNodeChanges(changes, nodes, viewCtx, viewActions)
    if (stateChanges.length > 0) {
      setNodes((current) => applyNodeChanges(stateChanges, current))
    }
  }

  const handleEdgesChange = (changes: EdgeChange[]) => {
    adapter.processEdgeChanges(changes, nodes, edges, viewCtx, viewActions)
  }

  const handleConnect: OnConnect = (connection) => {
    adapter.handleConnect(connection, viewCtx, viewActions)
  }

  const handleAutoLayout = () => {
    const reprojected = adapter.runAutoLayout(
      () => {
        const s = useStore.getState()
        return {
          design: s.design,
          conceptualDesign: s.conceptualDesign,
          agentPhase: s.agentPhase,
          selection: s.selection,
          chenPositions: s.chenPositions,
        }
      },
      viewActions,
      layoutCacheRef,
    )
    if (reprojected) {
      setNodes(reprojected.nodes)
      setEdges(reprojected.edges)
    }

    for (const delay of [60, 180, 360]) {
      window.setTimeout(() => {
        void fitView({ padding: 0.18, duration: 300 })
      }, delay)
    }
  }

  if (dslView === 'code') {
    return <DslCodeView design={design} onExitCodeView={() => setDslView('canvas')} />
  }

  const isModalOverlayOpen = dataDialogOpen || reviewDrawerOpen

  return (
    <div
      className={`relative h-full w-full bg-[#faf7f0] ${
        toolMode === 'pan' ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
        if (
          target.classList.contains('react-flow__pane') ||
          target.classList.contains('react-flow__background') ||
          target.tagName.toLowerCase() === 'svg' ||
          target.tagName.toLowerCase() === 'path'
        ) {
          const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          adapter.createPrimaryElement(viewCtx, viewActions, snapPositionToGrid(flowPos))
        }
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        connectionMode={ConnectionMode.Loose}
        fitView={true}
        fitViewOptions={{ padding: 0.18 }}
        snapToGrid={true}
        snapGrid={[20, 20]}
        elevateNodesOnSelect={true}
        panOnDrag={toolMode === 'pan' ? true : [1]}
        panActivationKeyCode="Space"
        onNodeDragStop={(_, _node, draggedNodes) => {
          if (!draggedNodes || draggedNodes.length === 0) return
          adapter.applyNodePositionChanges(draggedNodes, viewActions)
        }}
        onNodeClick={(_, node) => {
          const resolved = adapter.resolveSelection({ kind: 'node', node }, viewCtx)
          if (resolved !== undefined) {
            select(resolved)
          }
        }}
        onNodeMouseEnter={(_, node) => setHoveredEntityId(node.id)}
        onNodeMouseLeave={() => setHoveredEntityId(null)}
        onEdgeClick={(_, edge) => {
          const resolved = adapter.resolveSelection({ kind: 'edge', edge }, viewCtx)
          if (resolved !== undefined) {
            select(resolved)
          }
        }}
        onEdgeMouseEnter={(_, edge) => setHoveredRelationId(edge.id)}
        onEdgeMouseLeave={() => setHoveredRelationId(null)}
        onPaneClick={() => {
          select(null)
          setHoveredEntityId(null)
          setHoveredRelationId(null)
        }}
        onMoveEnd={(_, viewport) => {
          setZoomLevel(Math.round(viewport.zoom * 100))
        }}
        deleteKeyCode={isModalOverlayOpen ? null : ['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#d6cfc4" />

        {!isCanvasEmpty ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor="#e5ded0"
            nodeStrokeColor="#1f1f1f"
            maskColor="rgba(250, 247, 240, 0.85)"
            style={{ width: 160, height: 100, marginBottom: 24, marginRight: 24 }}
            className="!rounded-2xl !border-[1.5px] !border-[#1f1f1f] !shadow-[2px_2px_0px_#1f1f1f] !overflow-hidden"
          />
        ) : null}
      </ReactFlow>

      <CanvasFloatingToolbar
        toolMode={toolMode}
        zoomLevel={zoomLevel}
        onSelectMode={setToolMode}
        onAutoLayout={handleAutoLayout}
        onFitView={() => void fitView({ padding: 0.2, duration: 300 })}
        onZoomIn={() => void zoomIn({ duration: 200 })}
        onZoomOut={() => void zoomOut({ duration: 200 })}
      />

      {isCanvasEmpty ? (
        <CanvasEmptyState
          copy={adapter.emptyState}
          onCreatePrimary={() => adapter.createPrimaryElement(viewCtx, viewActions)}
          onOpenImportSql={() => openDataDialog('import-sql')}
          onOpenAiArchitect={() => {
            setAiSidebarOpen(true)
            setTimeout(() => {
              const textarea = document.getElementById(
                'ai-sidebar-textarea',
              ) as HTMLTextAreaElement | null
              textarea?.focus()
            }, 80)
          }}
        />
      ) : null}
    </div>
  )
}
