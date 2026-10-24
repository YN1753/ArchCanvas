package id

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNewUUIDv7_FormatAndMonotonic(t *testing.T) {
	const count = 10
	ids := make([]string, count)

	for i := 0; i < count; i++ {
		ids[i] = NewUUIDv7()
		if len(ids[i]) != 36 {
			t.Fatalf("UUIDv7 长度应为 36，实际为 %d: %s", len(ids[i]), ids[i])
		}
		if !IsValidUUID(ids[i]) {
			t.Fatalf("IsValidUUID(%s) 预期返回 true", ids[i])
		}
		if !IsValidUUIDv7(ids[i]) {
			t.Fatalf("IsValidUUIDv7(%s) 预期返回 true", ids[i])
		}
		time.Sleep(1 * time.Millisecond)
	}

	// 验证时间单调自增（字典序排序）
	for i := 1; i < count; i++ {
		if ids[i-1] >= ids[i] {
			t.Fatalf("UUIDv7 应该保持时间单调自增: ids[%d]=%s >= ids[%d]=%s", i-1, ids[i-1], i, ids[i])
		}
	}
}

func TestIsValidUUID(t *testing.T) {
	v4 := uuid.New().String()
	v7 := NewUUIDv7()

	if !IsValidUUID(v4) {
		t.Errorf("IsValidUUID(v4) 预期 true，实际 false")
	}
	if !IsValidUUID(v7) {
		t.Errorf("IsValidUUID(v7) 预期 true，实际 false")
	}

	invalidCases := []string{
		"",
		"not-a-uuid",
		"12345678-1234-1234-1234",
		"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
		"12345678-1234-1234-1234-1234567890123", // 37 字符
	}

	for _, tc := range invalidCases {
		if IsValidUUID(tc) {
			t.Errorf("IsValidUUID(%q) 预期 false，实际 true", tc)
		}
	}
}

func TestIsValidUUIDv7(t *testing.T) {
	v7 := NewUUIDv7()
	if !IsValidUUIDv7(v7) {
		t.Errorf("IsValidUUIDv7(NewUUIDv7()) 预期 true，实际 false")
	}

	// UUIDv4 不应被判定为 UUIDv7
	v4 := uuid.New().String()
	if IsValidUUIDv7(v4) {
		t.Errorf("IsValidUUIDv7(v4) 预期 false，实际 true")
	}

	// UUIDv1 不应被判定为 UUIDv7
	v1, err := uuid.NewUUID()
	if err == nil {
		if IsValidUUIDv7(v1.String()) {
			t.Errorf("IsValidUUIDv7(v1) 预期 false，实际 true")
		}
	}

	// 全 0 空 UUID 不应被判定为 UUIDv7
	nilUUID := uuid.Nil.String()
	if IsValidUUIDv7(nilUUID) {
		t.Errorf("IsValidUUIDv7(nilUUID) 预期 false，实际 true")
	}

	// 非法字符串
	invalidStrings := []string{
		"",
		"018e69d7-8f53-7000-8000",
		"018e69d7-8f53-7000-8000-000000000000-extra",
		"invalid-string-with-36-characters---",
	}
	for _, s := range invalidStrings {
		if IsValidUUIDv7(s) {
			t.Errorf("IsValidUUIDv7(%q) 预期 false，实际 true", s)
		}
	}
}
