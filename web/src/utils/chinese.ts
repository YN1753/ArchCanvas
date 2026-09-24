/**
 * 数据库常见英文命名 → 中文业务概念映射字典
 * 专用于陈氏标准 ER 图的中文概念化展示
 */

const ENTITY_DICTIONARY: Record<string, string> = {
  // 用户与权限
  user: '用户',
  users: '用户',
  account: '账户',
  accounts: '账户',
  role: '角色',
  roles: '角色',
  permission: '权限',
  permissions: '权限',
  user_role: '用户角色关联',
  user_roles: '用户角色关联',
  role_permission: '角色权限关联',
  role_permissions: '角色权限关联',
  department: '部门',
  departments: '部门',
  org: '组织机构',
  organization: '组织机构',

  // 电商与交易
  order: '订单',
  orders: '订单',
  order_item: '订单详情',
  order_items: '订单详情',
  order_detail: '订单明细',
  order_details: '订单明细',
  product: '商品',
  products: '商品',
  item: '商品项',
  items: '商品项',
  goods: '商品',
  sku: '商品规格',
  skus: '商品规格',
  spu: '标准产品',
  spus: '标准产品',
  category: '分类',
  categories: '分类',
  brand: '品牌',
  brands: '品牌',
  cart: '购物车',
  carts: '购物车',
  cart_item: '购物车明细',
  cart_items: '购物车明细',
  address: '收货地址',
  addresses: '收货地址',
  payment: '支付记录',
  payments: '支付记录',
  invoice: '发票',
  invoices: '发票',
  refund: '退款',
  refunds: '退款',
  coupon: '优惠券',
  coupons: '优惠券',
  inventory: '库存',
  stock: '库存',
  logistics: '物流',
  shipping: '配送',

  // 社交与内容
  article: '文章',
  articles: '文章',
  post: '帖子',
  posts: '帖子',
  comment: '评论',
  comments: '评论',
  reply: '回复',
  replies: '回复',
  like: '点赞',
  likes: '点赞',
  favorite: '收藏',
  favorites: '收藏',
  collection: '收藏集',
  collections: '收藏集',
  tag: '标签',
  tags: '标签',
  topic: '话题',
  topics: '话题',
  message: '消息',
  messages: '消息',
  notification: '通知',
  notifications: '通知',

  // 教育与教务
  student: '学生',
  students: '学生',
  teacher: '教师',
  teachers: '教师',
  course: '课程',
  courses: '课程',
  class: '班级',
  classes: '班级',
  grade: '成绩',
  grades: '成绩',
  score: '分数',
  scores: '分数',
  major: '专业',
  majors: '专业',
  college: '学院',
  colleges: '学院',
  school: '学校',
  schools: '学校',

  // 企业与通用
  customer: '客户',
  customers: '客户',
  supplier: '供应商',
  suppliers: '供应商',
  warehouse: '仓库',
  warehouses: '仓库',
  project: '项目',
  projects: '项目',
  task: '任务',
  // 文件、媒体与存储
  media: '媒体',
  medias: '媒体',
  media_resource: '媒体资源',
  media_resources: '媒体资源',
  asset: '资产',
  assets: '资产',
  resource: '资源',
  resources: '资源',
  upload: '上传',
  uploads: '上传文件',
  storage: '存储',
  storages: '存储',
  file: '文件',
  files: '文件',
  folder: '文件夹',
  folders: '文件夹',
  attachment: '附件',
  attachments: '附件',
  image: '图片',
  images: '图片',
  video: '视频',
  videos: '视频',
  audio: '音频',
  audios: '音频',
  document: '文档',
  documents: '文档',
  log: '日志',
  logs: '日志',
  config: '系统配置',
  configs: '系统配置',
  setting: '设置',
  settings: '设置',
}

