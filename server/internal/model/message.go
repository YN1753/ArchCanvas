package model

import "time"

type Message struct {
	ID             string    `gorm:"primaryKey" json:"id"`
	ConversationID string    `gorm:"not null;index:idx_messages_conv_created,priority:1" json:"conversation_id"`
	Role           string    `gorm:"not null" json:"role"`
	Content        string    `gorm:"not null" json:"content"`
	CreatedAt      time.Time `gorm:"index:idx_messages_conv_created,priority:2" json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (Message) TableName() string { return "messages" }
