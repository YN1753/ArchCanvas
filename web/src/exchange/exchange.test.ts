import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { ERDesign } from '../types/dsl'
import {
  executeSchemaImport,
  getSchemaExporter,
  getSchemaImporter,
  listSchemaExporters,
  listSchemaImporters,
  registerSchemaExporter,
} from './registry'

const sampleDesign: ERDesign = {
  entities: [
    {
      id: 'ent_users',
      name: 'users',
      comment: '用户表',
      attributes: [
        {
          id: 'attr_id',
          name: 'id',
          db_type: 'BIGINT',
          code_type: 'int64',
          is_primary_key: true,
          is_nullable: false,
          is_unique: false,
          comment: '主键',
          description: '主键',
        },
        {
          id: 'attr_email',
          name: 'email',
          db_type: 'VARCHAR(128)',
          code_type: 'string',
          is_primary_key: false,
          is_nullable: false,
          is_unique: true,
          comment: '邮箱',
          description: '邮箱',
        },
      ],
    },
  ],
  relations: [],
}

describe('Schema Exchange Plugin Registry', () => {
  it('registers built-in sql, json, and mermaid exporters and sql/json importers', () => {
    assert.deepStrictEqual(
      listSchemaExporters().map((e) => e.id),
      ['sql', 'json', 'mermaid'],
    )
    assert.deepStrictEqual(
      listSchemaImporters().map((i) => i.id),
      ['sql', 'json'],
    )
  })

  it('round-trips SQL and JSON formats via registry plugins and validates schemas', () => {
    const sqlExporter = getSchemaExporter('sql')!
    const sqlImporter = getSchemaImporter('sql')!
    const ddl = sqlExporter.export(sampleDesign, { dialect: 'postgres' })
    assert.ok(ddl.includes('CREATE TABLE "users"'))
    assert.strictEqual(
      sqlExporter.buildFilename('demo', { dialect: 'postgres' }),
      'demo_postgres.sql',
    )

    const importedFromSql = executeSchemaImport(sqlImporter, ddl, { dialect: 'postgres' })
    assert.strictEqual(importedFromSql.design.entities[0].name, 'users')

    const jsonExporter = getSchemaExporter('json')!
    const jsonImporter = getSchemaImporter('json')!
    const jsonText = jsonExporter.export(sampleDesign)
    const importedFromJson = executeSchemaImport(jsonImporter, jsonText)
    assert.strictEqual(importedFromJson.design.entities[0].attributes.length, 2)

    const mermaidExporter = getSchemaExporter('mermaid')!
    assert.ok(mermaidExporter.export(sampleDesign).includes('erDiagram'))
  })

  it('supports open registration of custom exporter plugins without core edits', () => {
    registerSchemaExporter({
      id: 'dbml-test',
      label: 'DBML',
      tabLabel: '导出 DBML',
      fileExtension: '.dbml',
      mimeType: 'text/plain;charset=utf-8',
      supportsDialect: false,
      getDescription: () => 'DBML schema format',
      buildFilename: (base) => `${base}.dbml`,
      export: (d) => d.entities.map((e) => `Table ${e.name} {}`).join('\n'),
    })

    const custom = getSchemaExporter('dbml-test')
    assert.ok(custom)
    assert.strictEqual(custom.export(sampleDesign), 'Table users {}')
  })
})
