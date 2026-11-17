package repository

import (
	"context"
	"time"

	"archcanvas/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const globalQuotaScopeKey = "__global__"

// ShowcaseQuotaRepository 封装公开演示模式下每日单 IP 与全站 AI 调用配额的持久化读写。
type ShowcaseQuotaRepository struct {
	db *gorm.DB
}

func NewShowcaseQuotaRepository(db *gorm.DB) *ShowcaseQuotaRepository {
	return &ShowcaseQuotaRepository{db: db}
}

func (r *ShowcaseQuotaRepository) GetDailyUsage(ctx context.Context, dayKey, ipScope string) (ipUsed int, globalUsed int, err error) {
	if r == nil || r.db == nil {
		return 0, 0, nil
	}
	var rows []model.ShowcaseQuota
	if err := r.db.WithContext(ctx).
		Where("day_key = ? AND scope_key IN ?", dayKey, []string{globalQuotaScopeKey, ipScope}).
		Find(&rows).Error; err != nil {
		return 0, 0, err
	}
	for _, row := range rows {
		if row.ScopeKey == globalQuotaScopeKey {
			globalUsed = row.UsedCount
		} else if row.ScopeKey == ipScope {
			ipUsed = row.UsedCount
		}
	}
	return ipUsed, globalUsed, nil
}

func (r *ShowcaseQuotaRepository) TryConsumeDailyQuota(
	ctx context.Context,
	dayKey string,
	ipScope string,
	ipDailyLimit int,
	globalDailyLimit int,
	now time.Time,
) (ipRem int, globalRem int, ipExhausted bool, globalExhausted bool, err error) {
	if r == nil || r.db == nil {
		return 999, 999, false, false, nil
	}

	txErr := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []model.ShowcaseQuota
		if err := tx.Where("day_key = ? AND scope_key IN ?", dayKey, []string{globalQuotaScopeKey, ipScope}).
			Find(&rows).Error; err != nil {
			return err
		}

		var ipUsed, globalUsed int
		for _, row := range rows {
			if row.ScopeKey == globalQuotaScopeKey {
				globalUsed = row.UsedCount
			} else if row.ScopeKey == ipScope {
				ipUsed = row.UsedCount
			}
		}

		if globalUsed >= globalDailyLimit {
			ipRem = max(0, ipDailyLimit-ipUsed)
			globalRem = 0
			globalExhausted = true
			return nil
		}
		if ipUsed >= ipDailyLimit {
			ipRem = 0
			globalRem = max(0, globalDailyLimit-globalUsed)
			ipExhausted = true
			return nil
		}

		for _, scope := range []string{globalQuotaScopeKey, ipScope} {
			upsert := model.ShowcaseQuota{
				DayKey:    dayKey,
				ScopeKey:  scope,
				UsedCount: 1,
				UpdatedAt: now,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "day_key"}, {Name: "scope_key"}},
				DoUpdates: clause.Assignments(map[string]any{
					"used_count": gorm.Expr("used_count + 1"),
					"updated_at": now,
				}),
			}).Create(&upsert).Error; err != nil {
				return err
			}
		}

		ipRem = max(0, ipDailyLimit-(ipUsed+1))
		globalRem = max(0, globalDailyLimit-(globalUsed+1))
		return nil
	})

	return ipRem, globalRem, ipExhausted, globalExhausted, txErr
}

func (r *ShowcaseQuotaRepository) RefundDailyQuota(ctx context.Context, dayKey, ipScope string) error {
	if r == nil || r.db == nil {
		return nil
	}
	return r.db.WithContext(ctx).
		Model(&model.ShowcaseQuota{}).
		Where("day_key = ? AND scope_key IN ? AND used_count > 0", dayKey, []string{globalQuotaScopeKey, ipScope}).
		UpdateColumn("used_count", gorm.Expr("used_count - 1")).Error
}

func (r *ShowcaseQuotaRepository) DeleteQuotasBefore(ctx context.Context, cutoffDay string) error {
	if r == nil || r.db == nil {
		return nil
	}
	return r.db.WithContext(ctx).Where("day_key < ?", cutoffDay).Delete(&model.ShowcaseQuota{}).Error
}
