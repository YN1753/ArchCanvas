package domain

import "encoding/json"

type ERDesign struct {
	Entities  []Entity   `json:"entities"`
	Relations []Relation `json:"relations"`
}

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// IndexDefinition 物理表的索引定义（支持单列/复合索引与唯一索引）
type IndexDefinition struct {
	Name     string   `json:"name"`                // 索引名称，如 idx_user_status
	Columns  []string `json:"columns"`             // 索引覆盖的列名列表（按最左匹配前缀顺序）
	IsUnique bool     `json:"is_unique,omitempty"` // 是否为唯一索引
	Comment  string   `json:"comment,omitempty"`   // 索引的设计意图说明
}

type Entity struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Comment         string            `json:"comment,omitempty"` // 表的中文业务注释
	Position        *Position         `json:"position,omitempty"`
	Attributes      []Attribute       `json:"attributes"`
	Indexes         []IndexDefinition `json:"indexes,omitempty"`           // 表的索引清单
	IsJunctionTable *bool             `json:"is_junction_table,omitempty"` // 是否视为技术中间表并在概念图中折叠为联系
}

type Attribute struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Comment      string  `json:"comment,omitempty"` // 字段中文业务说明，对齐 SQL COMMENT
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
	Cardinality    string `json:"cardinality,omitempty"`
}

func (r *Relation) UnmarshalJSON(data []byte) error {
	type Alias Relation
	aux := &struct {
		*Alias
		Card    string `json:"cardinality"`
		RelType string `json:"relation_type_id"`
	}{
		Alias: (*Alias)(r),
	}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	if r.RelationTypeID == "" {
		r.RelationTypeID = aux.Card
	}
	if r.Cardinality == "" {
		r.Cardinality = r.RelationTypeID
	}
	if r.Cardinality == "" {
		r.Cardinality = "one_to_many"
		r.RelationTypeID = "one_to_many"
	}
	return nil
}

func (r Relation) MarshalJSON() ([]byte, error) {
	relType := r.RelationTypeID
	if relType == "" {
		relType = r.Cardinality
	}
	if relType == "" {
		relType = "one_to_many"
	}
	type Alias Relation
	return json.Marshal(&struct {
		Alias
		RelationTypeID string `json:"relation_type_id"`
		Cardinality    string `json:"cardinality"`
	}{
		Alias:          Alias(r),
		RelationTypeID: relType,
		Cardinality:    relType,
	})
}

