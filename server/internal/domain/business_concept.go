package domain

// ConceptOperation 业务概念的操作行为枚举（严格限制大模型选择）
type ConceptOperation string

const (
	OpCreate ConceptOperation = "create"
	OpModify ConceptOperation = "modify"
	OpRetain ConceptOperation = "retain"
	OpDelete ConceptOperation = "delete"
)

// ConceptCardinality 概念间的关联基数枚举
type ConceptCardinality string

const (
	CardOneToOne   ConceptCardinality = "one_to_one"
	CardOneToMany  ConceptCardinality = "one_to_many"
	CardManyToMany ConceptCardinality = "many_to_many"
)

// AttributeCategory 属性的数据分类枚举
type AttributeCategory string

const (
	AttrString   AttributeCategory = "string"
	AttrNumber   AttributeCategory = "number"
	AttrBoolean  AttributeCategory = "boolean"
	AttrDateTime AttributeCategory = "datetime"
	AttrEnum     AttributeCategory = "enum"
	AttrMedia    AttributeCategory = "media"
)

// ConceptAttribute 概念属性（纯业务层定义，不涉及具体的物理 SQL 字段类型）
type ConceptAttribute struct {
	Name             string            `json:"name" jsonschema:"description=属性名称，如 id, username, price, status"`
	Category         AttributeCategory `json:"category" jsonschema:"enum=string,enum=number,enum=boolean,enum=datetime,enum=enum,enum=media,description=属性数据类型类别"`
	Description      string            `json:"description" jsonschema:"description=属性的业务含义"`
	Required         bool              `json:"required" jsonschema:"description=是否必填"`
	IsUnique         bool              `json:"is_unique" jsonschema:"description=是否唯一"`
	EnumValueOptions []string          `json:"enum_value_options,omitempty" jsonschema:"description=若为enum类别，列出允许的可选枚举值列表"`
}

// BusinessConcept 业务实体概念（纯业务概念模型）
type BusinessConcept struct {
	Name        string             `json:"name" jsonschema:"description=业务实体概念名称，如 User, Order, Product"`
	Description string             `json:"description" jsonschema:"description=实体的业务定义和用途"`
	Operation   ConceptOperation   `json:"operation" jsonschema:"enum=create,enum=modify,enum=retain,enum=delete,description=对该实体的操作行为"`
	Attributes  []ConceptAttribute `json:"attributes" jsonschema:"description=该业务概念包含的属性列表"`
}

// ConceptRelation 业务概念之间的关联关系
type ConceptRelation struct {
	SourceConcept string             `json:"source_concept" jsonschema:"description=源业务概念名称"`
	TargetConcept string             `json:"target_concept" jsonschema:"description=目标业务概念名称"`
	Cardinality   ConceptCardinality `json:"cardinality" jsonschema:"enum=one_to_one,enum=one_to_many,enum=many_to_many,description=关联对应关系"`
	Description   string             `json:"description" jsonschema:"description=业务关联场景说明，如一个用户可以拥有多笔订单"`
}

// ClarificationOption 澄清确认卡片中的单项预设选项（类似 MiMo 编排选项）
type ClarificationOption struct {
	ID          string `json:"id" jsonschema:"description=选项唯一标识，如 express_delivery"`
	Label       string `json:"label" jsonschema:"description=选项主标题标签，如：支持校内面交与宿舍自提"`
	Description string `json:"description,omitempty" jsonschema:"description=选项副标题说明，简述对设计与架构的影响，如：增加提货码字段，支持离线核销"`
	IsDefault   bool   `json:"is_default" jsonschema:"description=是否为官方推荐选项（卡片中有且仅有一个推荐项）"`
}

// ClarificationCard 编排模式下的单项决策确认卡片（一个业务维度的确认）
type ClarificationCard struct {
	ID          string                `json:"id" jsonschema:"description=决策项唯一标识，如 delivery_mode"`
	Title       string                `json:"title" jsonschema:"description=决策问题标题，如：交易与交付模式"`
	Description string                `json:"description,omitempty" jsonschema:"description=该决策对数据模型的影响简述"`
	Options     []ClarificationOption `json:"options" jsonschema:"description=预置的2-3个高频可选方案列表"`
}
