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
	"archcanvas/internal/dto"
)

func TestNewModelManager_GracefulDegradation(t *testing.T) {
	ctx := context.Background()

	emptyConfigs := make(map[string]config.ModelConfig)
	mgrEmpty := NewModelManager(ctx, emptyConfigs, "non_existent", t.TempDir())
	if mgrEmpty == nil {
		t.Fatal("expected ModelManager instance, got nil")
	}

	invalidConfigs := map[string]config.ModelConfig{
		"custom_provider": {
			Type:         "unknown_type",
			APIKey:       "test-key",
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
	mgr.HTTPClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Body:       io.NopCloser(strings.NewReader(`{"data": [{"id": "gpt-4o"}]}`)),
				Header:     make(http.Header),
			}, nil
		}),
	}

	const goroutines = 50
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			switch idx % 3 {
			case 0:
				_, _ = mgr.GetChatModel(ctx, "mock1", "gpt-4o")
			case 1:
				_, _ = mgr.GetChatModel(ctx, "mock2", "deepseek-r1")
			default:
				_, _ = mgr.GetAvailableModels(ctx, dto.GetModelsReq{})
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

	mockClient := &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			attempts++
			if attempts < 3 {
				return &http.Response{
					StatusCode: http.StatusServiceUnavailable,
					Status:     "503 Service Unavailable",
					Body:       io.NopCloser(strings.NewReader("service unavailable")),
					Header:     make(http.Header),
				}, nil
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Body:       io.NopCloser(strings.NewReader(`{"data": [{"id": "gpt-4o"}]}`)),
				Header:     make(http.Header),
			}, nil
		}),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	models, status, err := fetchModelsHTTPWithRetryClient(ctx, mockClient, "http://mock-api.internal/v1/models", "fake_key")
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

func TestGetAvailableModels_SSRFAndKeyExfiltrationDefense(t *testing.T) {
	ctx := context.Background()

	// 1. 拦截非法协议、云元数据地址与内嵌凭据 URL
	badURLs := []string{
		"file:///etc/passwd",
		"http://169.254.169.254/latest/meta-data",
		"http://100.100.100.200/latest/meta-data",
		"http://[fd00:ec2::254]/latest/meta-data",
		"http://0.0.0.0:8080/v1",
		"https://user:pass@example.com/v1",
	}
	probeMgr := NewModelManager(ctx, nil, "", t.TempDir())
	for _, u := range badURLs {
		if _, err := probeMgr.GetAvailableModels(ctx, dto.GetModelsReq{BaseURL: u}); err == nil {
			t.Errorf("expected SSRF validation error for %q, got nil", u)
		}
	}

	// 2. 验证 [P0-SEC-01]: 探测非预配置 BaseURL 时绝不泄露已存储的真实 APIKey
	var capturedAuthHeader string
	mockClient := &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			capturedAuthHeader = req.Header.Get("Authorization")
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Body:       io.NopCloser(strings.NewReader(`{"data": [{"id": "custom-model-1"}]}`)),
				Header:     make(http.Header),
			}, nil
		}),
	}

	configs := map[string]config.ModelConfig{
		"openai": {
			Type:         "openai",
			BaseURL:      "https://api.openai.com/v1",
			APIKey:       "sk-TOP-SECRET-STORED-KEY",
			DefaultModel: "gpt-4o",
		},
	}
	mgr := NewModelManager(ctx, configs, "openai", t.TempDir())
	mgr.HTTPClient = mockClient

	// 攻击模拟：指定 provider=openai 但篡改 base_url 为攻击者域名，且不传 api_key
	res, err := mgr.GetAvailableModels(ctx, dto.GetModelsReq{
		Provider: "openai",
		BaseURL:  "https://attacker.example.com/v1",
	})
	if err != nil {
		t.Fatalf("GetAvailableModels failed: %v", err)
	}
	if capturedAuthHeader != "" {
		t.Fatalf("CRITICAL: stored API key was leaked to custom base_url! Authorization=%q", capturedAuthHeader)
	}
	if len(res.Models) != 1 || res.Models[0].Model != "custom-model-1" {
		t.Errorf("unexpected models: %+v", res.Models)
	}

	// 正向验证：当探测的 BaseURL 与预配置的 openai BaseURL 一致时，正常携带已存 APIKey
	_, err = mgr.GetAvailableModels(ctx, dto.GetModelsReq{
		Provider: "openai",
		BaseURL:  "https://api.openai.com/v1/",
	})
	if err != nil {
		t.Fatalf("GetAvailableModels matching base_url failed: %v", err)
	}
	if capturedAuthHeader != "Bearer sk-TOP-SECRET-STORED-KEY" {
		t.Errorf("expected stored key on matching base_url, got %q", capturedAuthHeader)
	}

	// 3. 验证 SaveAndSwitchModel 修改 BaseURL 但不传新 APIKey 时清空旧密钥
	_, err = mgr.SaveAndSwitchModel(ctx, dto.SaveModelReq{
		Provider: "openai",
		Model:    "custom-model-1",
		BaseURL:  "https://new-endpoint.example.com/v1",
	})
	if err != nil {
		t.Fatalf("SaveAndSwitchModel failed: %v", err)
	}
	if mgr.Configs["openai"].APIKey != "" {
		t.Fatalf("expected stored APIKey cleared when BaseURL changed without new key, got %q", mgr.Configs["openai"].APIKey)
	}
}
