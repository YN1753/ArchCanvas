package model

type Entity struct {
	ID        string `gorm:"primaryKey" json:"id"`
	ProjectID string `gorm:"not null;index;uniqueIndex:name_project" json:"project_id"`
	Name      string `gorm:"not null;uniqueIndex:name_project" json:"name"`
}

func (Entity) TableName() string { return "entities" }
