package model

type Entity struct {
	ID        string   `gorm:"primaryKey" json:"id"`
	ProjectID string   `gorm:"not null;index;uniqueIndex:name_project" json:"project_id"`
	Name      string   `gorm:"not null;uniqueIndex:name_project" json:"name"`
	PosX      *float64 `gorm:"column:pos_x" json:"pos_x"`
	PosY      *float64 `gorm:"column:pos_y" json:"pos_y"`
}

func (Entity) TableName() string { return "entities" }
