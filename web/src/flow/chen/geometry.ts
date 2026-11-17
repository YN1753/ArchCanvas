import type { Position } from '../../types/dsl'

/**
 * 根据源节点与宿节点的相对几何中心坐标，推导最短无交叉连接 Handle 标识。
 * 统一输出 `<dir>-source` 与 `<dir>-target` 锚点 ID，与 `<ChenNodeHandles />` 100% 匹配。
 */
export function getNearestChenHandles(
  sourceCenter: Position,
  targetCenter: Position,
): { sourceHandle: string; targetHandle: string } {
  const dx = targetCenter.x - sourceCenter.x
  const dy = targetCenter.y - sourceCenter.y

  if (Math.abs(dx) >= Math.abs(dy) * 1.4) {
    return dx >= 0
      ? { sourceHandle: 'right-source', targetHandle: 'left-target' }
      : { sourceHandle: 'left-source', targetHandle: 'right-target' }
  }
  if (Math.abs(dy) >= Math.abs(dx) * 1.4) {
    return dy >= 0
      ? { sourceHandle: 'bottom-source', targetHandle: 'top-target' }
      : { sourceHandle: 'top-source', targetHandle: 'bottom-target' }
  }
  return dy < 0
    ? { sourceHandle: 'top-source', targetHandle: 'bottom-target' }
    : { sourceHandle: 'bottom-source', targetHandle: 'top-target' }
}

/**
 * 计算矩形或菱形边界与射线的交点坐标（用于精确几何裁剪与布局测距）。
 */
export function getNodeBoundaryIntersection(
  center: Position,
  target: Position,
  size: { width: number; height: number },
  shape: 'rect' | 'diamond' = 'rect',
): Position {
  const dx = target.x - center.x
  const dy = target.y - center.y
  if (dx === 0 && dy === 0) return center

  const hw = size.width / 2
  const hh = size.height / 2

  if (shape === 'diamond') {
    const scale = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
    return { x: center.x + dx * scale, y: center.y + dy * scale }
  }

  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const scale = Math.min(scaleX, scaleY)
  return { x: center.x + dx * scale, y: center.y + dy * scale }
}

/**
 * 计算自引用关系的双弧分流贝塞尔曲线路径与 t=0.5 标签中心坐标。
 */
export function getSelfLoopPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  dir: 'top' | 'bottom' = 'top',
): [string, number, number] {
  const dx = tx - sx
  const dy = ty - sy
  const dist = Math.hypot(dx, dy) || 1
  const offset = Math.max(38, Math.min(dist * 0.28, 75))
  const sign = dir === 'top' ? -1 : 1

  let cp1x: number
  let cp1y: number
  let cp2x: number
  let cp2y: number

  if (Math.abs(dx) < 40) {
    cp1x = sx + dx * 0.25 + sign * offset
    cp1y = sy + dy * 0.25
    cp2x = sx + dx * 0.75 + sign * offset
    cp2y = sy + dy * 0.75
  } else {
    cp1x = sx + dx * 0.25
    cp1y = sy + dy * 0.25 + sign * offset
    cp2x = sx + dx * 0.75
    cp2y = sy + dy * 0.75 + sign * offset
  }

  const lx = 0.125 * sx + 0.375 * cp1x + 0.375 * cp2x + 0.125 * tx
  const ly = 0.125 * sy + 0.375 * cp1y + 0.375 * cp2y + 0.125 * ty
  const path = `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`

  return [path, lx, ly]
}

/**
 * 推导陈氏菱形联系的默认中文业务动作动词。
 */
export function getRelationshipVerb(srcName: string, tgtName: string, cardinality?: string): string {
  const s = srcName.toLowerCase()
  const t = tgtName.toLowerCase()

  if (s === t) {
    if (
      s.includes('category') ||
      s.includes('tag') ||
      s.includes('menu') ||
      s.includes('dept') ||
      s.includes('department') ||
      s.includes('org') ||
      s.includes('node') ||
      s.includes('tree') ||
      s.includes('folder') ||
      s.includes('catalog')
    ) {
      return '层级包含'
    }
    if (
      s.includes('user') ||
      s.includes('employee') ||
      s.includes('member') ||
      s.includes('staff') ||
      s.includes('manager')
    ) {
      return '上下级汇报'
    }
    if (s.includes('comment') || s.includes('reply') || s.includes('message')) {
      return '引用回复'
    }
    return '层级包含'
  }

  const match = (a: string, b: string) =>
    (s.includes(a) && t.includes(b)) || (s.includes(b) && t.includes(a))

  if (match('user', 'article') || match('user', 'post')) return '发布'
  if (match('user', 'order')) return '下单'
  if (match('user', 'comment')) return '发表评论'
  if (
    match('category', 'article') ||
    match('categories', 'articles') ||
    match('category', 'product')
  ) {
    return '归属分类'
  }
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
