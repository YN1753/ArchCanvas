import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnect,
} from '@xyflow/react'

import { toFlowEdges, toFlowNodes } from '../flow/adapter'
import { getChenBackingMode, renderChenFlowElements } from '../flow/chenAdapter'
import type { ChenAttributeNodeData } from './chen/ChenAttributeNode'
import type { ChenEntityNodeData } from './chen/ChenEntityNode'
import type { ChenRelationNodeData } from './chen/ChenRelationNode'
import { useStore } from '../store/erStore'
import RelationEdgeView from './RelationEdge'
import TableNodeView from './TableNode'
import ChenEntityNode from './chen/ChenEntityNode'
import ChenRelationNode from './chen/ChenRelationNode'
import ChenAttributeNode from './chen/ChenAttributeNode'
import ChenEdge from './chen/ChenEdge'

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

export default function Canvas() {
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
  const [copied, setCopied] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(100)
  const [toolMode, setToolMode] = useState<'select' | 'pan'>('select')
  const initialFittedKeyRef = useRef<string | null>(null)
  const chenLayoutCacheRef = useRef<{
    topologyKey: string
    positions: Record<string, { x: number; y: number }>
  } | null>(null)

  const { fitView, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow()

  const selectedEntityID = selection?.kind === 'entity' ? selection.id : null
  const selectedRelationID = selection?.kind === 'relation' ? selection.id : null
  const selectedAnyID = selectedEntityID ?? selectedRelationID

  const chenBackingMode = useMemo(
    () => getChenBackingMode({ conceptualDesign, design, agentPhase }),
    [conceptualDesign, design, agentPhase],
  )

  const isCanvasEmpty =
    canvasViewMode === 'chen'
      ? (conceptualDesign?.concepts?.length ?? 0) === 0 && design.entities.length === 0
      : design.entities.length === 0

  // 拓扑结构签名：仅当节点/关系/关键属性数量或手动坐标发生变化时重算 O(N^2) 碰撞布局；文案/注释变更复用已解算坐标
  const chenTopologyKey = useMemo(() => {
    if (canvasViewMode !== 'chen') return ''
    if (chenBackingMode === 'conceptual') {
      const cSig = (conceptualDesign?.concepts ?? [])
        .map(
          (c) =>
            `${c.id ?? c.name}:${c.name}:${c.position ? `${c.position.x},${c.position.y}` : ''}:${(c.attributes ?? [])
              .map((a) => `${a.id ?? a.name}:${a.is_business_key ? 1 : 0}`)
              .join(',')}`,
        )
        .join('|')
      const rSig = (conceptualDesign?.relations ?? [])
        .map(
          (r) =>
            `${r.id ?? ''}:${r.source_concept}->${r.target_concept}:${r.cardinality}:${r.position ? `${r.position.x},${r.position.y}` : ''}`,
        )
        .join('|')
      return `c@@${cSig}@@${rSig}@@${JSON.stringify(chenPositions)}`
    }
    const eSig = design.entities
      .map(
        (e) =>
          `${e.id}:${e.name}:${String(e.is_junction_table)}:${e.attributes
            .map((a) => `${a.id}:${a.name}:${a.is_primary_key ? 1 : 0}`)
            .join(',')}`,
      )
      .join('|')
    const rSig = design.relations
      .map((r) => `${r.id}:${r.source_entity_id}->${r.target_entity_id}:${r.cardinality}`)
      .join('|')
    return `p@@${eSig}@@${rSig}@@${JSON.stringify(chenPositions)}`
  }, [canvasViewMode, chenBackingMode, conceptualDesign, design, chenPositions])

  const createCanvasEntity = (pos?: { x: number; y: number }) => {
    if (canvasViewMode === 'chen' && chenBackingMode === 'conceptual') {
      addConcept(pos)
      return
    }
    const newEntityId = addEntity(pos)
    if (canvasViewMode === 'chen' && pos) {
      updateChenPositions([{ id: newEntityId, position: pos }])
    }
  }

  // 当 AI 侧栏点击实体标签或手动触发 focusEntity 时，镜头平滑飞至目标表
  useEffect(() => {
    if (!focusedEntityId) return
    void fitView({
      nodes: [{ id: focusedEntityId }],
      duration: 500,
      padding: 0.6,
      maxZoom: 1.1,
    })
  }, [focusedEntityId, fitView])

  // 1. 数据模型或拓扑变化时更新节点与连线（不包含仅选中态变更，避免点击节点重跑 50 轮碰撞求解）
  useEffect(() => {
    const activeSel = useStore.getState().selection
    const selEntId = activeSel?.kind === 'entity' ? activeSel.id : null
    const selRelId = activeSel?.kind === 'relation' ? activeSel.id : null
    const selId = selEntId ?? selRelId

    if (canvasViewMode === 'chen') {
      const cached = chenLayoutCacheRef.current
      const effectiveCustomPositions =
        cached && cached.topologyKey === chenTopologyKey
          ? { ...cached.positions, ...chenPositions }
          : chenPositions

      const { nodes: chenNodes, edges: chenEdges } = renderChenFlowElements({
        conceptualDesign,
        design,
        agentPhase,
        selectedId: selId,
        customPositions: effectiveCustomPositions,
      })

      if (!cached || cached.topologyKey !== chenTopologyKey) {
        const solvedPos: Record<string, { x: number; y: number }> = {}
        for (const n of chenNodes) {
          solvedPos[n.id] = { x: n.position.x, y: n.position.y }
        }
        chenLayoutCacheRef.current = {
          topologyKey: chenTopologyKey,
          positions: solvedPos,
        }
      }

      setNodes(chenNodes)
      setEdges(chenEdges)
    } else {
      setNodes(toFlowNodes(design, selEntId))
      setEdges(toFlowEdges(design, selRelId))
    }
  }, [
    design,
    conceptualDesign,
    agentPhase,
    canvasViewMode,
    chenPositions,
    chenTopologyKey,
  ])

  // 2. 纯选中态切换时仅做 O(N) 轻量布尔标记同步，零布局重算
  useEffect(() => {
    if (canvasViewMode === 'chen') {
      setNodes((prev) =>
        prev.map((n) => {
          let nextSelected = false
          if (n.type === 'chenEntity') {
            const d = n.data as ChenEntityNodeData
            nextSelected = Boolean(
              selectedAnyID && (n.id === selectedAnyID || d.concept?.id === selectedAnyID || d.entity?.id === selectedAnyID),
            )
          } else if (n.type === 'chenRelation') {
            const d = n.data as ChenRelationNodeData
            nextSelected = Boolean(
              selectedAnyID && (n.id === selectedAnyID || d.relationId === selectedAnyID),
            )
          }
          return n.selected === nextSelected ? n : { ...n, selected: nextSelected }
        }),
      )
      setEdges((prev) =>
        prev.map((e) => {
          const nextSelected = Boolean(
            selectedAnyID &&
              (e.source === `rel-${selectedAnyID}` ||
                e.target === `rel-${selectedAnyID}` ||
                e.source === selectedAnyID ||
                e.target === selectedAnyID),
          )
          return Boolean(e.selected) === nextSelected ? e : { ...e, selected: nextSelected }
        }),
      )
    } else {
      setNodes((prev) =>
        prev.map((n) => {
          const nextSelected = n.id === selectedEntityID
          return Boolean(n.selected) === nextSelected ? n : { ...n, selected: nextSelected }
        }),
      )
      setEdges((prev) =>
        prev.map((e) => {
          const nextSelected = e.id === selectedRelationID
          return Boolean(e.selected) === nextSelected ? e : { ...e, selected: nextSelected }
        }),
      )
    }
  }, [canvasViewMode, selectedEntityID, selectedRelationID, selectedAnyID])

  // 页面刷新、初次挂载或切换项目/视图模式时，保留用户已保存的节点坐标并自动适屏居中
  useEffect(() => {
    if (!projectID) return
    const count =
      canvasViewMode === 'chen'
        ? (conceptualDesign?.concepts?.length ?? 0) || design.entities.length
        : design.entities.length
    if (count === 0) return

    const key = `${projectID}:${canvasViewMode}`
    if (initialFittedKeyRef.current === key) return
    initialFittedKeyRef.current = key

    if (canvasViewMode === 'relational') {
      const needsAutoLayout =
        design.entities.length > 1 &&
        design.entities.every((e) => !e.position || (e.position.x === 0 && e.position.y === 0))
      if (needsAutoLayout) {
        autoLayout()
      }
    }

    const timers = [60, 180, 360].map((delay) =>
      window.setTimeout(() => {
        void fitView({ padding: 0.18, duration: 300 })
      }, delay),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [
    projectID,
    canvasViewMode,
    conceptualDesign,
    design,
    autoLayout,
    fitView,
  ])

  const handleNodesChange = (changes: NodeChange[]) => {
    if (canvasViewMode === 'chen') {
      for (const change of changes) {
        if (change.type === 'remove') {
          if (chenBackingMode === 'physical') {
            if (change.id.startsWith('junction-')) {
              deleteEntity(change.id.slice('junction-'.length))
            } else if (change.id.startsWith('rel-')) {
              deleteRelation(change.id.slice(4))
            } else if (change.id.startsWith('attr-')) {
              const attrNode = nodes.find((n) => n.id === change.id)
              const attrData = attrNode?.data as ChenAttributeNodeData | undefined
              if (attrData?.entityId && attrData?.attribute?.id) {
                deleteAttribute(attrData.entityId, attrData.attribute.id)
              }
            } else {
              deleteEntity(change.id)
            }
          } else {
            if (change.id.startsWith('rel-')) {
              deleteConceptRelation(change.id.slice(4))
            } else if (change.id.startsWith('attr-')) {
              const attrNode = nodes.find((n) => n.id === change.id)
              const attrData = attrNode?.data as ChenAttributeNodeData | undefined
              const entityId = attrData?.entityId
              const attrId = attrData?.conceptAttribute?.id || attrData?.conceptAttribute?.name
              if (entityId && attrId) {
                deleteConceptAttribute(entityId, attrId)
              }
            } else {
              deleteConcept(change.id)
            }
          }
        }
      }
      setNodes((current) => applyNodeChanges(changes, current))
      return
    }
    for (const change of changes) {
      if (change.type === 'remove') {
        deleteEntity(change.id)
      }
    }
    const positionChanges = changes.filter((change) => change.type === 'position')
    if (positionChanges.length > 0) {
      setNodes((current) => applyNodeChanges(positionChanges, current))
    }
  }

  const handleEdgesChange = (changes: EdgeChange[]) => {
    if (canvasViewMode === 'chen') {
      for (const change of changes) {
        if (change.type === 'remove') {
          const edge = edges.find((e) => e.id === change.id)
          if (edge) {
            const juncNodeId = edge.source?.startsWith('junction-')
              ? edge.source
              : edge.target?.startsWith('junction-')
                ? edge.target
                : null
            if (juncNodeId && chenBackingMode === 'physical') {
              deleteEntity(juncNodeId.slice('junction-'.length))
              continue
            }

            const relNodeId = edge.source?.startsWith('rel-')
              ? edge.source
              : edge.target?.startsWith('rel-')
                ? edge.target
                : null
            if (relNodeId) {
              if (chenBackingMode === 'physical') {
                deleteRelation(relNodeId.slice(4))
              } else {
                deleteConceptRelation(relNodeId.slice(4))
              }
              continue
            }

            const attrNodeId = edge.source?.startsWith('attr-')
              ? edge.source
              : edge.target?.startsWith('attr-')
                ? edge.target
                : null
            if (attrNodeId) {
              const attrNode = nodes.find((n) => n.id === attrNodeId)
              const attrData = attrNode?.data as ChenAttributeNodeData | undefined
              if (chenBackingMode === 'physical') {
                if (attrData?.entityId && attrData?.attribute?.id) {
                  deleteAttribute(attrData.entityId, attrData.attribute.id)
                }
              } else {
                const entityId = attrData?.entityId
                const attrId = attrData?.conceptAttribute?.id || attrData?.conceptAttribute?.name
                if (entityId && attrId) {
                  deleteConceptAttribute(entityId, attrId)
                }
              }
            }
          }
        }
      }
      return
    }
    for (const change of changes) {
      if (change.type === 'remove') {
        deleteRelation(change.id)
      }
    }
  }

  const handleConnect: OnConnect = (connection) => {
    if (!connection.source || !connection.target) return
    if (canvasViewMode === 'chen') {
      if (
        !connection.source.startsWith('attr-') &&
        !connection.target.startsWith('attr-') &&
        !connection.source.startsWith('rel-') &&
        !connection.target.startsWith('rel-') &&
        !connection.source.startsWith('junction-') &&
        !connection.target.startsWith('junction-')
      ) {
        if (chenBackingMode === 'physical') {
          addRelation(connection.source, connection.target)
        } else {
          addConceptRelation(connection.source, connection.target)
        }
      }
      return
    }
    addRelation(connection.source, connection.target)
  }

  const handleAutoLayout = () => {
    if (canvasViewMode === 'chen') {
      chenLayoutCacheRef.current = null
      resetChenPositions()
      const currentState = useStore.getState()
      const { nodes: chenNodes, edges: chenEdges } = renderChenFlowElements({
        conceptualDesign: currentState.conceptualDesign,
        design: currentState.design,
        agentPhase: currentState.agentPhase,
        selectedId: selectedAnyID,
        customPositions: {},
      })
      setNodes(chenNodes)
      setEdges(chenEdges)
    } else {
      autoLayout()
    }

    for (const delay of [60, 180, 360]) {
      window.setTimeout(() => {
        void fitView({ padding: 0.18, duration: 300 })
      }, delay)
    }
  }

  // ----------------------------------------------------
  // JSON 源码视图
  // ----------------------------------------------------
  if (dslView === 'code') {
    const jsonString = JSON.stringify(design, null, 2)
    const lineCount = jsonString.split('\n').length

    return (
      <div className="relative flex h-full w-full flex-col bg-[#1f1f1f] text-stone-100">
        <div className="flex items-center justify-between border-b border-stone-800 bg-[#18181b] px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-2 w-2 rounded-full bg-[#df4e3e]" />
            <span className="text-xs font-bold text-stone-200">ER DSL 规范源码</span>
            <div className="flex items-center gap-2 text-[11px] text-stone-400 font-mono">
              <span>·</span>
              <span>{design.entities.length} 个实体表</span>
              <span>·</span>
              <span>{design.relations.length} 条关联关系</span>
              <span>·</span>
              <span>{lineCount} 行</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(jsonString)
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1500)
                } catch {}
              }}
              className="flex items-center gap-1.5 rounded-xl border border-stone-700 bg-stone-800 px-3 py-1.5 text-xs font-semibold text-stone-300 hover:bg-stone-700 hover:text-white transition"
            >
              {copied ? '✓ 已复制' : '复制 JSON'}
            </button>

            <button
              type="button"
              onClick={() => setDslView('canvas')}
              className="flex items-center gap-1.5 rounded-xl border border-[#1f1f1f] bg-[#df4e3e] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#c84031] transition"
            >
              <span>切回画布</span>
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-amber-200/90 selection:bg-[#df4e3e] selection:text-white">
          <textarea
            readOnly
            aria-label="ER DSL JSON 源码"
            value={jsonString}
            spellCheck={false}
            className="ident h-full w-full resize-none bg-transparent outline-none select-text"
          />
        </div>
      </div>
    )
  }

  // ----------------------------------------------------
  // 画布主视图（温暖图纸白板风）
  // ----------------------------------------------------
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
          const pos = {
            x: Math.round(flowPos.x / 20) * 20,
            y: Math.round(flowPos.y / 20) * 20,
          }
          createCanvasEntity(pos)
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
          if (canvasViewMode === 'chen') {
            updateChenPositions(
              draggedNodes.map((n) => ({
                id: n.id,
                position: {
                  x: Math.round(n.position.x / 20) * 20,
                  y: Math.round(n.position.y / 20) * 20,
                },
              })),
            )
            return
          }
          moveEntities(
            draggedNodes.map((n) => ({
              id: n.id,
              position: {
                x: Math.round(n.position.x / 20) * 20,
                y: Math.round(n.position.y / 20) * 20,
              },
            })),
          )
        }}
        onNodeClick={(_, node) => {
          if (canvasViewMode === 'chen') {
            if (node.type === 'chenRelation') {
              const data = node.data as ChenRelationNodeData
              if (data?.isJunctionTable && data.relationId) {
                select({ kind: 'entity', id: data.relationId })
              } else if (data?.relationId) {
                select({ kind: 'relation', id: data.relationId })
              }
              return
            }
            if (node.type === 'chenAttribute') {
              const data = node.data as ChenAttributeNodeData
              if (data?.entityId) {
                select({ kind: 'entity', id: data.entityId })
              }
              return
            }
            if (node.type === 'chenEntity') {
              const data = node.data as ChenEntityNodeData
              const targetId =
                (chenBackingMode === 'physical' ? data?.entity?.id : data?.concept?.id) ||
                data?.conceptId ||
                node.id
              select({ kind: 'entity', id: targetId })
              return
            }
          }
          select({ kind: 'entity', id: node.id })
        }}
        onNodeMouseEnter={(_, node) => setHoveredEntityId(node.id)}
        onNodeMouseLeave={() => setHoveredEntityId(null)}
        onEdgeClick={(_, edge) => {
          if (canvasViewMode === 'chen') {
            if (edge.source?.startsWith('junction-')) {
              select({ kind: 'entity', id: edge.source.slice('junction-'.length) })
              return
            }
            if (edge.target?.startsWith('junction-')) {
              select({ kind: 'entity', id: edge.target.slice('junction-'.length) })
              return
            }
            if (edge.source?.startsWith('rel-')) {
              select({ kind: 'relation', id: edge.source.slice(4) })
              return
            }
            if (edge.target?.startsWith('rel-')) {
              select({ kind: 'relation', id: edge.target.slice(4) })
              return
            }
            return
          }
          select({ kind: 'relation', id: edge.id })
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

      {/* 左侧垂直工具胶囊 */}
      <div className="absolute left-6 top-28 z-20 select-none">
        <div
          role="toolbar"
          aria-label="画布视图控制工具栏"
          className="flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-1.5 shadow-[2px_2px_0px_#1f1f1f]"
        >
          {/* 箭头指针 */}
          <button
            type="button"
            aria-label="选择与拖拽模式"
            aria-pressed={toolMode === 'select'}
            onClick={() => setToolMode('select')}
            className={`rounded-xl p-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e] ${
              toolMode === 'select'
                ? 'bg-[#fdf0ee] border border-[#df4e3e] text-[#df4e3e] shadow-2xs'
                : 'text-stone-600 hover:bg-stone-50'
            }`}
            title="选择与拖拽模式"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            </svg>
          </button>

          {/* 抓手平移 */}
          <button
            type="button"
            aria-label="平移画布模式"
            aria-pressed={toolMode === 'pan'}
            onClick={() => setToolMode((m) => (m === 'pan' ? 'select' : 'pan'))}
            className={`rounded-xl p-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e] ${
              toolMode === 'pan'
                ? 'bg-[#fdf0ee] border border-[#df4e3e] text-[#df4e3e] shadow-2xs'
                : 'text-stone-600 hover:bg-stone-50'
            }`}
            title="平移画布模式 (在画布内支持按住 Space 临时平移，或鼠标中键拖拽)"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
            </svg>
          </button>

          <div className="w-full border-t border-dashed border-stone-200 my-0.5" />

          {/* 整理排版布局 */}
          <button
            type="button"
            aria-label="整理排版布局"
            onClick={handleAutoLayout}
            className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 hover:text-[#df4e3e] active:scale-95 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
            title="整理排版布局 (自动紧凑对齐)"
          >
            <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="6" rx="1.5" />
              <rect x="14" y="3" width="7" height="6" rx="1.5" />
              <rect x="8.5" y="15" width="7" height="6" rx="1.5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 9v3h11V9M12 12v3" />
            </svg>
          </button>

          {/* 适应视口 */}
          <button
            type="button"
            aria-label="适应视口"
            onClick={() => void fitView({ padding: 0.2, duration: 300 })}
            className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 hover:text-[#df4e3e] active:scale-95 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
            title="适应视口"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>

          <div className="w-full border-t border-dashed border-stone-200 my-0.5" />

          {/* 放大 */}
          <button
            type="button"
            aria-label="放大画布"
            onClick={() => void zoomIn({ duration: 200 })}
            className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
            title="放大画布"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
            </svg>
          </button>

          {/* 缩小 */}
          <button
            type="button"
            aria-label="缩小画布"
            onClick={() => void zoomOut({ duration: 200 })}
            className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
            title="缩小画布"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
            </svg>
          </button>

          <div className="w-full border-t border-dashed border-stone-300 my-0.5" />

          {/* 缩放比例 */}
          <span className="font-mono text-[10px] font-bold text-stone-500 py-1">
            {zoomLevel}%
          </span>
        </div>
      </div>

      {/* 空白画布起草引导区 */}
      {isCanvasEmpty ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6 select-none overflow-y-auto no-scrollbar pb-32">
          <div className="pointer-events-auto flex flex-col items-center max-w-xl w-full text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white text-blue-500 shadow-[2px_2px_0px_#1f1f1f] mb-2">
              <svg aria-hidden="true" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="6" rx="1" />
                <rect x="14" y="3" width="7" height="6" rx="1" />
                <rect x="8.5" y="15" width="7" height="6" rx="1" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 9v3h11V9M12 12v3" />
              </svg>
            </div>

            <h2 className="text-2xl font-black text-[#1f1f1f] tracking-tight">
              {canvasViewMode === 'chen' ? '在白板上构思业务模型' : '在纸上先画架构'}
            </h2>
            <p className="mt-1 text-xs text-stone-500 font-medium">
              {canvasViewMode === 'chen'
                ? '双击白板新建业务概念，或把业务说清楚让 AI 帮你起草'
                : '双击画布扔一张表，或把业务说清楚，让 AI 帮你起草'}
            </p>

            {/* 3 张语义化按钮操作卡片 */}
            <div className="w-full space-y-2.5 mt-5">
              <button
                type="button"
                onClick={() => createCanvasEntity()}
                className="group w-full rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] hover:translate-x-0.5 hover:-translate-y-0.5 transition cursor-pointer flex items-center gap-3.5 text-left active:translate-x-1 active:translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#df4e3e]/40 bg-[#fdf0ee] text-[#df4e3e] font-bold text-lg group-hover:scale-105 transition">
                  +
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1f1f1f]">
                    {canvasViewMode === 'chen' ? '空白建业务概念' : '空白建实体'}
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    {canvasViewMode === 'chen'
                      ? '在概念白板上新建一个核心实体'
                      : '像贴便签一样新建一张表'}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => openDataDialog('import-sql')}
                className="group w-full rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] hover:translate-x-0.5 hover:-translate-y-0.5 transition cursor-pointer flex items-center gap-3.5 text-left active:translate-x-1 active:translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#df4e3e]/40 bg-[#fdf0ee] text-[#df4e3e] group-hover:scale-105 transition">
                  <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1f1f1f]">导入已有 SQL / DDL</div>
                  <div className="text-xs text-stone-500 mt-0.5">粘贴建表脚本，瞬间逆向生成架构画板</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAiSidebarOpen(true)
                  setTimeout(() => {
                    const textarea = document.getElementById('ai-sidebar-textarea') as HTMLTextAreaElement | null
                    textarea?.focus()
                  }, 80)
                }}
                className="group w-full rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] hover:translate-x-0.5 hover:-translate-y-0.5 transition cursor-pointer flex items-center gap-3.5 text-left active:translate-x-1 active:translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df4e3e]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#df4e3e]/40 bg-[#fdf0ee] text-[#df4e3e] group-hover:scale-105 transition">
                  <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1f1f1f]">AI 起草架构</div>
                  <div className="text-xs text-stone-500 mt-0.5">打开左侧 AI 架构师，自动铺开实体</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
