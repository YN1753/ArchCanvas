package model

import "time"

type AIContext struct {
	ID        string    `gorm:"primaryKey" json:"id"`
	ProjectID string    `gorm:"not null;uniqueIndex" json:"project_id"`
	Content   []byte    `gorm:"type:blob" json:"content"`
	Version   string    `gorm:"type:text" json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (AIContext) TableName() string { return "ai_contexts" }
