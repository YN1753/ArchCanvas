package agent

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

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

func TestModelManager_ConcurrentSafety(t *testing.T) {
	ctx := context.Background()
	configs := map[string]config.ModelConfig{
		"mock1": {Type: "openai", BaseURL: "http://localhost:8000", DefaultModel: "gpt-4o"},
		"mock2": {Type: "openai", BaseURL: "http://localhost:8001", DefaultModel: "deepseek-r1"},
	}
	mgr := NewModelManager(ctx, configs, "mock1", t.TempDir())

	const goroutines = 50
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			if idx%3 == 0 {
				_ = mgr.CurrentModelKey()
			} else if idx%3 == 1 {
				mgr.mu.Lock()
				mgr.CurrentProvider = "mock2"
				mgr.CurrentName = "deepseek-r1"
				mgr.mu.Unlock()
			} else {
				_, _ = mgr.GetChatModel(ctx, "mock1", "gpt-4o")
			}
		}(i)
	}

	wg.Wait()
}

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestFetchModelsHTTPWithRetry_ExponentialBackoff(t *testing.T) {
	attempts := 0

	// 使用内存 RoundTripper 模拟服务，避免沙箱环境下 TCP socket 监听被隔离阻止
	originalTransport := httpClient.Transport
	defer func() { httpClient.Transport = originalTransport }()

	httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		attempts++
		if attempts < 3 {
			// 前两次模拟服务瞬时过载 503
			return &http.Response{
				StatusCode: http.StatusServiceUnavailable,
				Status:     "503 Service Unavailable",
				Body:       io.NopCloser(strings.NewReader("service unavailable")),
				Header:     make(http.Header),
			}, nil
		}
		// 第三次成功恢复
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(`{"data": [{"id": "gpt-4o"}]}`)),
			Header:     make(http.Header),
		}, nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	models, status, err := fetchModelsHTTPWithRetry(ctx, "http://mock-api.internal/v1/models", "fake_key")
	if err != nil {
		t.Fatalf("expected retry to succeed eventually, got err: %v", err)
	}
	if status != http.StatusOK {
		t.Errorf("expected status 200, got %d", status)
	}
	if len(models) != 1 || models[0] != "gpt-4o" {
		t.Errorf("expected model gpt-4o, got %v", models)
	}
	if attempts != 3 {
		t.Errorf("expected exactly 3 attempts, got %d", attempts)
	}
}

