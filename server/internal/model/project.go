package model

import "time"

type Project struct {
	ID               string    `gorm:"primaryKey" json:"id"`
	Name             string    `gorm:"not null" json:"name"`
	Description      string    `gorm:"not null" json:"description"`
	ConceptualDesign string    `gorm:"column:conceptual_design;type:text" json:"conceptual_design,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (Project) TableName() string { return "projects" }
