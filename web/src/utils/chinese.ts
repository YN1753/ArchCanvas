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
  tasks: '任务',
  file: '文件',
  files: '文件',
  attachment: '附件',
  attachments: '附件',
  image: '图片',
  images: '图片',
  log: '日志',
  logs: '日志',
  config: '系统配置',
  configs: '系统配置',
  setting: '设置',
  settings: '设置',
}

const ATTRIBUTE_DICTIONARY: Record<string, string> = {
  id: '编号',
  uuid: '唯一标识',
  code: '编码',
  number: '序号',
  no: '编号',

  username: '用户名',
  account: '登录账号',
  password: '密码',
  password_hash: '密码哈希',
  salt: '安全盐值',
  name: '名称',
  real_name: '真实姓名',
  nickname: '用户昵称',
  gender: '性别',
  sex: '性别',
  age: '年龄',
  birthday: '出生日期',
  email: '电子邮箱',
  mail: '电子邮箱',
  phone: '手机号码',
  mobile: '手机号码',
  telephone: '联系电话',
  avatar: '用户头像',
  icon: '图标',
  logo: '标识图',
  picture: '图片',
  image: '图片',
  image_url: '图片链接',
  cover: '封面图',

  title: '标题',
  subtitle: '副标题',
  content: '详细内容',
  summary: '摘要简介',
  intro: '简介说明',
  description: '业务描述',
  remark: '备注信息',
  note: '便签说明',
  memo: '备忘',

  price: '销售价格',
  cost_price: '成本价格',
  original_price: '原始价格',
  amount: '结算金额',
  total_amount: '总金额',
  pay_amount: '实付金额',
  discount: '优惠折扣',
  quantity: '购买数量',
  count: '数量',
  stock: '库存总量',
  num: '数值',

  status: '业务状态',
  state: '当前状态',
  type: '类型分类',
  kind: '种类',
  level: '级别档位',
  sort: '排序权重',
  sort_order: '排序序号',
  order_num: '显示顺序',

  ip: 'IP地址',
  user_agent: '客户端标识',
  source: '来源渠道',
  url: '链接地址',

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

  created_by: '创建人',
  creator: '创建人',
  updated_by: '更新人',
  updater: '更新人',

  user_id: '关联用户ID',
  order_id: '关联订单ID',
  product_id: '关联商品ID',
  category_id: '所属分类ID',
  role_id: '关联角色ID',
  parent_id: '父级节点ID',
}

const CHINESE_REGEX = /[\u4e00-\u9fa5]/

/**
 * 判断字符串是否包含中文
 */
export function hasChinese(text: string): boolean {
  return CHINESE_REGEX.test(text)
}

/**
 * 清理长文本描述，提取精简的中文属性名（如 "用户注册手机号" → "手机号"）
 */
function cleanChineseDescription(desc: string): string {
  const trimmed = desc.trim()
  if (!trimmed) return ''
  // 去除常见前后缀如 "用户的"、"表示"、"存储"
  const cleaned = trimmed
    .replace(/^(用户的|记录|表示|存储|当前|该)/g, '')
    .replace(/(字段|信息|属性|列表)$/g, '')
    .trim()
  if (cleaned.length > 0 && cleaned.length <= 10) {
    return cleaned
  }
  return trimmed.slice(0, 8)
}

/**
 * 获取实体的中文业务概念名称
 */
export function getEntityChineseName(name: string, description?: string): string {
  if (description && hasChinese(description)) {
    return cleanChineseDescription(description)
  }
  if (hasChinese(name)) {
    return name
  }

  const normalized = name.trim().toLowerCase()
  if (ENTITY_DICTIONARY[normalized]) {
    return ENTITY_DICTIONARY[normalized]
  }

  // 尝试复合拆词（如 order_items -> 订单详情）
  const parts = normalized.split(/[-_]/).filter(Boolean)
  if (parts.length > 1) {
    const translatedParts = parts.map((p) => ENTITY_DICTIONARY[p] ?? p)
    if (translatedParts.some((p) => hasChinese(p))) {
      return translatedParts.join('')
    }
  }

  return name
}

/**
 * 获取属性的中文业务名称
 */
export function getAttributeChineseName(
  name: string,
  description?: string,
  isPrimaryKey?: boolean,
): string {
  if (description && hasChinese(description)) {
    return cleanChineseDescription(description)
  }
  if (hasChinese(name)) {
    return name
  }

  const normalized = name.trim().toLowerCase()
  if (isPrimaryKey && (normalized === 'id' || normalized === 'pk')) {
    return '主键编号'
  }

  if (ATTRIBUTE_DICTIONARY[normalized]) {
    return ATTRIBUTE_DICTIONARY[normalized]
  }

  // 尝试带有 _id 结尾的外键识别（如 user_id -> 用户ID）
  if (normalized.endsWith('_id')) {
    const base = normalized.slice(0, -3)
    const baseChinese = ENTITY_DICTIONARY[base] ?? base
    return `${baseChinese}ID`
  }

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
