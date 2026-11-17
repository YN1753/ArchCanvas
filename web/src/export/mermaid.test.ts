import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toMermaid } from './mermaid'
import type { ERDesign } from '../types/dsl'

describe('Mermaid ER Diagram Exporter', () => {
  it('preserves Chinese entity names without __ collision and formats DECIMAL(10,2) cleanly', () => {
    const design: ERDesign = {
      entities: [
        {
          id: 'e_user',
          name: '用户',
          attributes: [
            {
              id: 'a1',
              name: 'id',
              db_type: 'BIGINT UNSIGNED',
              code_type: 'uint64',
              is_primary_key: true,
              is_nullable: false,
              is_unique: false,
              description: '用户主键\n第一行',
            },
          ],
        },
        {
          id: 'e_order',
          name: '订单',
          attributes: [
            {
              id: 'a2',
              name: 'id',
              db_type: 'BIGINT',
              code_type: 'uint64',
              is_primary_key: true,
              is_nullable: false,
              is_unique: false,
              description: '订单主键',
            },
            {
              id: 'a3',
              name: 'total_amount',
              db_type: 'DECIMAL(10, 2)',
              code_type: 'float64',
              is_primary_key: false,
              is_nullable: false,
              is_unique: false,
              description: '总金额',
            },
          ],
        },
      ],
      relations: [
        {
          id: 'r1',
          source_entity_id: 'e_user',
          target_entity_id: 'e_order',
          cardinality: 'one_to_many',
        },
      ],
    }

    const code = toMermaid(design)
    assert.ok(code.includes('"用户" {'), '中文实体名「用户」应以双引号完整保留')
    assert.ok(code.includes('"订单" {'), '中文实体名「订单」应以双引号完整保留且不与「用户」冲突')
    assert.ok(code.includes('"用户" ||--o{ "订单" : "1:N"'))
    assert.ok(code.includes('DECIMAL(10-2) total_amount'), 'DECIMAL(10, 2) 应规范化为 DECIMAL(10-2)')
    assert.ok(code.includes('BIGINT_UNSIGNED id PK "用户主键 第一行"'), '多行描述应折叠为单行安全引号字符串')
  })

  it('infers FK badge on <entity>_id columns when target entity exists', () => {
    const design: ERDesign = {
      entities: [
        { id: 'u', name: 'users', attributes: [] },
        {
          id: 'o',
          name: 'orders',
          attributes: [
            {
              id: 'a_uid',
              name: 'user_id',
              db_type: 'BIGINT',
              code_type: 'uint64',
              is_primary_key: false,
              is_nullable: false,
              is_unique: false,
              description: '买家',
            },
          ],
        },
      ],
      relations: [],
    }

    const code = toMermaid(design)
    assert.ok(code.includes('BIGINT user_id FK "买家"'))
  })
})
