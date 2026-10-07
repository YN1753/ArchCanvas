package agent

import (
	"context"
	"testing"

	"archcanvas/internal/config"
)

func TestNewModelManager_GracefulDegradation(t *testing.T) {
	ctx := context.Background()

	// 1. 测试提供商配置为空时，正常实例化而不 panic
	emptyConfigs := make(map[string]config.ModelConfig)
	mgrEmpty := NewModelManager(ctx, emptyConfigs, "non_existent", t.TempDir())
	if mgrEmpty == nil {
		t.Fatal("expected ModelManager instance, got nil")
	}

	// 2. 测试配置了无效模型提供商/模型名称时，正常降级而不 panic
	invalidConfigs := map[string]config.ModelConfig{
		"custom_provider": {
			Type:         "unknown_type",
			DefaultModel: "test_model",
		},
	}
	mgrInvalid := NewModelManager(ctx, invalidConfigs, "custom_provider", t.TempDir())
	if mgrInvalid == nil {
		t.Fatal("expected ModelManager instance, got nil")
	}
	if mgrInvalid.CurrentProvider != "custom_provider" {
		t.Errorf("expected CurrentProvider custom_provider, got %s", mgrInvalid.CurrentProvider)
	}
	if mgrInvalid.CurrentName != "test_model" {
		t.Errorf("expected CurrentName test_model, got %s", mgrInvalid.CurrentName)
	}

	// 验证获取不可用模型时返回具体错误，而非导致进程 panic
	_, err := mgrInvalid.GetChatModel(ctx, "custom_provider", "test_model")
	if err == nil {
		t.Error("expected error for unknown_type model, got nil")
	}
}
