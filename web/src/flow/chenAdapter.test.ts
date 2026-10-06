import assert from 'node:assert/strict'
import {
  getSelfLoopPath,
  toChenFlowElements,
  conceptualToChenFlowElements,
  detectJunctionTable,
} from './chenAdapter'
import type { ERDesign, ConceptualDesign, Entity } from '../types/dsl'

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

function testDetectJunctionTableTechnical() {
  const allEntities: Entity[] = [
    {
      id: 'ent_user',
      name: 'users',
      attributes: [{ id: 'u_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '主键' }],
    },
    {
      id: 'ent_role',
      name: 'roles',
      attributes: [{ id: 'r_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '主键' }],
    },
  ]

  // 1. 包含主键、两端外键与技术审计字段的纯中间表
  const pureJunction: Entity = {
    id: 'ent_user_role',
    name: 'user_roles',
    attributes: [
      { id: 'ur_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '主键' },
      { id: 'ur_uid', name: 'user_id', db_type: 'bigint', code_type: 'int64', is_primary_key: false, is_nullable: false, is_unique: false, description: '用户ID' },
      { id: 'ur_rid', name: 'role_id', db_type: 'bigint', code_type: 'int64', is_primary_key: false, is_nullable: false, is_unique: false, description: '角色ID' },
      { id: 'ur_cat', name: 'created_at', db_type: 'datetime', code_type: 'time', is_primary_key: false, is_nullable: false, is_unique: false, description: '创建时间' },
    ],
  }

  const res1 = detectJunctionTable(pureJunction, [...allEntities, pureJunction])
  assert.equal(res1.isJunction, true, '纯技术中间表应被识别为 true')
  assert.equal(res1.leftEntity?.id, 'ent_user')
  assert.equal(res1.rightEntity?.id, 'ent_role')

  // 2. 复合主键纯中间表
  const compositePkJunction: Entity = {
    id: 'ent_article_tag',
    name: 'article_tags',
    attributes: [
      { id: 'at_aid', name: 'article_id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: false, description: '文章ID' },
      { id: 'at_tid', name: 'tag_id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: false, description: '标签ID' },
    ],
  }
  const artEntities: Entity[] = [
    { id: 'ent_art', name: 'articles', attributes: [] },
    { id: 'ent_tag', name: 'tags', attributes: [] },
  ]
  const res2 = detectJunctionTable(compositePkJunction, [...artEntities, compositePkJunction])
  assert.equal(res2.isJunction, true, '复合主键纯中间表应被识别为 true')

  console.log('✓ detectJunctionTable 纯技术中间表识别测试通过')
}

function testDetectJunctionTableAssociativeEntity() {
  const allEntities: Entity[] = [
    { id: 'ent_order', name: 'orders', attributes: [] },
    { id: 'ent_item', name: 'items', attributes: [] },
  ]

  // order_items 拥有独立业务字段：unit_price, quantity, discount_rate（业务字段数 = 3 > 1）
  const orderItems: Entity = {
    id: 'ent_order_item',
    name: 'order_items',
    attributes: [
      { id: 'oi_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '主键' },
      { id: 'oi_oid', name: 'order_id', db_type: 'bigint', code_type: 'int64', is_primary_key: false, is_nullable: false, is_unique: false, description: '订单ID' },
      { id: 'oi_iid', name: 'item_id', db_type: 'bigint', code_type: 'int64', is_primary_key: false, is_nullable: false, is_unique: false, description: '商品ID' },
      { id: 'oi_price', name: 'unit_price', db_type: 'decimal(10,2)', code_type: 'float64', is_primary_key: false, is_nullable: false, is_unique: false, description: '单价' },
      { id: 'oi_qty', name: 'quantity', db_type: 'int', code_type: 'int', is_primary_key: false, is_nullable: false, is_unique: false, description: '购买数量' },
      { id: 'oi_disc', name: 'discount_rate', db_type: 'decimal(5,2)', code_type: 'float64', is_primary_key: false, is_nullable: true, is_unique: false, description: '折扣' },
      { id: 'oi_cat', name: 'created_at', db_type: 'datetime', code_type: 'time', is_primary_key: false, is_nullable: false, is_unique: false, description: '创建时间' },
    ],
  }

  const res = detectJunctionTable(orderItems, [...allEntities, orderItems])
  assert.equal(res.isJunction, false, '包含多个独立业务字段的关联实体不应被误判为技术中间表')
  assert.ok((res.businessFieldCount ?? 0) >= 3, '业务字段数统计应 >= 3')

  // 验证在 toChenFlowElements 中，该关联实体被保留为完整实体矩形，而非折叠为单一菱形
  const design: ERDesign = {
    entities: [...allEntities, orderItems],
    relations: [
      { id: 'rel_1', source_entity_id: 'ent_order', target_entity_id: 'ent_order_item', cardinality: 'one_to_many' },
      { id: 'rel_2', source_entity_id: 'ent_item', target_entity_id: 'ent_order_item', cardinality: 'one_to_many' },
    ],
  }
  const { nodes } = toChenFlowElements(design)
  const orderItemNode = nodes.find((n) => n.id === 'ent_order_item')
  assert.ok(orderItemNode, '关联实体矩形节点必须在陈氏概念图中完整保留')
  assert.equal(orderItemNode.type, 'chenEntity')

  const priceAttrNode = nodes.find((n) => n.id === 'attr-ent_order_item-oi_price')
  assert.ok(priceAttrNode, '关联实体的业务属性椭圆必须完整保留')

  console.log('✓ detectJunctionTable 关联实体（带业务字段）保护测试通过')
}

function testDetectJunctionTableUserOverride() {
  const allEntities: Entity[] = [
    { id: 'ent_user', name: 'users', attributes: [] },
    { id: 'ent_role', name: 'roles', attributes: [] },
  ]

  // 1. 用户显式设置 is_junction_table: false（强制保留）
  const userRoleEntity: Entity = {
    id: 'ent_user_role',
    name: 'user_roles',
    is_junction_table: false,
    attributes: [
      { id: 'ur_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '主键' },
      { id: 'ur_uid', name: 'user_id', db_type: 'bigint', code_type: 'int64', is_primary_key: false, is_nullable: false, is_unique: false, description: '用户ID' },
      { id: 'ur_rid', name: 'role_id', db_type: 'bigint', code_type: 'int64', is_primary_key: false, is_nullable: false, is_unique: false, description: '角色ID' },
    ],
  }
  const res1 = detectJunctionTable(userRoleEntity, [...allEntities, userRoleEntity])
  assert.equal(res1.isJunction, false, '用户显式配置 is_junction_table: false 时绝不折叠')

  // 2. 用户显式设置 is_junction_table: true（强制折叠，即使业务字段数 > 1）
  const richEntity: Entity = {
    id: 'ent_user_role_rich',
    name: 'user_roles',
    is_junction_table: true,
    attributes: [
      { id: 'ur_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '主键' },
      { id: 'ur_uid', name: 'user_id', db_type: 'bigint', code_type: 'int64', is_primary_key: false, is_nullable: false, is_unique: false, description: '用户ID' },
      { id: 'ur_rid', name: 'role_id', db_type: 'bigint', code_type: 'int64', is_primary_key: false, is_nullable: false, is_unique: false, description: '角色ID' },
      { id: 'ur_status', name: 'status', db_type: 'varchar(32)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '状态' },
      { id: 'ur_exp', name: 'expire_at', db_type: 'datetime', code_type: 'time', is_primary_key: false, is_nullable: true, is_unique: false, description: '过期时间' },
    ],
  }
  const res2 = detectJunctionTable(richEntity, [...allEntities, richEntity])
  assert.equal(res2.isJunction, true, '用户显式配置 is_junction_table: true 时强制折叠')

  console.log('✓ detectJunctionTable 用户显式覆盖配置测试通过')
}

function runAllTests() {
  console.log('--- 运行陈氏概念视图自引用关系与中间表判定单元测试 ---')
  testGetSelfLoopPath()
  testToChenFlowElementsSelfRelation()
  testConceptualToChenFlowElementsSelfRelation()
  testDetectJunctionTableTechnical()
  testDetectJunctionTableAssociativeEntity()
  testDetectJunctionTableUserOverride()
  console.log('所有测试全部通过！\n')
}

runAllTests()
