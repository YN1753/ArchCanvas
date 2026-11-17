import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  lookupConceptPosition,
  lookupConceptRelationPosition,
  normalizeConceptualDesign,
} from './conceptNormalize'

describe('Canonical ConceptualDesign Normalization', () => {
  it('stamps deterministic canonical IDs on concepts, attributes, and relations when missing', () => {
    const raw = {
      summary: '电商概念',
      concepts: [
        {
          name: 'User',
          display_name: '用户',
          attributes: [{ name: 'id', category: 'string' as const, is_business_key: true }],
        },
        {
          name: 'Order',
          display_name: '订单',
          attributes: [{ name: 'order_no', category: 'string' as const }],
        },
      ],
      relations: [
        {
          name: '下单',
          source_concept: 'User',
          target_concept: 'Order',
          cardinality: 'one_to_many' as const,
        },
      ],
    }

    const first = normalizeConceptualDesign(raw)
    const second = normalizeConceptualDesign(raw)

    assert.equal(first.concepts[0].id, 'concept_user')
    assert.equal(first.concepts[0].attributes[0].id, 'id')
    assert.equal(first.concepts[1].id, 'concept_order')
    assert.equal(first.relations[0].id, 'rel_concept_user_concept_order')
    assert.deepEqual(first, second, 'normalization must be deterministic and idempotent')
  })

  it('preserves existing canonical IDs and resolves legacy chenPositions keys seamlessly', () => {
    const normalized = normalizeConceptualDesign({
      concepts: [{ id: 'uuid-user-1', name: 'User', attributes: [] }],
      relations: [
        {
          id: 'uuid-rel-1',
          source_concept: 'User',
          target_concept: 'User',
          cardinality: 'one_to_many',
        },
      ],
    })

    assert.equal(normalized.concepts[0].id, 'uuid-user-1')
    assert.equal(normalized.relations[0].id, 'uuid-rel-1')

    const legacyPositions = {
      concept_user: { x: 180, y: 240 },
      'rel-rel_concept_user_concept_user': { x: 420, y: 240 },
    }

    assert.deepEqual(lookupConceptPosition(normalized.concepts[0], legacyPositions), {
      x: 180,
      y: 240,
    })
    assert.deepEqual(
      lookupConceptRelationPosition(
        {
          diamondId: 'rel-uuid-rel-1',
          relationId: 'uuid-rel-1',
          sourceName: 'User',
          targetName: 'User',
        },
        legacyPositions,
      ),
      { x: 420, y: 240 },
    )
  })
})
