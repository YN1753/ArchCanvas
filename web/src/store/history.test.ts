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

// 5. 测试防抖窗口内输入后改回原值（空净变更自动弹出栈顶补丁）与陈氏排版重置撤销
{
  useStore.getState().resetHistory()
  useStore.setState({
    design: {
      entities: [
        {
          id: 'ent_revert_test',
          name: 'accounts',
          attributes: [],
        },
      ],
      relations: [],
    },
    chenPositions: { ent_revert_test: { x: 320, y: 180 } },
    selection: null,
  })

  assert.equal(useStore.getState().canUndo, false)

  // 600ms 防抖窗口内先改名再立刻改回原名，净补丁为空，必须自动弹出空历史项
  useStore.getState().renameEntity('ent_revert_test', 'accounts_temp')
  assert.equal(useStore.getState().canUndo, true)
  useStore.getState().renameEntity('ent_revert_test', 'accounts')
  assert.equal(useStore.getState().design.entities[0].name, 'accounts')
  assert.equal(useStore.getState().canUndo, false, '防抖窗口内改回原值后历史栈不应残留空补丁')

  // resetChenPositions 必须接入历史栈支持撤销与重做
  useStore.getState().resetChenPositions()
  assert.deepEqual(useStore.getState().chenPositions, {})
  assert.equal(useStore.getState().canUndo, true)

  useStore.getState().undo()
  assert.deepEqual(useStore.getState().chenPositions, { ent_revert_test: { x: 320, y: 180 } })

  useStore.getState().redo()
  assert.deepEqual(useStore.getState().chenPositions, {})

  console.log('✓ 防抖还原空补丁清理与陈氏排版重置 Undo/Redo 测试通过')
}

// 6. 测试飞行中保存并发修改保护（[P0-FE-01] mutationCount 防回滚 & saveNow 等待在途请求）
await (async () => {
  const originalFetch = globalThis.fetch
  try {
    let fetchCount = 0
    let resolveFirstSave: () => void = () => {}

    globalThis.fetch = (async (_input, init) => {
      fetchCount++
      const callIdx = fetchCount
      const body = JSON.parse(String(init?.body || '{}')) as {
        entities?: unknown[]
        relations?: unknown[]
      }
      if (callIdx === 1) {
        await new Promise<void>((r) => {
          resolveFirstSave = r
        })
      }
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: {
            design: {
              entities: body.entities || [],
              relations: body.relations || [],
            },
            warnings: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    useStore.getState().resetHistory()
    useStore.setState({
      project: {
        id: 'proj_concurrent_save',
        name: '并发保存测试项目',
        description: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      design: { entities: [], relations: [] },
      selection: null,
    })

    // 第一次修改并立即触发在途保存
    useStore.getState().addEntity({ x: 100, y: 100 })
    assert.equal(useStore.getState().design.entities.length, 1)
    const firstSavePromise = useStore.getState().flushSave()

    // 在第一次保存请求尚未返回（in-flight）期间，用户新增第二张表
    useStore.getState().addEntity({ x: 400, y: 100 })
    assert.equal(useStore.getState().design.entities.length, 2)

    // 放行第一次旧响应：绝不能将画布回滚回 1 张表，且 saveNow 必须等待全部落盘完成
    const saveNowPromise = useStore.getState().saveNow()
    resolveFirstSave?.()
    await Promise.all([firstSavePromise, saveNowPromise])

    assert.equal(useStore.getState().design.entities.length, 2, '飞行中旧响应不得覆盖并发新增的第二张实体表')
    assert.ok(fetchCount >= 2, '在途期间产生的第二次修改必须自动补发落盘请求')
    console.log('✓ 飞行中保存并发修改保护与 saveNow 等待落盘回归测试通过')
  } finally {
    globalThis.fetch = originalFetch
  }
})()

// 7. 测试官方只读样板工程在编辑落盘时自动触发 Copy-on-Write 沙盒克隆（SHOWCASE_MODE 保护）
await (async () => {
  const originalFetch = globalThis.fetch
  try {
    const calledPaths: string[] = []
    globalThis.fetch = (async (input, init) => {
      const url = String(input)
      calledPaths.push(url)
      if (url.endsWith('/projects/fork')) {
        return new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: {
              id: 'proj_forked_sandbox_copy',
              name: '电商交易履约系统 (沙盒副本)',
              description: '副本',
              is_template: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/projects/save-er-design')) {
        const body = JSON.parse(String(init?.body || '{}')) as { project_id: string; entities?: unknown[] }
        assert.equal(body.project_id, 'proj_forked_sandbox_copy', '严禁向只读官方样板 ID 直接发起写请求')
        return new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: { design: { entities: body.entities || [], relations: [] }, warnings: [] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ code: 200, message: 'success', data: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    useStore.getState().resetHistory()
    useStore.setState({
      project: {
        id: '01960000-0000-7000-8000-000000000001',
        name: '电商交易履约系统',
        description: '官方样板',
        is_template: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      design: { entities: [], relations: [] },
      selection: null,
    })

    useStore.getState().addEntity({ x: 160, y: 160 })
    await useStore.getState().saveNow()

    assert.equal(useStore.getState().project?.id, 'proj_forked_sandbox_copy', '编辑只读样板后应无缝切换至克隆副本')
    assert.equal(useStore.getState().project?.is_template, false)
    assert.ok(calledPaths.some((p) => p.endsWith('/projects/fork')))
    console.log('✓ 演示沙盒模式只读样板自动 Copy-on-Write 克隆保存测试通过')
  } finally {
    globalThis.fetch = originalFetch
  }
})()

// 清理防抖保存定时器，防止阻塞测试进程退出
useStore.getState().resetHistory()
useStore.setState({ project: null })

console.log('History Slice 全部集成测试通过！\n')
