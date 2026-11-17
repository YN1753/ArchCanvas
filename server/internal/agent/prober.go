package agent

import (
	"archcanvas/internal/config"
	"archcanvas/internal/validator"
	"archcanvas/pkg/safenet"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

var defaultProbeHTTPClient = safenet.NewProbeHTTPClient()

func validateModelEndpointURL(rawURL string) error {
	if err := safenet.ValidateEndpointURL(rawURL); err != nil {
		return validator.NewValidationError("%s", err.Error())
	}
	return nil
}

func (m *ModelManager) probeClient() *http.Client {
	if m != nil && m.HTTPClient != nil {
		return m.HTTPClient
	}
	return defaultProbeHTTPClient
}

// listConfiguredModels 快照读取内存配置后释放锁，并发探测各提供商可用模型，探测不可达时回退默认模型列表。
func (m *ModelManager) listConfiguredModels(ctx context.Context) AvailableModels {
	m.mu.RLock()
	configsSnapshot := make(map[string]config.ModelConfig, len(m.Configs))
	maps.Copy(configsSnapshot, m.Configs)
	currentProvider := m.CurrentProvider
	currentName := m.CurrentName
	client := m.probeClient()
	m.mu.RUnlock()

	providers := make([]ProviderInfo, 0, len(configsSnapshot))
	for pName, pCfg := range configsSnapshot {
		providers = append(providers, ProviderInfo{
			Name:         pName,
			BaseURL:      pCfg.BaseURL,
			DefaultModel: pCfg.DefaultModel,
		})
	}
	sort.Slice(providers, func(i, j int) bool {
		return providers[i].Name < providers[j].Name
	})

	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	type providerResult struct {
		items []ModelItem
	}
	results := make([]providerResult, len(providers))

	var wg sync.WaitGroup
	for idx, pInfo := range providers {
		cfg := configsSnapshot[pInfo.Name]
		wg.Add(1)
		go func(i int, provider string, c config.ModelConfig) {
			defer wg.Done()
			var fetched []string
			if c.BaseURL != "" && (c.APIKey != "" || safenet.IsLoopbackEndpoint(c.BaseURL)) {
				if models, err := fetchModelsFromBaseURLWithClient(probeCtx, client, c.BaseURL, c.APIKey); err == nil && len(models) > 0 {
					fetched = models
				}
			}

			var items []ModelItem
			if len(fetched) > 0 {
				for _, name := range fetched {
					isDefault := (provider == currentProvider && name == c.DefaultModel)
					items = append(items, ModelItem{
						Provider:  provider,
						Model:     name,
						Label:     fmt.Sprintf("%s (%s)", provider, name),
						BaseURL:   c.BaseURL,
						IsDefault: isDefault,
					})
				}
			} else if c.DefaultModel != "" {
				isDefault := (provider == currentProvider)
				items = append(items, ModelItem{
					Provider:  provider,
					Model:     c.DefaultModel,
					Label:     fmt.Sprintf("%s (%s)", provider, c.DefaultModel),
					BaseURL:   c.BaseURL,
					IsDefault: isDefault,
				})
			}
			results[i] = providerResult{items: items}
		}(idx, pInfo.Name, cfg)
	}
	wg.Wait()

	var allModels []ModelItem
	for _, r := range results {
		allModels = append(allModels, r.items...)
	}

	sort.Slice(allModels, func(i, j int) bool {
		if allModels[i].Provider == allModels[j].Provider {
			return allModels[i].Model < allModels[j].Model
		}
		return allModels[i].Provider < allModels[j].Provider
	})

	return AvailableModels{
		DefaultProvider: currentProvider,
		DefaultModel:    currentName,
		Providers:       providers,
		Models:          allModels,
	}
}

func fetchModelsFromBaseURLWithClient(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]string, error) {
	baseURL = safenet.NormalizeEndpointURL(baseURL)
	if baseURL == "" {
		return nil, validator.NewValidationError("base_url is required")
	}
	if err := validateModelEndpointURL(baseURL); err != nil {
		return nil, err
	}

	targetURL := baseURL
	if !strings.HasSuffix(targetURL, "/models") {
		targetURL = targetURL + "/models"
	}

	models, status, err := fetchModelsHTTPWithRetryClient(ctx, client, targetURL, apiKey)
	if err != nil && status == http.StatusNotFound && !strings.Contains(baseURL, "/v1") {
		retryURL := baseURL + "/v1/models"
		if m, _, err2 := fetchModelsHTTPWithRetryClient(ctx, client, retryURL, apiKey); err2 == nil && len(m) > 0 {
			return m, nil
		}
	}
	if err != nil && status == http.StatusNotFound {
		cleanBase := strings.TrimSuffix(baseURL, "/v1")
		ollamaURL := cleanBase + "/api/tags"
		if m, _, err3 := fetchModelsHTTPWithRetryClient(ctx, client, ollamaURL, apiKey); err3 == nil && len(m) > 0 {
			return m, nil
		}
	}
	if err != nil {
		return nil, err
	}
	return models, nil
}

