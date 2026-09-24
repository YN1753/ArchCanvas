package repository

import (
	"archcanvas/internal/model"
	"archcanvas/pkg/id"
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

type MessageRepository struct {
	db *gorm.DB
}

func NewMessageRepository(db *gorm.DB) *MessageRepository {
	return &MessageRepository{db: db}
}

// GetOrCreateConversation 获取或创建项目的主会话
func (r *MessageRepository) GetOrCreateConversation(ctx context.Context, projectID string) (*model.Conversation, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("message repository database is nil")
	}
	if projectID == "" {
		return nil, errors.New("project id is required")
	}

	var conv model.Conversation
	err := r.db.WithContext(ctx).Where("project_id = ?", projectID).Order("created_at ASC").First(&conv).Error
	if err == nil {
		return &conv, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("find conversation: %w", err)
	}

	conv = model.Conversation{
		ID:        id.NewUUIDv7(),
		ProjectID: projectID,
		Title:     "默认架构设计会话",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := r.db.WithContext(ctx).Create(&conv).Error; err != nil {
		return nil, fmt.Errorf("create conversation: %w", err)
	}

	return &conv, nil
}

// CreateMessage 保存单条消息
func (r *MessageRepository) CreateMessage(ctx context.Context, conversationID, role, content string) (*model.Message, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("message repository database is nil")
	}

	msg := &model.Message{
		ID:             id.NewUUIDv7(),
		ConversationID: conversationID,
		Role:           role,
		Content:        content,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	if err := r.db.WithContext(ctx).Create(msg).Error; err != nil {
		return nil, fmt.Errorf("create message: %w", err)
	}

	return msg, nil
}

// ListMessagesByProject 按时序获取项目的所有历史会话消息
func (r *MessageRepository) ListMessagesByProject(ctx context.Context, projectID string) ([]model.Message, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("message repository database is nil")
	}

	conv, err := r.GetOrCreateConversation(ctx, projectID)
	if err != nil {
		return nil, err
	}

	var messages []model.Message
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conv.ID).
		Order("created_at ASC").
		Find(&messages).Error; err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}

	return messages, nil
}

// ClearMessagesByProject 清空项目的所有历史消息并重置会话
func (r *MessageRepository) ClearMessagesByProject(ctx context.Context, projectID string) error {
	if r == nil || r.db == nil {
		return errors.New("message repository database is nil")
	}

	conv, err := r.GetOrCreateConversation(ctx, projectID)
	if err != nil {
		return err
	}

	return r.db.WithContext(ctx).Where("conversation_id = ?", conv.ID).Delete(&model.Message{}).Error
}
