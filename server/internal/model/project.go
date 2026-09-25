package model

import "time"

type Project struct {
	ID               string `gorm:"primaryKey"`
	Name             string `gorm:"not null"`
	Description      string `gorm:"not null"`
	ConceptualDesign string `gorm:"column:conceptual_design;type:text"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (Project) TableName() string { return "projects" }
