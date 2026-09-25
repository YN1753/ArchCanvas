import dagre from 'dagre'
import type { Node } from '@xyflow/react'

import type { Attribute, Entity, ERDesign, Position, Relation } from '../types/dsl'
import { getEntityChineseName } from '../utils/chinese'
import type { ChenEntityNodeData } from '../components/chen/ChenEntityNode'
import type { ChenRelationNodeData } from '../components/chen/ChenRelationNode'
import type { ChenAttributeNodeData } from '../components/chen/ChenAttributeNode'
import type { ChenEdgeType } from '../components/chen/ChenEdge'

export type ChenNode = Node<ChenEntityNodeData | ChenRelationNodeData | ChenAttributeNodeData>

/**
 * 识别是否为多对多纯技术中间表（Junction Table）
 */
function detectJunctionTable(
  entity: Entity,
  allEntities: Entity[],
): { isJunction: boolean; leftEntity?: Entity; rightEntity?: Entity } {
  const normName = entity.name.toLowerCase()

  // 1. 字段特征识别：含有两个不同实体的主键外键，且总字段较少（通常 <= 5 个）
  const foreignKeys = entity.attributes.filter(
    (a) => !a.is_primary_key && (a.name.endsWith('_id') || a.name.endsWith('id')) && a.name.toLowerCase() !== 'id',
  )

  if (foreignKeys.length >= 2 && entity.attributes.length <= 6) {
    const matchedParents: Entity[] = []
    for (const fk of foreignKeys) {
      const base = fk.name.toLowerCase().replace(/_?id$/, '')
      for (const candidate of allEntities) {
        if (candidate.id === entity.id) continue
        const cName = candidate.name.toLowerCase()
        const cSingular = cName.endsWith('s') ? cName.slice(0, -1) : cName
        if (cName === base || cSingular === base || cName.includes(base)) {
          matchedParents.push(candidate)
          break
        }
      }
    }
    if (matchedParents.length >= 2) {
      return { isJunction: true, leftEntity: matchedParents[0], rightEntity: matchedParents[1] }
    }
  }

  // 2. 命名组合特征识别（如 article_tags, user_roles）
  if (normName.includes('_')) {
    const parts = normName.split('_')
    const found: Entity[] = []
    for (const part of parts) {
      for (const candidate of allEntities) {
        if (candidate.id === entity.id) continue
        const cName = candidate.name.toLowerCase()
        const cSingular = cName.endsWith('s') ? cName.slice(0, -1) : cName
        if (cName === part || cSingular === part) {
          found.push(candidate)
          break
        }
      }
    }
    if (found.length >= 2) {
      return { isJunction: true, leftEntity: found[0], rightEntity: found[1] }
    }
  }

  return { isJunction: false }
}

/**
 * 推导陈氏菱形联系的业务动作动词（双向匹配，语义清晰）
 */
function getRelationshipVerb(srcName: string, tgtName: string, cardinality?: string): string {
  const s = srcName.toLowerCase()
  const t = tgtName.toLowerCase()

  const match = (a: string, b: string) =>
    (s.includes(a) && t.includes(b)) || (s.includes(b) && t.includes(a))

  if (match('user', 'article') || match('user', 'post')) return '发布'
  if (match('user', 'order')) return '下单'
  if (match('user', 'comment')) return '发表评论'
  if (match('category', 'article') || match('categories', 'articles') || match('category', 'product')) return '归属分类'
  if (match('article', 'tag')) return '打标签'
  if (match('article', 'comment')) return '包含评论'
  if (match('article', 'media')) return '包含媒体'
  if (match('order', 'item') || match('order', 'product')) return '包含明细'
  if (match('role', 'permission')) return '授权'
  if (match('user', 'role')) return '赋予角色'
  if (match('student', 'course')) return '选修'
  if (match('teacher', 'course')) return '主讲'

  if (cardinality === 'many_to_many') return '多对多'
  if (cardinality === 'one_to_many') return '包含'
  return '关联'
}

/**
 * 计算属性行在水平方向的居中对称偏移量
 */
function getRowXOffsets(count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [0]
  if (count === 2) return [-44, 44]
  if (count === 3) return [-64, 0, 64]
  return [-68, -22, 22, 68]
}

/**
 * 将整份物理 ER 设计转换为标准陈氏概念模型图（Chen's ER Model）
 */
