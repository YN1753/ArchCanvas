package id

import "github.com/google/uuid"

// NewUUIDv7 生成符合 RFC 9562 标准的有序 UUIDv7。
// 前 48 位包含毫秒级时间戳，对 B+ 树索引极其友好，避免随机写入导致的页分裂。
// 若读取系统时钟极端失败，自动降级为 UUIDv4。
func NewUUIDv7() string {
	u, err := uuid.NewV7()
	if err != nil {
		return uuid.New().String()
	}
	return u.String()
}

// IsValidUUID 检查给定字符串是否为合法的标准 36 位 UUID。
func IsValidUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	_, err := uuid.Parse(s)
	return err == nil
}
