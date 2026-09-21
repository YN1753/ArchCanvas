package domain

type ERDesign struct {
	Entities  []Entity   `json:"entities"`
	Relations []Relation `json:"relations"`
}

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Entity struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Position   *Position   `json:"position,omitempty"`
	Attributes []Attribute `json:"attributes"`
}

type Attribute struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	DBType       string  `json:"db_type"`
	CodeType     string  `json:"code_type"`
	IsPrimaryKey bool    `json:"is_primary_key"`
	IsNullable   bool    `json:"is_nullable"`
	IsUnique     bool    `json:"is_unique"`
	DefaultValue *string `json:"default_value"`
	Description  string  `json:"description"`
}

type Relation struct {
	ID             string `json:"id"`
	SourceEntityID string `json:"source_entity_id"`
	TargetEntityID string `json:"target_entity_id"`
	RelationTypeID string `json:"relation_type_id"`
}
