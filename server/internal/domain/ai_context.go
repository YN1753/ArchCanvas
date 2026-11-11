package domain

import "time"

type AIContext struct {
	ID        string           `json:"id"`
	ProjectID string           `json:"project_id"`
	Content   AIContextContent `json:"content"`
	Version   string           `json:"version"`
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
