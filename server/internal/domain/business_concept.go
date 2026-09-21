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
