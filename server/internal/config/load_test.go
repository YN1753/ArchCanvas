package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadWithError_DefaultsAndEnvPlaceholder(t *testing.T) {
	dir := t.TempDir()
	// 确保测试期间环境变量未设置
	t.Setenv("DEEPSEEK_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")

	cfg, err := LoadWithError(dir)
	if err != nil {
		t.Fatalf("LoadWithError failed: %v", err)
	}

	if cfg.Service.Host != "127.0.0.1" {
		t.Errorf("expected default host 127.0.0.1, got %q", cfg.Service.Host)
	}
	if cfg.Agent.Models["deepseek"].APIKey != "" {
		t.Errorf("expected unset DEEPSEEK_API_KEY placeholder to resolve to empty string, got %q", cfg.Agent.Models["deepseek"].APIKey)
	}

	info, err := os.Stat(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatalf("stat config.yaml: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("expected config.yaml perm 0600, got %o", perm)
	}
}

func TestSaveModelConfig_NonSkKeyAndInjectionGuard(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("GEMINI_API_KEY", "")
	if _, err := LoadWithError(dir); err != nil {
		t.Fatalf("init config: %v", err)
	}

	// 1. 保存非 sk- 前缀密钥（如 Gemini AIza...）并重新加载，验证不会把密钥当环境变量名写坏
	err := SaveModelConfig(dir, "gemini", ModelConfig{
		Type:         "openai",
		BaseURL:      "https://generativelanguage.googleapis.com/v1beta/openai",
		DefaultModel: "gemini-2.5-pro",
	}, "AIzaSyDummyKey12345", true)
	if err != nil {
		t.Fatalf("SaveModelConfig failed: %v", err)
	}

	reloaded, err := LoadWithError(dir)
	if err != nil {
		t.Fatalf("reload failed: %v", err)
	}
	if reloaded.Agent.DefaultModelProvider != "gemini" {
		t.Errorf("expected default provider gemini, got %q", reloaded.Agent.DefaultModelProvider)
	}
	if reloaded.Agent.Models["gemini"].APIKey != "AIzaSyDummyKey12345" {
		t.Errorf("expected reloaded gemini APIKey AIzaSyDummyKey12345, got %q", reloaded.Agent.Models["gemini"].APIKey)
	}

	// 2. 拦截换行符环境变量注入攻击
	err = SaveModelConfig(dir, "evil", ModelConfig{
		Type:         "openai",
		BaseURL:      "https://example.com/v1",
		DefaultModel: "gpt-4o",
	}, "sk-123\nLD_PRELOAD=/tmp/evil.so", false)
	if err == nil {
		t.Fatal("expected error for newline injection in api_key, got nil")
	}

	// 3. 拦截非法 provider 名称
	err = SaveModelConfig(dir, "../evil=1", ModelConfig{
		Type:         "openai",
		BaseURL:      "https://example.com/v1",
		DefaultModel: "gpt-4o",
	}, "sk-123", false)
	if err == nil {
		t.Fatal("expected error for invalid provider name, got nil")
	}
}
