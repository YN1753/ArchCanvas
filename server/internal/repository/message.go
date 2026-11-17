package repository

import (
	"archcanvas/internal/model"
	"archcanvas/pkg/id"
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type MessageRepository struct {
	db *gorm.DB
}

func NewMessageRepository(db *gorm.DB) *MessageRepository {
	return &MessageRepository{db: db}
}

// GetOrCreateConversation 原子获取或创建项目的主会话（依赖 project_id 唯一索引消除并发重复创建竞态）。
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

	now := time.Now()
	candidate := model.Conversation{
		ID:        id.NewUUIDv7(),
		ProjectID: projectID,
		Title:     "默认架构设计会话",
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "project_id"}},
			DoNothing: true,
		}).
		Create(&candidate).Error; err != nil {
		return nil, fmt.Errorf("create conversation: %w", err)
	}

	if err := r.db.WithContext(ctx).Where("project_id = ?", projectID).Order("created_at ASC").First(&conv).Error; err != nil {
		return nil, fmt.Errorf("reload conversation: %w", err)
	}
	return &conv, nil
}

// CreateMessage 保存单条消息
func (r *MessageRepository) CreateMessage(ctx context.Context, conversationID, role, content string) (*model.Message, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("message repository database is nil")
	}

	now := time.Now()
	msg := &model.Message{
		ID:             id.NewUUIDv7(),
		ConversationID: conversationID,
		Role:           role,
		Content:        content,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	if err := r.db.WithContext(ctx).Create(msg).Error; err != nil {
		return nil, fmt.Errorf("create message: %w", err)
	}

	return msg, nil
}

func (r *MessageRepository) findConversationReadOnly(ctx context.Context, projectID string) (*model.Conversation, error) {
	var conv model.Conversation
	err := r.db.WithContext(ctx).Where("project_id = ?", projectID).Order("created_at ASC").First(&conv).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find conversation: %w", err)
	}
	return &conv, nil
}

// ListMessagesByProject 按时序获取项目的所有历史会话消息（纯只读，不会在不存在的项目上创建孤儿会话）。
func (r *MessageRepository) ListMessagesByProject(ctx context.Context, projectID string) ([]model.Message, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("message repository database is nil")
	}
	if projectID == "" {
		return nil, errors.New("project id is required")
	}

	conv, err := r.findConversationReadOnly(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return []model.Message{}, nil
	}

	messages := make([]model.Message, 0)
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conv.ID).
		Order("created_at ASC, id ASC").
		Find(&messages).Error; err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}

	return messages, nil
}

// ListRecentMessagesByProject 仅查询项目最近 limit 条消息并按时间正序返回，避免大历史会话全量加载进内存。
func (r *MessageRepository) ListRecentMessagesByProject(ctx context.Context, projectID string, limit int) ([]model.Message, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("message repository database is nil")
	}
	if projectID == "" || limit <= 0 {
		return []model.Message{}, nil
	}

	conv, err := r.findConversationReadOnly(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return []model.Message{}, nil
	}

	messages := make([]model.Message, 0, limit)
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conv.ID).
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&messages).Error; err != nil {
		return nil, fmt.Errorf("list recent messages: %w", err)
	}

	slices.Reverse(messages)
	return messages, nil
}

// ClearMessagesByProject 清空项目的所有历史消息（无会话时幂等返回 nil）。
func (r *MessageRepository) ClearMessagesByProject(ctx context.Context, projectID string) error {
	if r == nil || r.db == nil {
		return errors.New("message repository database is nil")
	}
	if projectID == "" {
		return errors.New("project id is required")
	}

	conv, err := r.findConversationReadOnly(ctx, projectID)
	if err != nil {
		return err
	}
	if conv == nil {
		return nil
	}

	return r.db.WithContext(ctx).Where("conversation_id = ?", conv.ID).Delete(&model.Message{}).Error
}
