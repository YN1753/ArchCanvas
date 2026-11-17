import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defaultCodeType } from '../types/dsl'
import { parseDesignJSON, validateDesign } from './dsl'

describe('ER DSL Validation & JSON Import Coercion', () => {
  it('defaultCodeType aligns signed and unsigned Go integer and binary types with backend model.go', () => {
    assert.equal(defaultCodeType('TINYINT(1)'), 'bool')
    assert.equal(defaultCodeType('BOOLEAN'), 'bool')
    assert.equal(defaultCodeType('BIGINT'), 'int64')
    assert.equal(defaultCodeType('BIGINT(20) UNSIGNED'), 'uint64')
    assert.equal(defaultCodeType('BIGSERIAL'), 'int64')
    assert.equal(defaultCodeType('TINYINT'), 'int8')
    assert.equal(defaultCodeType('TINYINT UNSIGNED'), 'uint8')
    assert.equal(defaultCodeType('SMALLINT'), 'int16')
    assert.equal(defaultCodeType('SMALLINT UNSIGNED'), 'uint16')
    assert.equal(defaultCodeType('INT'), 'int')
    assert.equal(defaultCodeType('INT(11) UNSIGNED'), 'uint')
    assert.equal(defaultCodeType('MEDIUMINT UNSIGNED'), 'uint')
    assert.equal(defaultCodeType('SERIAL'), 'int')
    assert.equal(defaultCodeType('DECIMAL(10,2)'), 'float64')
    assert.equal(defaultCodeType('DOUBLE PRECISION'), 'float64')
    assert.equal(defaultCodeType('TIMESTAMPTZ'), 'time.Time')
    assert.equal(defaultCodeType('VARBINARY(64)'), '[]byte')
    assert.equal(defaultCodeType('BINARY(16)'), '[]byte')
    assert.equal(defaultCodeType('BYTEA'), '[]byte')
    assert.equal(defaultCodeType('VARCHAR(128)'), 'string')
  })

  it('parseDesignJSON coerces scalar default_value (number/boolean) to string and unwraps { design }', () => {
    const rawJson = JSON.stringify({
      design: {
        entities: [
          {
            id: 'ent_1',
            name: 'users',
            attributes: [
              {
                id: 'a_1',
                name: 'id',
                db_type: 'BIGINT',
                code_type: 'uint64',
                is_primary_key: true,
                is_nullable: false,
                is_unique: true,
              },
              {
                id: 'a_2',
                name: 'status',
                db_type: 'TINYINT',
                code_type: 'int',
                is_primary_key: false,
                is_nullable: false,
                is_unique: false,
                default_value: 0,
              },
              {
                id: 'a_3',
                name: 'is_active',
                db_type: 'BOOLEAN',
                code_type: 'bool',
                is_primary_key: false,
                is_nullable: false,
                is_unique: false,
                default_value: true,
              },
            ],
          },
        ],
        relations: [],
      },
    })

    const parsed = parseDesignJSON(rawJson)
    assert.equal(parsed.entities.length, 1)
    assert.equal(parsed.entities[0].attributes[1].default_value, '0')
    assert.equal(parsed.entities[0].attributes[2].default_value, 'true')
  })

  it('validateDesign detects duplicate entity names, duplicate column names, and dangling relations', () => {
    const report = validateDesign({
      entities: [
        {
          id: 'e1',
          name: 'Users',
          attributes: [
            {
              id: 'a1',
              name: 'email',
              db_type: 'VARCHAR(64)',
              code_type: 'string',
              is_primary_key: false,
              is_nullable: false,
              is_unique: false,
              description: '',
            },
            {
              id: 'a2',
              name: 'EMAIL',
              db_type: 'VARCHAR(64)',
              code_type: 'string',
              is_primary_key: false,
              is_nullable: false,
              is_unique: false,
              description: '',
            },
          ],
        },
        {
          id: 'e2',
          name: 'users',
          attributes: [],
        },
      ],
      relations: [
        {
          id: 'r1',
          source_entity_id: 'e1',
          target_entity_id: 'missing_target',
          cardinality: 'one_to_many',
        },
      ],
    })

    assert.ok(report.errors.some((msg) => msg.includes('实体名重复')))
    assert.ok(report.errors.some((msg) => msg.includes('重复字段名')))
    assert.ok(report.errors.some((msg) => msg.includes('目标实体不存在')))
    assert.ok(report.warnings.some((msg) => msg.includes('没有主键')))
  })
})
