import { useEffect, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
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
  const openDataDialog = useStore((state) => state.openDataDialog)
  const setAiSidebarOpen = useStore((state) => state.setAiSidebarOpen)
  const dslView = useStore((state) => state.dslView)
  const setDslView = useStore((state) => state.setDslView)
  const setHoveredEntityId = useStore((state) => state.setHoveredEntityId)
  const setHoveredRelationId = useStore((state) => state.setHoveredRelationId)

  const [nodes, setNodes] = useState<TableNode[]>([])
  const [edges, setEdges] = useState<RelationEdge[]>([])
  const [copied, setCopied] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(100)
  const [toolMode, setToolMode] = useState<'select' | 'pan'>('select')

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

  const handleAutoLayout = () => {
    autoLayout()
    window.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 300 })
    }, 60)
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
  return (
    <div
      className="relative h-full w-full bg-[#faf7f0]"
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
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
        snapToGrid={true}
        snapGrid={[20, 20]}
        elevateNodesOnSelect={true}
        panOnDrag={toolMode === 'pan'}
        onNodeDragStop={(_, _node, draggedNodes) => {
          if (draggedNodes && draggedNodes.length > 0) {
            moveEntities(
              draggedNodes.map((n) => ({
                id: n.id,
                position: {
                  x: Math.round(n.position.x / 20) * 20,
                  y: Math.round(n.position.y / 20) * 20,
                },
              })),
            )
          }
        }}
        onNodeClick={(_, node) => select({ kind: 'entity', id: node.id })}
        onNodeMouseEnter={(_, node) => setHoveredEntityId(node.id)}
        onNodeMouseLeave={() => setHoveredEntityId(null)}
        onEdgeClick={(_, edge) => select({ kind: 'relation', id: edge.id })}
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
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#d6cfc4" />

        {design.entities.length > 0 ? (
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

      {/* 左侧垂直工具胶囊 (1:1 复刻参考图) */}
      <div className="absolute left-6 top-28 z-20 select-none">
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-1.5 shadow-[2px_2px_0px_#1f1f1f]">
          {/* 箭头指针 */}
          <button
            type="button"
            onClick={() => setToolMode('select')}
            className={`rounded-xl p-2 transition ${
              toolMode === 'select'
                ? 'bg-[#fdf0ee] border border-[#df4e3e] text-[#df4e3e] shadow-2xs'
                : 'text-stone-600 hover:bg-stone-50'
            }`}
            title="选择与拖拽模式"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            </svg>
          </button>

          {/* 抓手平移 */}
          <button
            type="button"
            onClick={() => setToolMode('pan')}
            className={`rounded-xl p-2 transition ${
              toolMode === 'pan'
                ? 'bg-[#fdf0ee] border border-[#df4e3e] text-[#df4e3e] shadow-2xs'
                : 'text-stone-600 hover:bg-stone-50'
            }`}
            title="平移画布模式"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
            </svg>
          </button>

          <div className="w-full border-t border-dashed border-stone-200 my-0.5" />

          {/* 整理排版布局 */}
          <button
            type="button"
            onClick={handleAutoLayout}
            className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 hover:text-[#df4e3e] active:scale-95 transition"
            title="整理排版布局 (自动紧凑对齐)"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="6" rx="1.5" />
              <rect x="14" y="3" width="7" height="6" rx="1.5" />
              <rect x="8.5" y="15" width="7" height="6" rx="1.5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 9v3h11V9M12 12v3" />
            </svg>
          </button>

          {/* 适应视口 */}
          <button
            type="button"
            onClick={() => void fitView({ padding: 0.2, duration: 300 })}
            className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 hover:text-[#df4e3e] active:scale-95 transition"
            title="适应视口"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>

          <div className="w-full border-t border-dashed border-stone-200 my-0.5" />

          {/* 放大 */}
          <button
            type="button"
            onClick={() => void zoomIn({ duration: 200 })}
            className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 transition"
            title="放大画布"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
            </svg>
          </button>

          {/* 缩小 */}
          <button
            type="button"
            onClick={() => void zoomOut({ duration: 200 })}
            className="rounded-xl p-2 text-stone-600 hover:bg-stone-50 transition"
            title="缩小画布"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

      {/* 空白画布起草引导区 (1:1 复刻参考图「在纸上先画架构」) */}
      {design.entities.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6 select-none overflow-y-auto no-scrollbar pb-32">
          <div className="pointer-events-auto flex flex-col items-center max-w-xl w-full text-center">
            {/* 顶部架构蓝图图章 */}
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white text-blue-500 shadow-[2px_2px_0px_#1f1f1f] mb-2">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="6" rx="1" />
                <rect x="14" y="3" width="7" height="6" rx="1" />
                <rect x="8.5" y="15" width="7" height="6" rx="1" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 9v3h11V9M12 12v3" />
              </svg>
            </div>

            <h2 className="text-2xl font-black text-[#1f1f1f] tracking-tight">在纸上先画架构</h2>
            <p className="mt-1 text-xs text-stone-500 font-medium">
              双击画布扔一张表，或把业务说清楚，让 AI 帮你起草
            </p>

            {/* 3 张核心操作卡片 */}
            <div className="w-full space-y-2.5 mt-5">
              {/* 卡片 1: 空白建实体 */}
              <div
                onClick={() => addEntity()}
                className="group rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] hover:translate-x-0.5 hover:-translate-y-0.5 transition cursor-pointer flex items-center gap-3.5 text-left active:translate-x-1 active:translate-y-1"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#df4e3e]/40 bg-[#fdf0ee] text-[#df4e3e] font-bold text-lg group-hover:scale-105 transition">
                  +
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1f1f1f]">空白建实体</div>
                  <div className="text-xs text-stone-500 mt-0.5">像贴便签一样新建一张表</div>
                </div>
              </div>

              {/* 卡片 2: 导入已有 SQL / DDL */}
              <div
                onClick={() => openDataDialog('import-sql')}
                className="group rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] hover:translate-x-0.5 hover:-translate-y-0.5 transition cursor-pointer flex items-center gap-3.5 text-left active:translate-x-1 active:translate-y-1"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#df4e3e]/40 bg-[#fdf0ee] text-[#df4e3e] group-hover:scale-105 transition">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1f1f1f]">导入已有 SQL / DDL</div>
                  <div className="text-xs text-stone-500 mt-0.5">粘贴建表脚本，瞬间逆向生成架构画板</div>
                </div>
              </div>

              {/* 卡片 3: AI 起草架构 */}
              <div
                onClick={() => {
                  setAiSidebarOpen(true)
                  setTimeout(() => {
                    const textarea = document.getElementById('ai-sidebar-textarea') as HTMLTextAreaElement | null
                    textarea?.focus()
                  }, 80)
                }}
                className="group rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white p-4 shadow-[2px_2px_0px_#1f1f1f] hover:translate-x-0.5 hover:-translate-y-0.5 transition cursor-pointer flex items-center gap-3.5 text-left active:translate-x-1 active:translate-y-1"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#df4e3e]/40 bg-[#fdf0ee] text-[#df4e3e] group-hover:scale-105 transition">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1f1f1f]">AI 起草架构</div>
                  <div className="text-xs text-stone-500 mt-0.5">打开左侧 AI 架构师，自动铺开实体</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      ) : null}
    </div>
  )
}
