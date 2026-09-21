import { useEffect, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
} from '@xyflow/react'

import { toFlowEdges, toFlowNodes, type RelationEdge, type TableNode } from '../flow/adapter'
import { useStore } from '../store/erStore'
import RelationEdgeView from './RelationEdge'
import TableNodeView from './TableNode'

const nodeTypes = { table: TableNodeView }
const edgeTypes = { relation: RelationEdgeView }

export default function Canvas() {
  const design = useStore((state) => state.design)
  const selection = useStore((state) => state.selection)
  const projectID = useStore((state) => state.project?.id ?? null)

  const select = useStore((state) => state.select)
  const moveEntities = useStore((state) => state.moveEntities)
  const deleteEntity = useStore((state) => state.deleteEntity)
  const deleteRelation = useStore((state) => state.deleteRelation)
  const addRelation = useStore((state) => state.addRelation)
  const addEntity = useStore((state) => state.addEntity)
  const autoLayout = useStore((state) => state.autoLayout)
  const dslView = useStore((state) => state.dslView)
  const setDslView = useStore((state) => state.setDslView)

  const [nodes, setNodes] = useState<TableNode[]>([])
  const [edges, setEdges] = useState<RelationEdge[]>([])
  const [copied, setCopied] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [zoomLevel, setZoomLevel] = useState(100)

  const { fitView, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow()

  const selectedEntityID = selection?.kind === 'entity' ? selection.id : null
  const selectedRelationID = selection?.kind === 'relation' ? selection.id : null

  useEffect(() => {
    setNodes(toFlowNodes(design, selectedEntityID))
  }, [design, selectedEntityID])

  useEffect(() => {
    setEdges(toFlowEdges(design, selectedRelationID))
  }, [design, selectedRelationID])

  useEffect(() => {
    if (!projectID || design.entities.length === 0) {
      return
    }
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.18, maxZoom: 1 })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [projectID, design.entities.length, fitView])

  const handleNodesChange = (changes: NodeChange<TableNode>[]) => {
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

  const handleEdgesChange = (changes: EdgeChange<RelationEdge>[]) => {
    for (const change of changes) {
      if (change.type === 'remove') {
        deleteRelation(change.id)
      }
    }
  }

  const handleConnect: OnConnect = (connection) => {
    if (connection.source && connection.target) {
      addRelation(connection.source, connection.target)
    }
  }

  // ----------------------------------------------------
  // JSON 源码 IDE 风格视图
  // ----------------------------------------------------
  if (dslView === 'code') {
    const jsonString = JSON.stringify(design, null, 2)
    const lineCount = jsonString.split('\n').length

    return (
      <div className="relative flex h-full w-full flex-col bg-slate-950 text-slate-100">
        {/* Code View Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-5 py-3 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-slate-200">ER DSL 源码（JSON 标准规范）</span>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>·</span>
              <span>{design.entities.length} 个实体表</span>
              <span>·</span>
              <span>{design.relations.length} 条关联关系</span>
              <span>·</span>
              <span>共 {lineCount} 行代码</span>
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
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-700 hover:text-white"
            >
              {copied ? (
                <>
                  <span className="text-emerald-400">✓</span>
                  <span>已复制到剪贴板</span>
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                    />
                  </svg>
                  <span>复制 JSON</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setDslView('canvas')}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 shadow-sm"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>切回画布视图</span>
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div className="relative min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-emerald-300/90 selection:bg-indigo-900 selection:text-white">
          <textarea
            readOnly
            value={jsonString}
            spellCheck={false}
            className="ident h-full w-full resize-none bg-transparent outline-none select-text"
          />
        </div>
      </div>
    )
  }

  // ----------------------------------------------------
  // 画布视图
  // ----------------------------------------------------
  return (
    <div
      className="relative h-full w-full bg-slate-100/70"
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
        // 仅在双击画布空白背景时触发就地建表，避免误触卡片内部
        if (
          target.classList.contains('react-flow__pane') ||
          target.classList.contains('react-flow__background') ||
          target.tagName.toLowerCase() === 'svg' ||
          target.tagName.toLowerCase() === 'path'
        ) {
          const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          addEntity({
            x: Math.round(flowPos.x / 20) * 20,
            y: Math.round(flowPos.y / 20) * 20,
          })
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
        snapToGrid={snapEnabled}
        snapGrid={[20, 20]}
        elevateNodesOnSelect={true}
        onNodeDragStop={(_, _node, draggedNodes) => {
          // 批量记录所有被拖拽节点的位置，彻底解决多选拖拽坐标丢失问题
          if (draggedNodes && draggedNodes.length > 0) {
            moveEntities(
              draggedNodes.map((n) => ({
                id: n.id,
                position: {
                  x: Math.round(n.position.x / (snapEnabled ? 20 : 1)) * (snapEnabled ? 20 : 1),
                  y: Math.round(n.position.y / (snapEnabled ? 20 : 1)) * (snapEnabled ? 20 : 1),
                },
              })),
            )
          }
        }}
        onNodeClick={(_, node) => select({ kind: 'entity', id: node.id })}
        onEdgeClick={(_, edge) => select({ kind: 'relation', id: edge.id })}
        onPaneClick={() => select(null)}
        onMoveEnd={(_, viewport) => {
          setZoomLevel(Math.round(viewport.zoom * 100))
        }}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />

        <Controls
          showInteractive={false}
          position="bottom-left"
          className="!mb-6 !ml-6 !shadow-lg"
        />

        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor="#e2e8f0"
          nodeStrokeColor="#94a3b8"
          maskColor="rgba(241, 245, 249, 0.85)"
          style={{ width: 170, height: 110, marginBottom: 24, marginRight: 24 }}
          className="!rounded-xl !border !border-slate-200/90 !shadow-lg !overflow-hidden"
        />
      </ReactFlow>

      {/* 画布顶部悬浮工具条 (Quick Floating Island) */}
      <div className="pointer-events-none absolute top-4 left-6 z-10 flex items-center gap-2">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/95 px-3 py-1.5 shadow-md backdrop-blur-md select-none">
          <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-xs shadow-indigo-300" />
            <span>画布架构图</span>
          </span>

          <div className="h-3.5 w-px bg-slate-200 mx-1" />

          <span className="text-[11px] text-slate-500 font-medium">
            {design.entities.length} 实体表 · {design.relations.length} 关系
          </span>

          <div className="h-3.5 w-px bg-slate-200 mx-1" />

          {/* 缩放比率与快捷缩放 */}
          <div className="flex items-center gap-0.5 text-[11px] text-slate-500 font-mono">
            <button
              type="button"
              onClick={() => void zoomOut({ duration: 200 })}
              className="rounded p-1 hover:bg-slate-100 hover:text-slate-800 transition"
              title="缩小"
            >
              −
            </button>
            <span className="w-8 text-center">{zoomLevel}%</span>
            <button
              type="button"
              onClick={() => void zoomIn({ duration: 200 })}
              className="rounded p-1 hover:bg-slate-100 hover:text-slate-800 transition"
              title="放大"
            >
              +
            </button>
          </div>

          <div className="h-3.5 w-px bg-slate-200 mx-1" />

          {/* 适应视口 */}
          <button
            type="button"
            onClick={() => void fitView({ padding: 0.2, duration: 300 })}
            className="rounded px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
            title="适应视口大小"
          >
            适应视口
          </button>

          {/* 智能排版 */}
          <button
            type="button"
            onClick={() => autoLayout()}
            className="rounded px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
            title="Dagre 智能排版"
          >
            智能整理
          </button>

          <div className="h-3.5 w-px bg-slate-200 mx-1" />

          {/* 网格吸附开关 */}
          <button
            type="button"
            onClick={() => setSnapEnabled((v) => !v)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition ${
              snapEnabled
                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
            }`}
            title="开启/关闭 20px 标线网格吸附对齐"
          >
            <span>🧲 网格吸附</span>
            <span>{snapEnabled ? '开' : '关'}</span>
          </button>
        </div>
      </div>

      {/* 空白画布引导卡片 */}
      {design.entities.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="pointer-events-auto max-w-md rounded-2xl border border-slate-200/90 bg-white/95 p-6 text-center shadow-xl backdrop-blur-md">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-3 shadow-inner">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.75}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>

            <h3 className="text-sm font-bold text-slate-800">当前项目画布尚无数据实体</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              在画布空白处<span className="font-semibold text-indigo-600">双击</span>可直接新建实体表，或在底部 AI 面板中输入自然语言需求让 AI 自动推导并落库。
            </p>

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => addEntity()}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 shadow-sm"
              >
                <span>+ 手动新建实体</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
