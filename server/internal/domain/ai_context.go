package domain

import "time"

type AIContext struct {
	ID        string           `grom:"primaryKey" json:"id"`
	ProjectID string           `gorm:"not null;uniqueIndex" json:"project_id"`
	Content   AIContextContent `json:"content"`
	Version   string           `gorm:"type:text" json:"version"`
	CreatedAt time.Time        `json:"created_at"`
	UpdatedAt time.Time        `json:"updated_at"`
}
type AIContextContent struct {
	Goal        string   `json:"goal"`
	TechStack   []string `json:"tech_stack"`
	Decisions   []string `json:"decisions"`
	Constraints []string `json:"constraints"`
	Progress    string   `json:"progress"`
}
