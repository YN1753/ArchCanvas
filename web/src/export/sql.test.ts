import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  entityToSQL,
  designToSQL,
  parseSQLToDesign,
  extractItemComment,
  splitTableItems,
  extractTableCommentFromPreamble,
} from './sql'
import type { Entity, ERDesign } from '../types/dsl'

describe('SQL Export & Reverse Parsing with Comment Preservation', () => {
  it('extractItemComment should accurately separate clean SQL from line and block comments', () => {
    const res1 = extractItemComment('"id" INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键')
    assert.strictEqual(res1.cleanSql, '"id" INTEGER PRIMARY KEY AUTOINCREMENT')
    assert.strictEqual(res1.comment, '自增主键')

    const res2 = extractItemComment('"id" INTEGER PRIMARY KEY AUTOINCREMENT -- 自增主键,')
    assert.strictEqual(res2.cleanSql, '"id" INTEGER PRIMARY KEY AUTOINCREMENT')
    assert.strictEqual(res2.comment, '自增主键')

    const res3 = extractItemComment('"username" TEXT NOT NULL, /* 登录账户名 */')
    assert.strictEqual(res3.cleanSql, '"username" TEXT NOT NULL')
    assert.strictEqual(res3.comment, '登录账户名')

    const res4 = extractItemComment('code VARCHAR(10) DEFAULT \'--\' NOT NULL -- 默认破折号')
    assert.strictEqual(res4.cleanSql, 'code VARCHAR(10) DEFAULT \'--\' NOT NULL')
    assert.strictEqual(res4.comment, '默认破折号')
  })

  it('splitTableItems should preserve trailing inline comments on column items', () => {
    const body = `
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, -- 唯一用户编号
      "username" TEXT NOT NULL, -- 登录用户名
      "email" TEXT UNIQUE -- 电子邮箱
    `
    const items = splitTableItems(body)
    assert.strictEqual(items.length, 3)
    assert.ok(items[0].includes('唯一用户编号'))
    assert.ok(items[1].includes('登录用户名'))
    assert.ok(items[2].includes('电子邮箱'))
  })

  it('extractTableCommentFromPreamble should recognize various table comment formats', () => {
    const p1 = '-- 表说明: 用户基础信息表\n'
    assert.strictEqual(extractTableCommentFromPreamble(p1), '用户基础信息表')

    const p2 = '-- 表注释: 财务流水账表\n'
    assert.strictEqual(extractTableCommentFromPreamble(p2), '财务流水账表')

    const p3 = '-- ====================\n-- 表说明: 商品核心表\n'
    assert.strictEqual(extractTableCommentFromPreamble(p3), '商品核心表')

    const p4 = '/* 表说明: 系统配置表 */\n'
    assert.strictEqual(extractTableCommentFromPreamble(p4), '系统配置表')

    const p5 = '-- 简短单行表注释\n'
    assert.strictEqual(extractTableCommentFromPreamble(p5), '简短单行表注释')
  })

  it('entityToSQL for SQLite should place commas before line comments', () => {
    const entity: Entity = {
      id: 'ent_1',
      name: 'users',
      comment: '系统用户表',
      attributes: [
        {
          id: 'attr_1',
          name: 'id',
          db_type: 'INTEGER',
          code_type: 'int',
          is_primary_key: true,
          is_nullable: false,
          is_unique: false,
          comment: '自增主键',
        },
        {
          id: 'attr_2',
          name: 'username',
          db_type: 'TEXT',
          code_type: 'string',
          is_primary_key: false,
          is_nullable: false,
          is_unique: true,
          comment: '用户名唯一',
        },
      ],
    }

    const ddl = entityToSQL(entity, 'sqlite')
    assert.ok(ddl.includes('-- 表说明: 系统用户表'))
    assert.ok(ddl.includes('"id" INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键'))
    assert.ok(ddl.includes('"username" TEXT NOT NULL UNIQUE -- 用户名唯一'))
  })

  it('parseSQLToDesign should preserve SQLite table and inline column comments', () => {
    const sqliteSql = `
      -- 表说明: 用户核心表
      CREATE TABLE IF NOT EXISTS "users" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT, -- 用户唯一标识
        "username" TEXT NOT NULL, -- 登录名称
        "email" TEXT UNIQUE -- 联系邮箱
      );

      -- 表说明: 订单主表
      CREATE TABLE IF NOT EXISTS "orders" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT, -- 订单号
        "user_id" INTEGER NOT NULL REFERENCES "users" ("id"), -- 所属买家
        "total_fee" REAL NOT NULL -- 支付总额
      );
    `

    const result = parseSQLToDesign(sqliteSql)
    assert.strictEqual(result.design.entities.length, 2)

    const userTable = result.design.entities.find((e) => e.name === 'users')
    assert.ok(userTable)
    assert.strictEqual(userTable.comment, '用户核心表')
    assert.strictEqual(userTable.attributes.length, 3)

    const idAttr = userTable.attributes.find((a) => a.name === 'id')
    assert.ok(idAttr)
    assert.strictEqual(idAttr.comment, '用户唯一标识')
    assert.strictEqual(idAttr.is_primary_key, true)

    const usernameAttr = userTable.attributes.find((a) => a.name === 'username')
    assert.ok(usernameAttr)
    assert.strictEqual(usernameAttr.comment, '登录名称')

    const emailAttr = userTable.attributes.find((a) => a.name === 'email')
    assert.ok(emailAttr)
    assert.strictEqual(emailAttr.comment, '联系邮箱')
    assert.strictEqual(emailAttr.is_unique, true)

    const orderTable = result.design.entities.find((e) => e.name === 'orders')
    assert.ok(orderTable)
    assert.strictEqual(orderTable.comment, '订单主表')

    const userIdAttr = orderTable.attributes.find((a) => a.name === 'user_id')
    assert.ok(userIdAttr)
    assert.strictEqual(userIdAttr.comment, '所属买家')

    // 验证外键关系构建
    assert.strictEqual(result.design.relations.length, 1)
    assert.strictEqual(result.design.relations[0].source_entity_id, userTable.id)
    assert.strictEqual(result.design.relations[0].target_entity_id, orderTable.id)
  })

  it('round-trip symmetry: SQLite export and import preserves schema and comments', () => {
    const originalDesign: ERDesign = {
      entities: [
        {
          id: 'ent_users',
          name: 'users',
          comment: '用户账号表',
          attributes: [
            {
              id: 'attr_1',
              name: 'id',
              db_type: 'INTEGER',
              code_type: 'int',
              is_primary_key: true,
              is_nullable: false,
              is_unique: false,
              comment: '主键自增',
            },
            {
              id: 'attr_2',
              name: 'phone',
              db_type: 'TEXT',
              code_type: 'string',
              is_primary_key: false,
              is_nullable: false,
              is_unique: true,
              comment: '绑定的手机号',
            },
          ],
        },
      ],
      relations: [],
    }

    const exportedSql = designToSQL(originalDesign, 'sqlite')
    const importedResult = parseSQLToDesign(exportedSql)

    assert.strictEqual(importedResult.design.entities.length, 1)
    const importedEntity = importedResult.design.entities[0]
    assert.strictEqual(importedEntity.name, 'users')
    assert.strictEqual(importedEntity.comment, '用户账号表')

    const importedId = importedEntity.attributes.find((a) => a.name === 'id')
    assert.ok(importedId)
    assert.strictEqual(importedId.comment, '主键自增')
    assert.strictEqual(importedId.is_primary_key, true)

    const importedPhone = importedEntity.attributes.find((a) => a.name === 'phone')
    assert.ok(importedPhone)
    assert.strictEqual(importedPhone.comment, '绑定的手机号')
    assert.strictEqual(importedPhone.is_unique, true)
  })

  it('round-trip symmetry: MySQL export and import preserves schema and comments', () => {
    const originalDesign: ERDesign = {
      entities: [
        {
          id: 'ent_products',
          name: 'products',
          comment: '商品信息表',
          attributes: [
            {
              id: 'attr_1',
              name: 'id',
              db_type: 'BIGINT',
              code_type: 'int',
              is_primary_key: true,
              is_nullable: false,
              is_unique: false,
              comment: '商品主键',
            },
            {
              id: 'attr_2',
              name: 'title',
              db_type: 'VARCHAR(255)',
              code_type: 'string',
              is_primary_key: false,
              is_nullable: false,
              is_unique: false,
              comment: '商品标题',
            },
          ],
        },
      ],
      relations: [],
    }

    const exportedSql = designToSQL(originalDesign, 'mysql')
    const importedResult = parseSQLToDesign(exportedSql)

    assert.strictEqual(importedResult.design.entities.length, 1)
    const importedEntity = importedResult.design.entities[0]
    assert.strictEqual(importedEntity.name, 'products')
    assert.strictEqual(importedEntity.comment, '商品信息表')

    const importedTitle = importedEntity.attributes.find((a) => a.name === 'title')
    assert.ok(importedTitle)
    assert.strictEqual(importedTitle.comment, '商品标题')
  })
})
