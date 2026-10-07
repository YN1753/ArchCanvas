import assert from 'node:assert/strict'
import { useStore } from './erStore'

console.log('--- 运行 History Slice 撤销重做增量补丁集成测试 ---')

// 保证初始状态干净
useStore.getState().resetHistory()
useStore.setState({
  design: { entities: [], relations: [] },
  selection: null,
})

// 1. 测试添加实体与撤销/重做
{
  assert.equal(useStore.getState().canUndo, false)
  assert.equal(useStore.getState().canRedo, false)

  // 添加实体表
  useStore.getState().addEntity({ x: 100, y: 100 })
  assert.equal(useStore.getState().design.entities.length, 1)
  assert.equal(useStore.getState().canUndo, true)
  assert.equal(useStore.getState().canRedo, false)

  const addedId = useStore.getState().design.entities[0].id

  // 撤销添加
  useStore.getState().undo()
  assert.equal(useStore.getState().design.entities.length, 0)
  assert.equal(useStore.getState().canUndo, false)
  assert.equal(useStore.getState().canRedo, true)

  // 重做添加
  useStore.getState().redo()
  assert.equal(useStore.getState().design.entities.length, 1)
  assert.equal(useStore.getState().design.entities[0].id, addedId)
  assert.equal(useStore.getState().canUndo, true)
  assert.equal(useStore.getState().canRedo, false)

  console.log('✓ 实体新增/撤销/重做集成测试通过')
}

// 2. 测试实体更名与防抖合并撤销
{
  const entityId = useStore.getState().design.entities[0].id
  const originalName = useStore.getState().design.entities[0].name

  // 模拟键盘连续敲击：防抖窗口内
  useStore.getState().renameEntity(entityId, 'users_step1')
  useStore.getState().renameEntity(entityId, 'users_step2')
  useStore.getState().renameEntity(entityId, 'users_final')

  assert.equal(useStore.getState().design.entities[0].name, 'users_final')

  // 单次撤销应直接回滚到敲击序列发生之前的原始名称
  useStore.getState().undo()
  assert.equal(useStore.getState().design.entities[0].name, originalName)
  assert.equal(useStore.getState().canRedo, true)

  // 单次重做应恢复为最终名称
  useStore.getState().redo()
  assert.equal(useStore.getState().design.entities[0].name, 'users_final')

  console.log('✓ 防抖合并更新撤销/重做集成测试通过')
}

// 3. 测试实体删除与级联关系撤销
{
  const entityId = useStore.getState().design.entities[0].id
  const currentEntity = useStore.getState().design.entities[0]

  useStore.getState().deleteEntity(entityId)
  assert.equal(useStore.getState().design.entities.length, 0)
  assert.equal(useStore.getState().canUndo, true)

  // 撤销删除
  useStore.getState().undo()
  assert.equal(useStore.getState().design.entities.length, 1)
  assert.equal(useStore.getState().design.entities[0].id, entityId)
  assert.equal(useStore.getState().design.entities[0].name, currentEntity.name)

  console.log('✓ 实体删除与撤销完整性集成测试通过')
}

// 4. 测试概念模型（陈氏 ER）的新增与撤销/重做
{
  useStore.getState().resetHistory()
  useStore.setState({
    conceptualDesign: { concepts: [], relations: [] },
    selection: null,
  })

  assert.equal(useStore.getState().canUndo, false)
  assert.equal(useStore.getState().canRedo, false)

  // 添加业务概念
  useStore.getState().addConcept({ x: 200, y: 200 })
  assert.equal(useStore.getState().conceptualDesign.concepts.length, 1)
  assert.equal(useStore.getState().canUndo, true)
  assert.equal(useStore.getState().canRedo, false)

  const conceptId = useStore.getState().conceptualDesign.concepts[0].id

  // 撤销添加业务概念
  useStore.getState().undo()
  assert.equal(useStore.getState().conceptualDesign.concepts.length, 0)
  assert.equal(useStore.getState().canUndo, false)
  assert.equal(useStore.getState().canRedo, true)

  // 重做添加业务概念
  useStore.getState().redo()
  assert.equal(useStore.getState().conceptualDesign.concepts.length, 1)
  assert.equal(useStore.getState().conceptualDesign.concepts[0].id, conceptId)
  assert.equal(useStore.getState().canUndo, true)

  // 连续修改概念展示名（测试概念级防抖合并）
  useStore.getState().updateConcept(conceptId!, { display_name: '用户A' })
  useStore.getState().updateConcept(conceptId!, { display_name: '用户B' })
  useStore.getState().updateConcept(conceptId!, { display_name: '用户最终态' })
  assert.equal(useStore.getState().conceptualDesign.concepts[0].display_name, '用户最终态')

  // 撤销应回到修改前
  useStore.getState().undo()
  assert.equal(useStore.getState().conceptualDesign.concepts[0].display_name, '新概念')

  // 重做恢复为用户最终态
  useStore.getState().redo()
  assert.equal(useStore.getState().conceptualDesign.concepts[0].display_name, '用户最终态')

  // 添加第二个概念并建立关联
  useStore.getState().addConcept({ x: 400, y: 200 })
  assert.equal(useStore.getState().conceptualDesign.concepts.length, 2)
  const concept2Name = useStore.getState().conceptualDesign.concepts[1].name
  const concept1Name = useStore.getState().conceptualDesign.concepts[0].name

  useStore.getState().addConceptRelation(concept1Name, concept2Name)
  assert.equal(useStore.getState().conceptualDesign.relations.length, 1)

  // 撤销关系添加
  useStore.getState().undo()
  assert.equal(useStore.getState().conceptualDesign.relations.length, 0)

  // 重做关系添加
  useStore.getState().redo()
  assert.equal(useStore.getState().conceptualDesign.relations.length, 1)

  console.log('✓ 概念模型（陈氏 ER）新增/修改/关联与撤销/重做集成测试通过')
}

console.log('History Slice 全部集成测试通过！\n')