const ATTRIBUTE_DICTIONARY: Record<string, string> = {
  id: '编号',
  uuid: '编号',
  code: '编码',
  number: '序号',
  no: '编号',

  username: '用户名',
  account: '账号',
  password: '密码',
  password_hash: '密码',
  salt: '盐值',
  name: '名称',
  real_name: '真实姓名',
  nickname: '昵称',
  gender: '性别',
  sex: '性别',
  age: '年龄',
  birthday: '生日',
  email: '邮箱',
  mail: '邮箱',
  phone: '手机',
  mobile: '手机',
  telephone: '电话',
  avatar: '头像',
  avatar_url: '头像',
  icon: '图标',
  logo: '徽标',
  picture: '图片',
  image: '图片',
  image_url: '图片链接',
  cover: '封面',
  cover_url: '封面',

  title: '标题',
  subtitle: '副标题',
  content: '内容',
  body: '正文',
  summary: '摘要',
  intro: '简介',
  description: '描述',
  desc: '描述',
  remark: '备注',
  note: '便签',
  memo: '备忘',
  slug: '别名',
  author: '作者',

  // 媒体与资源
  url: '访问地址',
  file_url: '文件地址',
  file_path: '存储路径',
  path: '路径',
  size: '文件大小',
  file_size: '文件大小',
  mime_type: '文件类型',
  file_type: '文件类型',
  extension: '扩展名',
  ext: '扩展名',
  width: '宽度',
  height: '高度',
  duration: '时长',

  // 社交与评论
  website: '个人网站',
  site_url: '网站',
  ip: 'IP地址',
  user_agent: '客户端',
  source: '来源渠道',

  price: '价格',
  cost_price: '成本价',
  original_price: '原价',
  amount: '金额',
  total_amount: '总金额',
  pay_amount: '实付金额',
  discount: '折扣',
  quantity: '数量',
  count: '数量',
  stock: '库存',
  num: '数值',

  status: '状态',
  state: '状态',
  type: '类型',
  kind: '种类',
  level: '级别',
  sort: '排序',
  sort_order: '排序序号',
  order_num: '顺序',

  is_deleted: '删除标记',
  deleted: '删除标记',
  is_active: '启用状态',
  enabled: '启用标记',
  is_default: '默认标记',

  created_at: '创建时间',
  create_time: '创建时间',
  updated_at: '更新时间',
  update_time: '更新时间',
  deleted_at: '删除时间',
  delete_time: '删除时间',
  start_time: '开始时间',
  end_time: '结束时间',
  expire_time: '过期时间',
  pay_time: '支付时间',
  published_at: '发布时间',
  publish_time: '发布时间',

  created_by: '创建人',
  creator: '创建人',
  updated_by: '更新人',
  updater: '更新人',

  user_id: '用户编号',
  order_id: '订单编号',
  product_id: '商品编号',
  category_id: '分类编号',
  role_id: '角色编号',
  parent_id: '父级编号',
}

const CHINESE_REGEX = /[\u4e00-\u9fa5]/

/**
 * 判断字符串是否包含中文
 */
export function hasChinese(text: string): boolean {
  return CHINESE_REGEX.test(text)
}

/**
 * 清理长文本描述，提取精简纯粹的核心名词（2~4字，过滤任何标点符号及“唯一”、“非空”等约束词）
 */