func fetchModelsHTTPWithRetryClient(ctx context.Context, client *http.Client, targetURL, apiKey string) ([]string, int, error) {
	if client == nil {
		client = defaultProbeHTTPClient
	}
	const maxAttempts = 3
	backoff := 100 * time.Millisecond

	var lastErr error
	var lastStatus int

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		models, status, err := fetchModelsHTTPClient(ctx, client, targetURL, apiKey)
		if err == nil && status == http.StatusOK {
			return models, status, nil
		}

		lastErr = err
		lastStatus = status

		if status == http.StatusNotFound || status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusBadRequest {
			return nil, status, err
		}

		if attempt < maxAttempts {
			select {
			case <-time.After(backoff):
				backoff *= 2
			case <-ctx.Done():
				return nil, lastStatus, ctx.Err()
			}
		}
	}
	return nil, lastStatus, lastErr
}

func fetchModelsHTTPClient(ctx context.Context, client *http.Client, targetURL, apiKey string) ([]string, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	const maxModelListBodyBytes = 2 << 20 // 2 MiB 上限
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxModelListBodyBytes))
	if err != nil {
		return nil, resp.StatusCode, err
	}

	models, err := parseModelListResponse(body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return models, resp.StatusCode, nil
}

func parseModelListResponse(body []byte) ([]string, error) {
	// 1. 标准 OpenAI 格式: { "data": [ { "id": "model-name" } ] }
	var openAIResp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &openAIResp); err == nil && len(openAIResp.Data) > 0 {
		raw := make([]string, 0, len(openAIResp.Data))
		for _, item := range openAIResp.Data {
			raw = append(raw, item.ID)
		}
		if out := dedupeAndSortModelNames(raw); len(out) > 0 {
			return out, nil
		}
	}

	// 2. Ollama / API tags 格式
	var ollamaResp struct {
		Models []struct {
			Name  string `json:"name"`
			Model string `json:"model"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &ollamaResp); err == nil && len(ollamaResp.Models) > 0 {
		raw := make([]string, 0, len(ollamaResp.Models))
		for _, item := range ollamaResp.Models {
			name := strings.TrimSpace(item.Name)
			if name == "" {
				name = strings.TrimSpace(item.Model)
			}
			raw = append(raw, name)
		}
		if out := dedupeAndSortModelNames(raw); len(out) > 0 {
			return out, nil
		}
	}

	// 3. 通用字符串数组格式
	var stringList []string
	if err := json.Unmarshal(body, &stringList); err == nil && len(stringList) > 0 {
		if out := dedupeAndSortModelNames(stringList); len(out) > 0 {
			return out, nil
		}
	}

	return nil, errors.New("no models found in response")
}

func dedupeAndSortModelNames(names []string) []string {
	seen := make(map[string]struct{}, len(names))
	out := make([]string, 0, len(names))
	for _, raw := range names {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; !exists {
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out
}
