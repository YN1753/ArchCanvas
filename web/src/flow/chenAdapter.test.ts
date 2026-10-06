import assert from 'node:assert/strict'
import { getSelfLoopPath, toChenFlowElements, conceptualToChenFlowElements } from './chenAdapter'
import type { ERDesign, ConceptualDesign } from '../types/dsl'

function testGetSelfLoopPath() {
  // 1. 测试横向排版（默认 Dagre LR 布局：Entity 在左，Diamond 在右）
  const [topPath, tlx, tly] = getSelfLoopPath(255, 200, 480, 200, 'top')
  const [bottomPath, blx, bly] = getSelfLoopPath(480, 200, 255, 200, 'bottom')

  assert.ok(topPath.startsWith('M 255 200 C'), '顶部弧线起点正确')
  assert.ok(bottomPath.startsWith('M 480 200 C'), '底部弧线起点正确')
  assert.equal(tlx, 367.5, '顶部弧线中点 X 轴居中')
  assert.equal(blx, 367.5, '底部弧线中点 X 轴居中')
  assert.ok(tly < 200, '顶部弧线向上拱起 (Y 变小)')
  assert.ok(bly > 200, '底部弧线向下拱起 (Y 变大)')
  assert.ok(bly - tly > 80, `顶部与底部弧线之间净空充足 (当前间距: ${bly - tly}px)`)

  // 2. 测试纵向排版（上下分流）
  const [leftPath, llx, lly] = getSelfLoopPath(200, 200, 200, 450, 'top')
  const [rightPath, rlx, rly] = getSelfLoopPath(200, 450, 200, 200, 'bottom')
  assert.ok(llx < 200, '纵向顶部弧线向左分流')
  assert.ok(rlx > 200, '纵向底部弧线向右分流')
  assert.ok(rlx - llx > 60, '纵向分流净空充足')

  console.log('✓ getSelfLoopPath 几何曲率与分流计算测试通过')
}

function testToChenFlowElementsSelfRelation() {
  const design: ERDesign = {
    entities: [
      {
        id: 'dept',
        name: 'departments',
        comment: '部门表',
        attributes: [
          { id: 'dept_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '部门主键' },
          { id: 'dept_name', name: 'name', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '部门名称' },
          { id: 'dept_pid', name: 'parent_id', db_type: 'bigint', code_type: 'int64', is_primary_key: false, is_nullable: true, is_unique: false, description: '父级部门ID' },
        ],
      },
    ],
    relations: [
      {
        id: 'rel_dept_parent',
        source_entity_id: 'dept',
        target_entity_id: 'dept',
        cardinality: 'one_to_many',
      },
    ],
  }

  const { nodes, edges } = toChenFlowElements(design)

  // 1. 验证实体节点与属性椭圆存在
  const entityNode = nodes.find((n) => n.id === 'dept')
  assert.ok(entityNode, '实体节点存在')
  assert.equal(entityNode.type, 'chenEntity')

  // 2. 验证自引用菱形联系节点被成功创建，且未被丢弃
  const relationNode = nodes.find((n) => n.id === 'rel-rel_dept_parent')
  assert.ok(relationNode, '自引用菱形联系节点存在且未被硬过滤')
  assert.equal(relationNode.type, 'chenRelation')
  assert.equal((relationNode.data as any).name, '层级包含', '推导出自引用层级联系动词')
  assert.equal((relationNode.data as any).cardinality, 'one_to_many')

  // 3. 验证生成了双向回折的自环边
  const selfEdges = edges.filter((e) => e.data?.isSelfLoop)
  assert.equal(selfEdges.length, 2, '自引用生成两条专用环形边')

  const topEdge = selfEdges.find((e) => e.data?.loopDirection === 'top')
  const bottomEdge = selfEdges.find((e) => e.data?.loopDirection === 'bottom')
  assert.ok(topEdge, '包含顶部弧线出边')
  assert.ok(bottomEdge, '包含底部弧线回折入边')

  assert.equal(topEdge.source, 'dept')
  assert.equal(topEdge.target, 'rel-rel_dept_parent')
  assert.equal(topEdge.data?.cardinalityLabel, '1', '父级端基数标签为 1')

  assert.equal(bottomEdge.source, 'rel-rel_dept_parent')
  assert.equal(bottomEdge.target, 'dept')
  assert.equal(bottomEdge.data?.cardinalityLabel, 'N', '子级端基数标签为 N')

  console.log('✓ toChenFlowElements 物理转陈氏自引用关系测试通过')
}

function testConceptualToChenFlowElementsSelfRelation() {
  const conceptualDesign: ConceptualDesign = {
    domain_name: '组织架构',
    concepts: [
      {
        id: 'concept_dept',
        name: 'Department',
        display_name: '部门',
        description: '组织架构部门',
        business_rules: [],
        attributes: [
          { name: 'id', category: 'identifier', is_business_key: true, required: true, is_unique: true, description: '部门主键' },
          { name: 'name', category: 'descriptive', is_business_key: false, required: true, is_unique: false, description: '部门名称' },
        ],
      },
    ],
    relations: [
      {
        id: 'rel_concept_self',
        name: '层级包含',
        source_concept: 'Department',
        target_concept: 'Department',
        cardinality: 'one_to_many',
      },
    ],
  }

  const { nodes, edges } = conceptualToChenFlowElements(conceptualDesign)

  // 1. 验证概念节点存在
  const conceptNode = nodes.find((n) => n.id === 'concept_dept')
  assert.ok(conceptNode, '概念节点存在')

  // 2. 验证概念自引用菱形联系节点被生成
  const relationNode = nodes.find((n) => n.id === 'rel-rel_concept_self')
  assert.ok(relationNode, '概念自引用菱形节点存在')
  assert.equal((relationNode.data as any).name, '层级包含')

  // 3. 验证生成双弧自环边
  const selfEdges = edges.filter((e) => e.data?.isSelfLoop)
  assert.equal(selfEdges.length, 2, '概念自引用生成双向环形边')

  const topEdge = selfEdges.find((e) => e.data?.loopDirection === 'top')
  const bottomEdge = selfEdges.find((e) => e.data?.loopDirection === 'bottom')
  assert.ok(topEdge, '顶部弧线存在')
  assert.ok(bottomEdge, '底部弧线存在')
  assert.equal(topEdge.data?.cardinalityLabel, '1')
  assert.equal(bottomEdge.data?.cardinalityLabel, 'N')

  console.log('✓ conceptualToChenFlowElements 概念模型自引用关系测试通过')
}

function runAllTests() {
  console.log('--- 运行陈氏概念视图自引用关系（Unary Relationship）单元测试 ---')
  testGetSelfLoopPath()
  testToChenFlowElementsSelfRelation()
  testConceptualToChenFlowElementsSelfRelation()
  console.log('所有测试全部通过！\n')
}

runAllTests()