function cleanChineseDescription(desc: string): string {
  const trimmed = desc.trim()
  if (!trimmed) return ''

  // 1. 取第一个标点符号或括号之前的主词
  const firstChunk = trimmed.split(/[,，;；(（:：\s]/)[0]?.trim() ?? ''

  // 2. 剥离无意义的前后缀与约束词
  const cleaned = firstChunk
    .replace(/^(用户的|文章的|媒体的|标签的|评论的|记录|表示|存储|当前|该|登录|注册)/g, '')
    .replace(/(唯一标识|主键标识|外键标识|唯一|主键|外键|非空|自增|必填|代码生成|全局唯一)/g, '')
    .replace(/(字段|信息|属性|列表|标识)$/g, '')
    .trim()

  if (cleaned.length >= 2 && cleaned.length <= 6) {
    return cleaned
  }
  return ''
}

/**
 * 获取实体的中文业务概念名称
 */
export function getEntityChineseName(name: string, description?: string): string {
  const normalized = name.trim().toLowerCase()
  if (ENTITY_DICTIONARY[normalized]) {
    return ENTITY_DICTIONARY[normalized]
  }

  if (hasChinese(name)) {
    return name
  }

  // 尝试单复数归一化转换（如 medias -> media, categories -> category）
  if (normalized.endsWith('ies')) {
    const singular = normalized.slice(0, -3) + 'y'
    if (ENTITY_DICTIONARY[singular]) return ENTITY_DICTIONARY[singular]
  }
  if (normalized.endsWith('es')) {
    const singular = normalized.slice(0, -2)
    if (ENTITY_DICTIONARY[singular]) return ENTITY_DICTIONARY[singular]
  }
  if (normalized.endsWith('s')) {
    const singular = normalized.slice(0, -1)
    if (ENTITY_DICTIONARY[singular]) return ENTITY_DICTIONARY[singular]
  }

  // 尝试复合拆词（如 order_items -> 订单详情, media_files -> 媒体文件）
  const parts = normalized.split(/[-_]/).filter(Boolean)
  if (parts.length > 1) {
    const translatedParts = parts.map((p) => {
      if (ENTITY_DICTIONARY[p]) return ENTITY_DICTIONARY[p]
      const pSingular = p.endsWith('s') ? p.slice(0, -1) : p
      return ENTITY_DICTIONARY[pSingular] ?? p
    })
    if (translatedParts.some((p) => hasChinese(p))) {
      return translatedParts.join('')
    }
  }

  if (description && hasChinese(description)) {
    const cleaned = cleanChineseDescription(description)
    if (cleaned) return cleaned
  }

  // 若仍无中文，强制生成符合概念图规范的中文概念名
  return `${name}概念`
}

/**
 * 获取属性的极简中文业务名称（专为陈氏标准图设计：纯净名词，严禁长句与约束字样）
 */
export function getAttributeChineseName(
  name: string,
  description?: string,
  isPrimaryKey?: boolean,
): string {
  const normalized = name.trim().toLowerCase()

  // 1. 主键优先级最高：纯净主键命名
  if (isPrimaryKey) {
    if (normalized === 'id' || normalized === 'pk') {
      return '编号'
    }
    if (normalized.endsWith('_id')) {
      const base = normalized.slice(0, -3)
      const baseName = ENTITY_DICTIONARY[base] ?? base
      return `${baseName}编号`
    }
    return '编号'
  }

  // 2. 核心字典精确匹配（最标准干净的名词）
  if (ATTRIBUTE_DICTIONARY[normalized]) {
    return ATTRIBUTE_DICTIONARY[normalized]
  }

  // 3. 常见下划线复合匹配（如 tag_name -> 标签名, file_size -> 文件大小）
  if (normalized.includes('_')) {
    const parts = normalized.split('_').filter(Boolean)
    const translated = parts.map((p) => ATTRIBUTE_DICTIONARY[p] ?? ENTITY_DICTIONARY[p] ?? '')
    if (translated.every((t) => t.length > 0)) {
      return translated.join('')
    }
  }

  // 4. 若 name 本身就是简短中文
  if (hasChinese(name) && name.length <= 6) {
    return name.replace(/(字段|信息|属性)$/, '')
  }

  // 5. 从 description 中提取最简核心名词（仅在有效提取且不带标点时生效）
  if (description && hasChinese(description)) {
    const fromDesc = cleanChineseDescription(description)
    if (fromDesc) {
      return fromDesc
    }
  }

  // 6. 兜底返回英文字段名
  return name
}

/**
 * 关系基数中文标签
 */
export const CARDINALITY_CHINESE: Record<string, { label: string; source: string; target: string }> = {
  one_to_one: { label: '一对一', source: '1', target: '1' },
  one_to_many: { label: '一对多', source: '1', target: '多' },
  many_to_many: { label: '多对多', source: '多', target: '多' },
}
