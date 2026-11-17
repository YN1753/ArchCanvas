package model

import "time"

// ShowcaseQuota 记录公开演示沙盒模式下按自然日（UTC+8）与维度（单 IP / 全站全局）统计的 AI 接口调用配额。
type ShowcaseQuota struct {
	DayKey    string    `gorm:"primaryKey;size:16" json:"day_key"`
	ScopeKey  string    `gorm:"primaryKey;size:128" json:"scope_key"`
	UsedCount int       `gorm:"not null;default:0" json:"used_count"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ShowcaseQuota) TableName() string { return "showcase_quotas" }
