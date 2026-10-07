import assert from 'node:assert/strict'
import type { ERDesign, Entity } from '../types/dsl'
import {
  applyPatch,
  createPatch,
  escapePointer,
  invertPatch,
  parsePointer,
  unescapePointer,
} from './patch'

console.log('--- 运行 JSON Patch 差异引擎单元测试 ---')

// 1. JSON Pointer 路径解析测试
{
  assert.equal(escapePointer('user/name~1'), 'user~1name~01')
  assert.equal(unescapePointer('user~1name~01'), 'user/name~1')
  assert.deepEqual(parsePointer('/entities/0/name'), ['entities', '0', 'name'])
  assert.deepEqual(parsePointer('/'), [])
  assert.deepEqual(parsePointer(''), [])
  console.log('✓ JSON Pointer 字符转义与段解析测试通过')
}

// 2. 基础对象属性与标量字段变动
{
  const before = {
    name: 'users',
    count: 10,
    active: true,
  }
  const after = {
    name: 'accounts',
    count: 20,
    active: false,
  }

  const forward = createPatch(before, after)
  assert.equal(forward.length, 3)
  assert.deepEqual(applyPatch(before, forward), after)

  const inverse = invertPatch(forward)
  assert.deepEqual(applyPatch(after, inverse), before)
  console.log('✓ 标量字段与基础对象属性 Diff/Patch/Invert 测试通过')
}

// 3. 实体表坐标微调（高频拖拽场景验证）
{
  const designBefore: ERDesign = {
    entities: [
      {
        id: 'ent_1',
        name: 'users',
        position: { x: 100, y: 200 },
        attributes: [
          {
            id: 'attr_1',
            name: 'id',
            db_type: 'BIGINT',
            code_type: 'uint64',
            is_primary_key: true,
            is_nullable: false,
            is_unique: false,
            description: '',
          },
        ],
      },
      {
        id: 'ent_2',
        name: 'posts',
        position: { x: 400, y: 200 },
        attributes: [],
      },
    ],
    relations: [],
  }

  // 仅修改 ent_1 坐标
  const designAfter: ERDesign = {
    ...designBefore,
    entities: [
      {
        ...designBefore.entities[0],
        position: { x: 150, y: 220 },
      },
      designBefore.entities[1],
    ],
  }

  const patches = createPatch(designBefore, designAfter)
  // 仅产生了针对 position.x 与 position.y 的微量补丁
  assert.equal(patches.length, 2)
  assert.ok(patches.some((p) => p.path === '/entities/0/position/x' && p.value === 150))
  assert.ok(patches.some((p) => p.path === '/entities/0/position/y' && p.value === 220))

  // 正向应用验证
  assert.deepEqual(applyPatch(designBefore, patches), designAfter)

  // 逆向撤销验证
  const undoPatches = invertPatch(patches)
  assert.deepEqual(applyPatch(designAfter, undoPatches), designBefore)
  console.log('✓ 节点拖拽高频坐标微调 Diff 极简 Patch 验证通过')
}

