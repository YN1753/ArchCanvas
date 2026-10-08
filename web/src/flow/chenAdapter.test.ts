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

function testChen2DCompactLayout() {
  const design: ERDesign = {
    entities: [
      {
        id: 'ent_tenant',
        name: 'tenants',
        attributes: [
          { id: 't_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '租户主键' },
          { id: 't_name', name: 'name', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '租户名称' },
        ],
      },
      {
        id: 'ent_dept',
        name: 'departments',
        attributes: [
          { id: 'd_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '部门主键' },
          { id: 'd_name', name: 'name', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '部门名称' },
        ],
      },
      {
        id: 'ent_user',
        name: 'users',
        attributes: [
          { id: 'u_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '用户主键' },
          { id: 'u_name', name: 'username', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '用户名' },
          { id: 'u_phone', name: 'phone', db_type: 'varchar(32)', code_type: 'string', is_primary_key: false, is_nullable: true, is_unique: false, description: '手机号' },
          { id: 'u_email', name: 'email', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: true, is_unique: false, description: '邮箱' },
        ],
      },
      {
        id: 'ent_role',
        name: 'roles',
        attributes: [
          { id: 'r_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '角色主键' },
          { id: 'r_name', name: 'name', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '角色名称' },
        ],
      },
      {
        id: 'ent_perm',
        name: 'permissions',
        attributes: [
          { id: 'p_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '权限主键' },
          { id: 'p_name', name: 'name', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '权限名称' },
        ],
      },
    ],
    relations: [
      { id: 'rel_t_u', source_entity_id: 'ent_tenant', target_entity_id: 'ent_user', cardinality: 'one_to_many' },
      { id: 'rel_t_d', source_entity_id: 'ent_tenant', target_entity_id: 'ent_dept', cardinality: 'one_to_many' },
      { id: 'rel_d_u', source_entity_id: 'ent_dept', target_entity_id: 'ent_user', cardinality: 'one_to_many' },
      { id: 'rel_u_r', source_entity_id: 'ent_user', target_entity_id: 'ent_role', cardinality: 'many_to_many' },
      { id: 'rel_r_p', source_entity_id: 'ent_role', target_entity_id: 'ent_perm', cardinality: 'many_to_many' },
    ],
  }

  const { nodes, edges } = toChenFlowElements(design)

  // 1. 验证实体与菱形全部生成
  const userNode = nodes.find((n) => n.id === 'ent_user')!
  const tenantNode = nodes.find((n) => n.id === 'ent_tenant')!
  const deptNode = nodes.find((n) => n.id === 'ent_dept')!
  const roleNode = nodes.find((n) => n.id === 'ent_role')!
  const permNode = nodes.find((n) => n.id === 'ent_perm')!

  assert.ok(userNode && tenantNode && deptNode && roleNode && permNode, '所有 5 个核心实体存在')

  // 2. 验证 2D 拓扑聚类排版（用户居中置顶，左侧组织，右侧权限）
  assert.equal(userNode.position.y, tenantNode.position.y, '用户与租户在第一排')
  assert.equal(userNode.position.y, roleNode.position.y, '用户与角色在第一排')
  assert.ok(tenantNode.position.x < userNode.position.x, '租户在用户左侧')
  assert.ok(userNode.position.x < roleNode.position.x, '角色在用户右侧')

  assert.ok(deptNode.position.y > tenantNode.position.y, '部门在租户正下方')
  assert.equal(deptNode.position.x, tenantNode.position.x, '部门与租户同列')

  assert.ok(permNode.position.y > roleNode.position.y, '权限在角色正下方')
  assert.equal(permNode.position.x, roleNode.position.x, '权限与角色同列')

  // 3. 验证 2D 画布视口紧凑，彻底告别单向流水线拉伸（宽度在 1200px 以内，高在 600px 以内，宽高比 ~1.8）
  const xs = nodes.map((n) => n.position.x)
  const ys = nodes.map((n) => n.position.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const totalWidth = maxX - minX + 150
  const totalHeight = maxY - minY + 52
  const aspectRatio = totalWidth / totalHeight

  assert.ok(totalWidth <= 1300, `画布总宽度紧凑: ${totalWidth}px <= 1300px`)
  assert.ok(aspectRatio >= 1.4 && aspectRatio <= 2.5, `宽高比符合宽屏舒适视野: ${aspectRatio.toFixed(2)}`)

  // 4. 验证就近动态 Handle：纵向关系走上下，横向关系走左右
  // 租户 ── 下属部门 ── 部门（垂直向下）
  const edgeTenantToDia = edges.find((e) => e.source === 'ent_tenant' && e.target === 'rel-rel_t_d')!
  const edgeDiaToDept = edges.find((e) => e.source === 'rel-rel_t_d' && e.target === 'ent_dept')!
  assert.equal(edgeTenantToDia.sourceHandle, 'bottom-source', '垂直关系源端从底部出')
  assert.equal(edgeTenantToDia.targetHandle, 'top-target', '垂直关系菱形从顶部入')
  assert.equal(edgeDiaToDept.sourceHandle, 'bottom-source', '垂直关系菱形从底部出')
  assert.equal(edgeDiaToDept.targetHandle, 'top-target', '垂直关系宿端从顶部入')

  // 租户 ── 所属租户 ── 用户（水平向右）
  const edgeTenantToRelU = edges.find((e) => e.source === 'ent_tenant' && e.target === 'rel-rel_t_u')!
  const edgeRelUToUser = edges.find((e) => e.source === 'rel-rel_t_u' && e.target === 'ent_user')!
  assert.equal(edgeTenantToRelU.sourceHandle, 'right-source', '水平关系源端从右侧出')
  assert.equal(edgeTenantToRelU.targetHandle, 'left-target', '水平关系菱形从左侧入')
  assert.equal(edgeRelUToUser.sourceHandle, 'right-source', '水平关系菱形从右侧出')
  assert.equal(edgeRelUToUser.targetHandle, 'left-target', '水平关系宿端从左侧入')

  // 5. 验证外侧属性吸附（用户属性在正上方，不遮挡下方去往各表的连线）
  const userAttrNodes = nodes.filter((n) => n.type === 'chenAttribute' && (n.data as any).entityId === 'ent_user')
  assert.ok(userAttrNodes.length > 0, '用户属性存在')
  for (const an of userAttrNodes) {
    assert.ok(an.position.y < userNode.position.y, '用户属性全部整齐排布在用户实体正上方')
  }

  console.log('✓ toChenFlowElements 2D 拓扑感知聚类布局与动态最近 Handle 测试通过')
}

function testChenZeroOverlapForMultiEntities() {
  // 构建 6 实体企业架构（租户、部门、用户、角色、权限、岗位）
  const design: ERDesign = {
    entities: [
      {
        id: 'ent_tenant',
        name: 'tenant',
        comment: '企业租户',
        attributes: [
          { id: 't_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '租户主键' },
          { id: 't_name', name: 'name', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '企业名称' },
        ],
      },
      {
        id: 'ent_dept',
        name: 'department',
        comment: '组织部门',
        attributes: [
          { id: 'd_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '部门主键' },
          { id: 'd_name', name: 'name', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '部门名称' },
        ],
      },
      {
        id: 'ent_user',
        name: 'user',
        comment: '企业用户',
        attributes: [
          { id: 'u_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '用户主键' },
          { id: 'u_name', name: 'username', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '用户名' },
        ],
      },
      {
        id: 'ent_role',
        name: 'role',
        comment: '业务角色',
        attributes: [
          { id: 'r_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '角色主键' },
          { id: 'r_code', name: 'code', db_type: 'varchar(32)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '角色标识' },
        ],
      },
      {
        id: 'ent_perm',
        name: 'permission',
        comment: '系统权限',
        attributes: [
          { id: 'p_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '权限主键' },
          { id: 'p_key', name: 'key', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '权限KEY' },
        ],
      },
      {
        id: 'ent_pos',
        name: 'position',
        comment: '组织岗位',
        attributes: [
          { id: 'pos_id', name: 'id', db_type: 'bigint', code_type: 'int64', is_primary_key: true, is_nullable: false, is_unique: true, description: '岗位主键' },
          { id: 'pos_title', name: 'title', db_type: 'varchar(64)', code_type: 'string', is_primary_key: false, is_nullable: false, is_unique: false, description: '岗位头衔' },
        ],
      },
    ],
    relations: [
      { id: 'rel_t_d', source_entity_id: 'ent_tenant', target_entity_id: 'ent_dept', cardinality: 'one_to_many' },
      { id: 'rel_t_u', source_entity_id: 'ent_tenant', target_entity_id: 'ent_user', cardinality: 'one_to_many' },
      { id: 'rel_d_u', source_entity_id: 'ent_dept', target_entity_id: 'ent_user', cardinality: 'one_to_many' },
      { id: 'rel_u_r', source_entity_id: 'ent_user', target_entity_id: 'ent_role', cardinality: 'many_to_many' },
      { id: 'rel_r_p', source_entity_id: 'ent_role', target_entity_id: 'ent_perm', cardinality: 'many_to_many' },
      { id: 'rel_u_pos', source_entity_id: 'ent_user', target_entity_id: 'ent_pos', cardinality: 'many_to_one' },
    ],
  }

  const { nodes } = toChenFlowElements(design)

  const getNodeSize = (type?: string) => {
    if (type === 'chenEntity') return { w: 150, h: 52 }
    if (type === 'chenRelation') return { w: 108, h: 68 }
    if (type === 'chenAttribute') return { w: 76, h: 28 }
    return { w: 100, h: 50 }
  }

  const collisions: string[] = []

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    const sizeA = getNodeSize(a.type)
    const cxA = a.position.x + sizeA.w / 2
    const cyA = a.position.y + sizeA.h / 2

    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const sizeB = getNodeSize(b.type)
      const cxB = b.position.x + sizeB.w / 2
      const cyB = b.position.y + sizeB.h / 2

      const overlapX = (sizeA.w + sizeB.w) / 2 - Math.abs(cxA - cxB)
      const overlapY = (sizeA.h + sizeB.h) / 2 - Math.abs(cyA - cyB)

      // 只要 X 轴与 Y 轴均产生穿透（即包围盒重叠），则判定为碰撞
      if (overlapX > 0 && overlapY > 0) {
        collisions.push(
          `节点碰撞: [${a.id} (${a.type})] 与 [${b.id} (${b.type})] 重叠 (dx: ${overlapX.toFixed(1)}, dy: ${overlapY.toFixed(1)})`
        )
      }
    }
  }

  assert.equal(
    collisions.length,
    0,
    `陈氏图必须实现所有节点绝对无重叠！当前发现 ${collisions.length} 处碰撞:\n${collisions.join('\n')}`,
  )

  // 验证实体中文概念名称规范性：严禁出现「tenant概念」等假后缀，必须为干净标准中文名词
  const tenantNode = nodes.find((n) => n.id === 'ent_tenant')
  const posNode = nodes.find((n) => n.id === 'ent_pos')
  assert.equal((tenantNode?.data as any)?.displayName, '租户', 'tenant 对应中文概念名为「租户」而非「tenant概念」')
  assert.equal((posNode?.data as any)?.displayName, '岗位', 'position 对应中文概念名为「岗位」而非「position概念」')

  for (const n of nodes) {
    if (n.type === 'chenEntity') {
      const dn = (n.data as any)?.displayName || ''
      assert.ok(!dn.endsWith('概念'), `实体名称「${dn}」严禁出现「概念」假后缀`)
    }
  }

  console.log(`✓ 6 实体企业模型全节点（实体、联系菱形、属性椭圆）绝对零重叠校验通过 (共 ${nodes.length} 个节点，0 碰撞)`)
  console.log(`✓ 实体纯净概念命名（租户、岗位等，拒绝「xxx概念」后缀与中英文混排）校验通过`)
}

function runAllTests() {
  console.log('--- 运行陈氏概念视图自引用关系与中间表判定单元测试 ---')
  testGetSelfLoopPath()
  testToChenFlowElementsSelfRelation()
  testConceptualToChenFlowElementsSelfRelation()
  testDetectJunctionTableTechnical()
  testDetectJunctionTableAssociativeEntity()
  testDetectJunctionTableUserOverride()
  testChen2DCompactLayout()
  testChenZeroOverlapForMultiEntities()
  console.log('所有测试全部通过！\n')
}

runAllTests()
