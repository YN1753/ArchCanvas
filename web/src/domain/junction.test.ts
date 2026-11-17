import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Attribute, Entity } from '../types/dsl'
import { detectJunctionTable } from './junction'

function attr(id: string, name: string, pk = false): Attribute {
  return {
    id,
    name,
    db_type: 'BIGINT',
    code_type: 'int64',
    is_primary_key: pk,
    is_nullable: false,
    is_unique: false,
    description: '',
  }
}

describe('Unified Junction Table Detector', () => {
  it('never misclassifies substring entity names like order_id matching order_items', () => {
    const orders: Entity = { id: 'e_orders', name: 'orders', attributes: [attr('o1', 'id', true)] }
    const orderItems: Entity = {
      id: 'e_order_items',
      name: 'order_items',
      attributes: [
        attr('oi1', 'id', true),
        attr('oi2', 'order_id'),
        attr('oi3', 'created_at'),
      ],
    }
    const shipments: Entity = {
      id: 'e_ship',
      name: 'order_shipments',
      attributes: [
        attr('s1', 'id', true),
        attr('s2', 'order_id'),
        attr('s3', 'created_at'),
      ],
    }

    // shipments 只有一个真实外键 order_id，不应因 order_items 包含 "order" 子串被误凑够 2 个父表
    const res = detectJunctionTable(shipments, [orders, orderItems, shipments])
    assert.equal(res.isJunction, false)
  })

  it('allows up to 7 columns with unified audit fields and <= 1 lightweight business column', () => {
    const users: Entity = { id: 'u', name: 'users', attributes: [attr('u1', 'id', true)] }
    const roles: Entity = { id: 'r', name: 'roles', attributes: [attr('r1', 'id', true)] }
    const userRoles: Entity = {
      id: 'ur',
      name: 'user_roles',
      attributes: [
        attr('1', 'id', true),
        attr('2', 'user_id'),
        attr('3', 'role_id'),
        attr('4', 'tenant_id'),
        attr('5', 'sort_order'),
        attr('6', 'created_at'),
        attr('7', 'scope_tag'), // 1 lightweight business column
      ],
    }

    const res = detectJunctionTable(userRoles, [users, roles, userRoles])
    assert.equal(res.isJunction, true)
    assert.equal(res.leftEntity?.id, 'u')
    assert.equal(res.rightEntity?.id, 'r')

    // 超过 7 列则保留为实体表
    const eightCols: Entity = {
      ...userRoles,
      attributes: [...userRoles.attributes, attr('8', 'updated_at')],
    }
    assert.equal(detectJunctionTable(eightCols, [users, roles, eightCols]).isJunction, false)
  })

  it('protects parent primary entities referenced by another non-junction entity FK', () => {
    const users: Entity = { id: 'u', name: 'users', attributes: [attr('u1', 'id', true)] }
    const coupons: Entity = { id: 'c', name: 'coupons', attributes: [attr('c1', 'id', true)] }
    // orders 恰好只有 2 个 FK + 1 个业务字段（<= 7 列），但被 order_items.order_id 作为主表引用
    const orders: Entity = {
      id: 'o',
      name: 'orders',
      attributes: [
        attr('o1', 'id', true),
        attr('o2', 'user_id'),
        attr('o3', 'coupon_id'),
        attr('o4', 'total_amount'),
        attr('o5', 'created_at'),
      ],
    }
    const orderItems: Entity = {
      id: 'oi',
      name: 'order_items',
      attributes: [
        attr('oi1', 'id', true),
        attr('oi2', 'order_id'),
        attr('oi3', 'sku_name'),
        attr('oi4', 'unit_price'),
        attr('oi5', 'quantity'),
      ],
    }

    const res = detectJunctionTable(orders, [users, coupons, orders, orderItems])
    assert.equal(res.isJunction, false)
  })
})
