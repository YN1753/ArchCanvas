package model

import (
	"encoding/json"
	"time"
)

type AIContext struct {
	ID        string    `gorm:"primaryKey" json:"id"`
	ProjectID string    `gorm:"not null;uniqueIndex" json:"project_id"`
	Content   []byte    `gorm:"type:blob" json:"content"`
	Version   string    `gorm:"type:text" json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (AIContext) TableName() string { return "ai_contexts" }

type AIContextContent struct {
	Goal        string   `json:"goal"`
	TechStack   []string `json:"tech_stack"`
	Decisions   []string `json:"decisions"`
	Constraints []string `json:"constraints"`
	Progress    string   `json:"progress"`
}

func (c *AIContextContent) Unmarshal(content []byte) error {
	return json.Unmarshal(content, c)
}