export function toChenFlowElements(
  design: ERDesign,
  selectedId?: string | null,
  customPositions?: Record<string, Position>,
): { nodes: ChenNode[]; edges: ChenEdgeType[] } {
  if (!design || !design.entities || design.entities.length === 0) {
    return { nodes: [], edges: [] }
  }

  const nodes: ChenNode[] = []
  const edges: ChenEdgeType[] = []

  // 1. 识别并提取中间表
  const junctionEntityIds = new Set<string>()
  const junctionDiamonds: Array<{
    id: string
    entity: Entity
    leftEntity: Entity
    rightEntity: Entity
  }> = []

  for (const entity of design.entities) {
    const check = detectJunctionTable(entity, design.entities)
    if (check.isJunction && check.leftEntity && check.rightEntity) {
      junctionEntityIds.add(entity.id)
      junctionDiamonds.push({
        id: `junction-${entity.id}`,
        entity,
        leftEntity: check.leftEntity,
        rightEntity: check.rightEntity,
      })
    }
  }

  // 2. 区分核心业务实体（矩形）
  const normalEntities = design.entities.filter((e) => !junctionEntityIds.has(e.id))
  const entityMap = new Map(normalEntities.map((e) => [e.id, e]))

  const ENTITY_W = 150
  const ENTITY_H = 52
  const RELATION_W = 108
  const RELATION_H = 68
  const ATTR_W = 76
  const ATTR_H = 28
  const ATTR_Y_OFFSET = 50

  // 提前为每个实体精选属性并分列上下两排
  interface EntityAttrLayout {
    topAttrs: Attribute[]
    bottomAttrs: Attribute[]
  }
  const entityAttrMap = new Map<string, EntityAttrLayout>()

  for (const entity of normalEntities) {
    // 过滤出适合陈氏图展示的核心属性：
    // - 保留主键（PK）
    // - 剔除外键（如 user_id, category_id），因为陈氏图中外键由菱形连线表达，不作为属性椭圆！
    // - 最多精选 4 个核心业务属性，保证画布优雅不重叠
    const pkAttrs = entity.attributes.filter((a) => a.is_primary_key)
    const bizAttrs = entity.attributes.filter(
      (a) =>
        !a.is_primary_key &&
        !a.name.toLowerCase().endsWith('_id') &&
        !a.name.toLowerCase().endsWith('id'),
    )

    const selectedAttrs: Attribute[] = [...pkAttrs, ...bizAttrs.slice(0, 3)]
    if (selectedAttrs.length === 0 && entity.attributes.length > 0) {
      selectedAttrs.push(entity.attributes[0])
    }

    const topCount = Math.ceil(selectedAttrs.length / 2)
    entityAttrMap.set(entity.id, {
      topAttrs: selectedAttrs.slice(0, topCount),
      bottomAttrs: selectedAttrs.slice(topCount),
    })
  }

  // 3. 构建陈氏主干 Dagre 拓扑图（实体矩形 + 联系菱形）
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: 'LR',
    nodesep: 100, // 实体与实体同层净空（计入上下属性包围盒后留足 100px 绝对净空）
    ranksep: 200, // 实体 ⇄ 菱形层间距（留足 200px 充裕空间展示连线与基数徽标）
    marginx: 80,
    marginy: 80,
  })

  // 添加实体节点到 Dagre（赋予包含上下属性的完整虚拟包围盒，杜绝同层重叠）
  for (const entity of normalEntities) {
    const attrInfo = entityAttrMap.get(entity.id)!
    const hasTop = attrInfo.topAttrs.length > 0
    const hasBottom = attrInfo.bottomAttrs.length > 0
    const virtualHeight =
      ENTITY_H + (hasTop ? ATTR_Y_OFFSET + 8 : 0) + (hasBottom ? ATTR_Y_OFFSET + 8 : 0)
    const maxAttrsInRow = Math.max(attrInfo.topAttrs.length, attrInfo.bottomAttrs.length)
    const virtualWidth = Math.max(ENTITY_W, maxAttrsInRow * (ATTR_W + 12))

    g.setNode(`ent-${entity.id}`, { width: virtualWidth, height: virtualHeight })
  }

  // 添加中间表提升的菱形联系到 Dagre
  const processedPairKeys = new Set<string>()

  for (const junc of junctionDiamonds) {
    const pairKey = [junc.leftEntity.id, junc.rightEntity.id].sort().join('--')
    processedPairKeys.add(pairKey)

    g.setNode(junc.id, { width: RELATION_W, height: RELATION_H })
    g.setEdge(`ent-${junc.leftEntity.id}`, junc.id, { minlen: 1, weight: 2 })
    g.setEdge(junc.id, `ent-${junc.rightEntity.id}`, { minlen: 1, weight: 2 })
  }

  // 添加常规关系转换的菱形联系到 Dagre
  const regularDiamonds: Array<{
    id: string
    relation: Relation
    source: Entity
    target: Entity
    verb: string
  }> = []

  for (const rel of design.relations) {
    // 忽略自环及涉及已处理中间表的关系
    if (rel.source_entity_id === rel.target_entity_id) continue
    if (junctionEntityIds.has(rel.source_entity_id) || junctionEntityIds.has(rel.target_entity_id)) continue

    const src = entityMap.get(rel.source_entity_id)
    const tgt = entityMap.get(rel.target_entity_id)
    if (!src || !tgt) continue

    const pairKey = [src.id, tgt.id].sort().join('--')
    if (processedPairKeys.has(pairKey)) continue
    processedPairKeys.add(pairKey)

    const diaId = `rel-${rel.id}`
    const verb = getRelationshipVerb(src.name, tgt.name, rel.cardinality)
    regularDiamonds.push({
      id: diaId,
      relation: rel,
      source: src,
      target: tgt,
      verb,
    })

    g.setNode(diaId, { width: RELATION_W, height: RELATION_H })
    g.setEdge(`ent-${src.id}`, diaId, { minlen: 1, weight: 2 })
    g.setEdge(diaId, `ent-${tgt.id}`, { minlen: 1, weight: 2 })
  }

  // 执行主干排版
  dagre.layout(g)

  // 4. 生成实体矩形节点与上下属性椭圆（彻底杜绝横向穿越与纵向重叠）
  for (const entity of normalEntities) {
    const laid = g.node(`ent-${entity.id}`)
    const attrInfo = entityAttrMap.get(entity.id)!
    const hasTop = attrInfo.topAttrs.length > 0
    const hasBottom = attrInfo.bottomAttrs.length > 0

    let ecy = laid ? laid.y : 100
    if (hasTop && !hasBottom) {
      ecy += (ATTR_Y_OFFSET + 8) / 2
    } else if (!hasTop && hasBottom) {
      ecy -= (ATTR_Y_OFFSET + 8) / 2
    }
    const ecx = laid ? laid.x : 100

    const defaultEntityX = ecx - ENTITY_W / 2
    const defaultEntityY = ecy - ENTITY_H / 2
    const customEntityPos = customPositions?.[entity.id]

    const entityX = customEntityPos ? customEntityPos.x : defaultEntityX
    const entityY = customEntityPos ? customEntityPos.y : defaultEntityY

    // 动态锚点：若实体发生位置微调，上下属性椭圆默认跟随其实体移动
    const baseEcx = entityX + ENTITY_W / 2
    const baseEcy = entityY + ENTITY_H / 2

    nodes.push({
      id: entity.id,
      type: 'chenEntity',
      position: { x: entityX, y: entityY },
      data: {
        entity,
      },
      selected: entity.id === selectedId,
    })

    // 生成上方属性椭圆
    if (attrInfo.topAttrs.length > 0) {
      const topY = baseEcy - ATTR_Y_OFFSET
      const offsets = getRowXOffsets(attrInfo.topAttrs.length)
      for (let i = 0; i < attrInfo.topAttrs.length; i++) {
        const attr = attrInfo.topAttrs[i]
        const defaultAx = baseEcx + offsets[i] - ATTR_W / 2
        const defaultAy = topY - ATTR_H / 2
        const attrNodeId = `attr-${entity.id}-${attr.id}`
        const customAttrPos = customPositions?.[attrNodeId]

        nodes.push({
          id: attrNodeId,
          type: 'chenAttribute',
          position: customAttrPos ?? { x: defaultAx, y: defaultAy },
          data: {
            attribute: attr,
            entityId: entity.id,
            entityName: entity.name,
          },
        })

        edges.push({
          id: `edge-${entity.id}-${attrNodeId}`,
          type: 'chenEdge',
          source: entity.id,
          target: attrNodeId,
          sourceHandle: 'top',
          targetHandle: 'bottom',
          data: {
            isAttributeEdge: true,
          },
        })
      }
    }

    // 生成下方属性椭圆
    if (attrInfo.bottomAttrs.length > 0) {
      const bottomY = baseEcy + ATTR_Y_OFFSET
      const offsets = getRowXOffsets(attrInfo.bottomAttrs.length)
      for (let i = 0; i < attrInfo.bottomAttrs.length; i++) {
        const attr = attrInfo.bottomAttrs[i]
        const defaultAx = baseEcx + offsets[i] - ATTR_W / 2
        const defaultAy = bottomY - ATTR_H / 2
        const attrNodeId = `attr-${entity.id}-${attr.id}`
        const customAttrPos = customPositions?.[attrNodeId]

        nodes.push({
          id: attrNodeId,
          type: 'chenAttribute',
          position: customAttrPos ?? { x: defaultAx, y: defaultAy },
          data: {
            attribute: attr,
            entityId: entity.id,
            entityName: entity.name,
          },
        })

        edges.push({
          id: `edge-${entity.id}-${attrNodeId}`,
          type: 'chenEdge',
          source: entity.id,
          target: attrNodeId,
          sourceHandle: 'bottom',
          targetHandle: 'top',
          data: {
            isAttributeEdge: true,
          },
        })
      }
    }
  }

  // 5. 生成中间表提升的菱形联系节点与边
  for (const junc of junctionDiamonds) {
    const laid = g.node(junc.id)
    const defaultX = laid ? laid.x - RELATION_W / 2 : 250
    const defaultY = laid ? laid.y - RELATION_H / 2 : 250
    const customPos = customPositions?.[junc.id]

    nodes.push({
      id: junc.id,
      type: 'chenRelation',
      position: customPos ?? { x: defaultX, y: defaultY },
      data: {
        relationId: junc.entity.id,
        name: getEntityChineseName(junc.entity.name),
        cardinality: 'many_to_many',
        sourceEntityId: junc.leftEntity.id,
        targetEntityId: junc.rightEntity.id,
        isJunctionTable: true,
      },
      selected: junc.id === selectedId || junc.entity.id === selectedId,
    })

    // 实体 ──(M)── 菱形
    edges.push({
      id: `edge-${junc.leftEntity.id}-${junc.id}`,
      type: 'chenEdge',
      source: junc.leftEntity.id,
      target: junc.id,
      sourceHandle: 'right',
      targetHandle: 'left',
      data: {
        cardinalityLabel: 'M',
        isAttributeEdge: false,
      },
    })

    // 菱形 ──(N)── 实体
    edges.push({
      id: `edge-${junc.id}-${junc.rightEntity.id}`,
      type: 'chenEdge',
      source: junc.id,
      target: junc.rightEntity.id,
      sourceHandle: 'right',
      targetHandle: 'left',
      data: {
        cardinalityLabel: 'N',
        isAttributeEdge: false,
      },
    })
  }

  // 6. 生成普通外键关系的菱形联系节点与边
  for (const reg of regularDiamonds) {
    const laid = g.node(reg.id)
    const defaultX = laid ? laid.x - RELATION_W / 2 : 250
    const defaultY = laid ? laid.y - RELATION_H / 2 : 250
    const customPos = customPositions?.[reg.id]

    nodes.push({
      id: reg.id,
      type: 'chenRelation',
      position: customPos ?? { x: defaultX, y: defaultY },
      data: {
        relationId: reg.relation.id,
        name: reg.verb,
        cardinality: reg.relation.cardinality,
        sourceEntityId: reg.source.id,
        targetEntityId: reg.target.id,
      },
      selected: reg.id === selectedId || reg.relation.id === selectedId,
    })

    const is1to1 = reg.relation.cardinality === 'one_to_one'
    const isM2M = reg.relation.cardinality === 'many_to_many'

    // 源端基数标签：1 或 M
    const srcCard = isM2M ? 'M' : '1'
    // 宿端基数标签：1 或 N
    const tgtCard = is1to1 ? '1' : 'N'

    edges.push({
      id: `edge-${reg.source.id}-${reg.id}`,
      type: 'chenEdge',
      source: reg.source.id,
      target: reg.id,
      sourceHandle: 'right',
      targetHandle: 'left',
      data: {
        cardinalityLabel: srcCard,
        isAttributeEdge: false,
      },
    })

    edges.push({
      id: `edge-${reg.id}-${reg.target.id}`,
      type: 'chenEdge',
      source: reg.id,
      target: reg.target.id,
      sourceHandle: 'right',
      targetHandle: 'left',
      data: {
        cardinalityLabel: tgtCard,
        isAttributeEdge: false,
      },
    })
  }

  return { nodes, edges }
}
