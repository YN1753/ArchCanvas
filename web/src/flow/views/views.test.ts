import assert from 'node:assert'
import { describe, it } from 'node:test'

import { getCanvasViewAdapter, listCanvasViewAdapters } from './index'
import type { CanvasLayoutCache, CanvasViewActions, CanvasViewContext } from './types'

function createStubActions(log: string[]): CanvasViewActions {
  return {
    addEntity: () => {
      log.push('addEntity')
      return 'ent_new'
    },
    moveEntities: (moves) => log.push(`moveEntities:${moves.length}:${moves[0]?.position.x},${moves[0]?.position.y}`),
    deleteEntity: (id) => log.push(`deleteEntity:${id}`),
    deleteAttribute: (eid, aid) => log.push(`deleteAttribute:${eid}:${aid}`),
    addRelation: (src, tgt) => log.push(`addRelation:${src}->${tgt}`),
    deleteRelation: (id) => log.push(`deleteRelation:${id}`),
    autoLayout: () => log.push('autoLayout'),
    addConcept: () => log.push('addConcept'),
    deleteConcept: (id) => log.push(`deleteConcept:${id}`),
    deleteConceptAttribute: (cid, aid) => log.push(`deleteConceptAttribute:${cid}:${aid}`),
    addConceptRelation: (src, tgt) => log.push(`addConceptRelation:${src}->${tgt}`),
    deleteConceptRelation: (id) => log.push(`deleteConceptRelation:${id}`),
    updateChenPositions: (moves) =>
      log.push(`updateChenPositions:${moves.length}:${moves[0]?.position.x},${moves[0]?.position.y}`),
    resetChenPositions: () => log.push('resetChenPositions'),
  }
}

const sampleCtx: CanvasViewContext = {
  design: {
    entities: [
      {
        id: 'ent_users',
        name: 'users',
        position: { x: 80, y: 80 },
        attributes: [
          {
            id: 'attr_id',
            name: 'id',
            db_type: 'BIGINT',
            code_type: 'int64',
            is_primary_key: true,
            is_nullable: false,
            is_unique: false,
            description: '',
          },
        ],
      },
    ],
    relations: [],
  },
  conceptualDesign: {
    concepts: [
      {
        id: 'con_user',
        name: 'User',
        display_name: '用户',
        attributes: [{ id: 'ca_1', name: 'id', category: 'string', is_business_key: true }],
      },
    ],
    relations: [],
  },
  agentPhase: 'concept_ready',
  selection: null,
  chenPositions: {},
}

describe('Canvas Multi-View Adapter Registry', () => {
  it('registers chen and relational view adapters', () => {
    assert.deepStrictEqual(
      listCanvasViewAdapters().map((a) => a.mode),
      ['chen', 'relational'],
    )
  })

  it('projects relational view, snaps dragged positions, and resolves selection', () => {
    const adapter = getCanvasViewAdapter('relational')
    assert.strictEqual(adapter.hasContent(sampleCtx), true)
    const cacheRef: { current: CanvasLayoutCache | null } = { current: null }
    const projected = adapter.projectToFlow(sampleCtx, cacheRef)
    assert.strictEqual(projected.nodes.length, 1)
    assert.strictEqual(projected.nodes[0].type, 'table')

    const log: string[] = []
    adapter.applyNodePositionChanges(
      [{ ...projected.nodes[0], position: { x: 113, y: 189 } }],
      createStubActions(log),
    )
    assert.deepStrictEqual(log, ['moveEntities:1:120,180'])
    assert.deepStrictEqual(
      adapter.resolveSelection({ kind: 'node', node: projected.nodes[0] }, sampleCtx),
      { kind: 'entity', id: 'ent_users' },
    )
  })

  it('projects chen view with layout caching and resolves attribute clicks to parent concept', () => {
    const adapter = getCanvasViewAdapter('chen')
    assert.strictEqual(adapter.hasContent(sampleCtx), true)
    const cacheRef: { current: CanvasLayoutCache | null } = { current: null }
    const projected = adapter.projectToFlow(sampleCtx, cacheRef)
    assert.ok(projected.nodes.length >= 2)
    assert.ok(cacheRef.current !== null)

    const attrNode = projected.nodes.find((n) => n.type === 'chenAttribute')!
    assert.deepStrictEqual(
      adapter.resolveSelection({ kind: 'node', node: attrNode }, sampleCtx),
      { kind: 'entity', id: 'con_user' },
    )

    const log: string[] = []
    adapter.applyNodePositionChanges(
      [{ ...projected.nodes[0], position: { x: 47, y: 63 } }],
      createStubActions(log),
    )
    assert.deepStrictEqual(log, ['updateChenPositions:1:40,60'])
  })
})
