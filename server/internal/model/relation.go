package model

type Relation struct {
	ID             string `gorm:"primaryKey" json:"id"`
	ProjectID      string `gorm:"not null;index" json:"project_id"`
	SourceEntityID string `gorm:"not null;index" json:"source_entity_id"`
	TargetEntityID string `gorm:"not null;index" json:"target_entity_id"`
	RelationTypeID string `gorm:"index" json:"relation_type_id"`
}

func (Relation) TableName() string { return "relations" }
