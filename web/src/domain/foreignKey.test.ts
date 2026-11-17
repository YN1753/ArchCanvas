import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Attribute, Entity } from '../types/dsl'
import {
  inferReferencedEntity,
  matchesEntityForeignKeyColumn,
  resolveRelationForeignKey,
} from './foreignKey'

function col(id: string, name: string, pk = false): Attribute {
  return {
    id,
    name,
    db_type: 'BIGINT',
    code_type: 'int64',
    is_primary_key: pk,
    is_nullable: !pk,
    is_unique: false,
    description: '',
  }
}

describe('Foreign Key Domain Resolver', () => {
  it('matches <singular_target>_id across irregular and -ies/-se plurals without substring false positives', () => {
    assert.equal(matchesEntityForeignKeyColumn('category_id', 'categories'), true)
    assert.equal(matchesEntityForeignKeyColumn('warehouse_id', 'warehouses'), true)
    assert.equal(matchesEntityForeignKeyColumn('person_id', 'people'), true)
    assert.equal(matchesEntityForeignKeyColumn('order_item_id', 'order_items'), true)
    assert.equal(matchesEntityForeignKeyColumn('order_id', 'order_items'), false)
    assert.equal(matchesEntityForeignKeyColumn('item_id', 'order_items'), false)
  })

  it('disambiguates multiple edges between the same parent and child via usedAttrIds', () => {
    const users: Entity = { id: 'u', name: 'users', attributes: [col('u_pk', 'id', true)] }
    const transfers: Entity = {
      id: 't',
      name: 'transfers',
      attributes: [
        col('t_pk', 'id', true),
        col('t_from', 'sender_id'),
        col('t_to', 'receiver_id'),
      ],
    }

    const used = new Set<string>()
    const first = resolveRelationForeignKey(users, transfers, { usedAttrIds: used })
    assert.equal(first?.id, 't_from')
    used.add(first!.id)

    const second = resolveRelationForeignKey(users, transfers, { usedAttrIds: used })
    assert.equal(second?.id, 't_to')
  })

  it('resolves self-referencing parent_id / reply_to_id / manager_id conventions in priority order', () => {
    const comments: Entity = {
      id: 'c',
      name: 'comments',
      attributes: [
        col('c_pk', 'id', true),
        col('c_user', 'user_id'),
        col('c_reply', 'reply_to_id'),
      ],
    }
    const selfFk = resolveRelationForeignKey(comments, comments)
    assert.equal(selfFk?.id, 'c_reply')

    const employees: Entity = {
      id: 'e',
      name: 'employees',
      attributes: [
        col('e_pk', 'id', true),
        col('e_dept', 'department_id'),
        col('e_mgr', 'manager_id'),
      ],
    }
    assert.equal(resolveRelationForeignKey(employees, employees)?.id, 'e_mgr')
  })

  it('infers referenced entity from column name', () => {
    const entities: Entity[] = [
      { id: '1', name: 'categories', attributes: [] },
      { id: '2', name: 'warehouses', attributes: [] },
    ]
    assert.equal(inferReferencedEntity('category_id', entities)?.id, '1')
    assert.equal(inferReferencedEntity('warehouse_id', entities)?.id, '2')
    assert.equal(inferReferencedEntity('unknown_id', entities), undefined)
  })
})