// 4. 字段增删与实体表增删
{
  const baseDesign: ERDesign = {
    entities: [
      {
        id: 'ent_1',
        name: 'users',
        attributes: [
          {
            id: 'attr_1',
            name: 'id',
            db_type: 'BIGINT',
            code_type: 'uint64',
            is_primary_key: true,
            is_nullable: false,
            is_unique: false,
            description: '',
          },
        ],
      },
    ],
    relations: [],
  }

  // 4.1 新增字段
  const withNewAttr: ERDesign = {
    ...baseDesign,
    entities: [
      {
        ...baseDesign.entities[0],
        attributes: [
          ...baseDesign.entities[0].attributes,
          {
            id: 'attr_2',
            name: 'email',
            db_type: 'VARCHAR(255)',
            code_type: 'string',
            is_primary_key: false,
            is_nullable: false,
            is_unique: true,
            description: '',
          },
        ],
      },
    ],
  }

  const addAttrPatches = createPatch(baseDesign, withNewAttr)
  assert.equal(addAttrPatches.length, 1)
  assert.equal(addAttrPatches[0].op, 'add')
  assert.equal(addAttrPatches[0].path, '/entities/0/attributes/1')
  assert.deepEqual(applyPatch(baseDesign, addAttrPatches), withNewAttr)
  assert.deepEqual(applyPatch(withNewAttr, invertPatch(addAttrPatches)), baseDesign)

  // 4.2 删除字段
  const delAttrPatches = createPatch(withNewAttr, baseDesign)
  assert.equal(delAttrPatches.length, 1)
  assert.equal(delAttrPatches[0].op, 'remove')
  assert.equal(delAttrPatches[0].path, '/entities/0/attributes/1')
  assert.deepEqual(applyPatch(withNewAttr, delAttrPatches), baseDesign)
  assert.deepEqual(applyPatch(baseDesign, invertPatch(delAttrPatches)), withNewAttr)

  // 4.3 新增实体表
  const newEntity: Entity = {
    id: 'ent_new',
    name: 'orders',
    attributes: [],
  }
  const withNewEntity: ERDesign = {
    ...baseDesign,
    entities: [...baseDesign.entities, newEntity],
  }

  const addEntityPatches = createPatch(baseDesign, withNewEntity)
  assert.equal(addEntityPatches.length, 1)
  assert.equal(addEntityPatches[0].op, 'add')
  assert.equal(addEntityPatches[0].path, '/entities/1')
  assert.deepEqual(applyPatch(baseDesign, addEntityPatches), withNewEntity)
  assert.deepEqual(applyPatch(withNewEntity, invertPatch(addEntityPatches)), baseDesign)

  // 4.4 删除实体表
  const delEntityPatches = createPatch(withNewEntity, baseDesign)
  assert.equal(delEntityPatches.length, 1)
  assert.equal(delEntityPatches[0].op, 'remove')
  assert.equal(delEntityPatches[0].path, '/entities/1')
  assert.deepEqual(applyPatch(withNewEntity, delEntityPatches), baseDesign)
  assert.deepEqual(applyPatch(baseDesign, invertPatch(delEntityPatches)), withNewEntity)

  console.log('✓ 字段与实体表增删单项 Patch 精确匹配与对称回滚测试通过')
}

// 5. 关系（Relations）增删
{
  const designWithoutRel: ERDesign = {
    entities: [
      { id: 'e1', name: 'users', attributes: [] },
      { id: 'e2', name: 'orders', attributes: [] },
    ],
    relations: [],
  }

  const designWithRel: ERDesign = {
    ...designWithoutRel,
    relations: [
      {
        id: 'rel_1',
        source_entity_id: 'e1',
        target_entity_id: 'e2',
        cardinality: 'one_to_many',
      },
    ],
  }

  const relPatches = createPatch(designWithoutRel, designWithRel)
  assert.equal(relPatches.length, 1)
  assert.equal(relPatches[0].op, 'add')
  assert.equal(relPatches[0].path, '/relations/0')
  assert.deepEqual(applyPatch(designWithoutRel, relPatches), designWithRel)
  assert.deepEqual(applyPatch(designWithRel, invertPatch(relPatches)), designWithoutRel)
  console.log('✓ 实体关联关系增删 Patch 验证通过')
}

// 6. 全量替换（如 SQL 导入）
{
  const oldDesign: ERDesign = {
    entities: [{ id: 'e1', name: 'old', attributes: [] }],
    relations: [],
  }
  const newImportedDesign: ERDesign = {
    entities: [
      { id: 'n1', name: 't1', attributes: [] },
      { id: 'n2', name: 't2', attributes: [] },
      { id: 'n3', name: 't3', attributes: [] },
    ],
    relations: [
      { id: 'r1', source_entity_id: 'n1', target_entity_id: 'n2', cardinality: 'one_to_many' },
    ],
  }

  const importPatches = createPatch(oldDesign, newImportedDesign)
  assert.deepEqual(applyPatch(oldDesign, importPatches), newImportedDesign)
  assert.deepEqual(applyPatch(newImportedDesign, invertPatch(importPatches)), oldDesign)
  console.log('✓ 全量替换与多实体批量导入 Diff/Patch 验证通过')
}

console.log('JSON Patch 全部单元测试通过！\n')
