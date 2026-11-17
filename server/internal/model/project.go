package model

import "time"

type Project struct {
	ID               string    `gorm:"primaryKey" json:"id"`
	Name             string    `gorm:"not null" json:"name"`
	Description      string    `gorm:"not null" json:"description"`
	VisitorID        string    `gorm:"column:visitor_id;index:idx_projects_visitor;default:''" json:"visitor_id,omitempty"`
	IsTemplate       bool      `gorm:"column:is_template;index:idx_projects_template;default:false" json:"is_template"`
	TemplateOrder    int       `gorm:"column:template_order;default:0" json:"template_order,omitempty"`
	ConceptualDesign string    `gorm:"column:conceptual_design;type:text" json:"conceptual_design,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (Project) TableName() string { return "projects" }
