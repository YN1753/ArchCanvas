package model

type Attribute struct {
	ID           string  `gorm:"primaryKey" json:"id"`
	Name         string  `gorm:"not null;uniqueIndex:name_entity" json:"name"`
	EntityID     string  `gorm:"not null;uniqueIndex:name_entity" json:"entity_id"`
	Comment      string  `gorm:"column:comment" json:"comment"`
	DBType       string  `gorm:"not null" json:"db_type"`
	CodeType     string  `gorm:"not null" json:"code_type"`
	IsPrimaryKey bool    `gorm:"default:false;not null"  json:"is_primary_key"`
	IsNullable   bool    `gorm:"default:false;not null" json:"is_nullable"`
	IsUnique     bool    `gorm:"default:false;not null" json:"is_unique"`
	DefaultValue *string `json:"default_value"`
	Description  string  `json:"description"`
}

func (Attribute) TableName() string { return "attributes" }
