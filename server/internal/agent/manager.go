package agent

import (
	"archcanvas/internal/config"
	"archcanvas/request"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/cloudwego/eino/components/model"
)

type ModelItem struct {
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Label     string `json:"label"`
	BaseURL   string `json:"base_url,omitempty"`
	IsDefault bool   `json:"is_default"`
}

type ProviderInfo struct {
	Name         string `json:"name"`
	BaseURL      string `json:"base_url"`
	DefaultModel string `json:"default_model"`
}

type AvailableModels struct {
	DefaultProvider string         `json:"default_provider"`
	DefaultModel    string         `json:"default_model"`
	Providers       []ProviderInfo `json:"providers"`
	Models          []ModelItem    `json:"models"`
}

type ModelManager struct {
	Configs         map[string]config.ModelConfig
	CurrentName     string
	CurrentProvider string
	Cache           map[string]model.ToolCallingChatModel
	ConfigDir       string
	mu              sync.RWMutex
}

func NewModelManager(
	ctx context.Context,
	configs map[string]config.ModelConfig,
	defaultProvider string,
	configDir string,
) *ModelManager {
	if configDir == "" {
		configDir = "./configs"
	}
	defaultModelConfig, ok := configs[defaultProvider]
	if !ok {
		// 如果未找到指定默认 provider，尝试使用第一个
		for p, c := range configs {
			defaultProvider = p
			defaultModelConfig = c
			ok = true
			break
		}
		if !ok {
			panic(fmt.Errorf("default provider not found: %s", defaultProvider))
		}
	}
	manager := &ModelManager{
		Configs:         configs,
		CurrentProvider: defaultProvider,
		CurrentName:     defaultModelConfig.DefaultModel,
		Cache:           make(map[string]model.ToolCallingChatModel),
		ConfigDir:       configDir,
	}

	if _, err := manager.GetChatModel(ctx, defaultProvider, defaultModelConfig.DefaultModel); err != nil {
		panic(err)
	}

	return manager
}

// CurrentModelKey 获取当前激活模型的组合标识 (provider:model)
func (m *ModelManager) CurrentModelKey() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return fmt.Sprintf("%s:%s", m.CurrentProvider, m.CurrentName)
}

// GetKey 保持向后兼容
func (m *ModelManager) GetKey() string {
	return m.CurrentModelKey()
}

// GetChatModel 获取或懒加载指定的工具调用模型实例；provider 或 name 为空时自动使用当前配置。
func (m *ModelManager) GetChatModel(ctx context.Context, provider, name string) (model.ToolCallingChatModel, error) {
	m.mu.RLock()
	if provider == "" {
		provider = m.CurrentProvider
	}
	if name == "" {
		name = m.CurrentName
	}
	key := fmt.Sprintf("%s:%s", provider, name)

	if chatModel, ok := m.Cache[key]; ok {
		m.mu.RUnlock()
		return chatModel, nil
	}

	cfg, ok := m.Configs[provider]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("provider config not found: %s", provider)
	}

	chatModel, err := NewChatModel(ctx, cfg, name)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	m.Cache[key] = chatModel
	m.mu.Unlock()

	return chatModel, nil
}

// GetModel 保持兼容的调用别名
func (m *ModelManager) GetModel(ctx context.Context, provider, name string) (model.ToolCallingChatModel, error) {
	return m.GetChatModel(ctx, provider, name)
}

// SwitchModel 临时切换当前会话所用的活跃模型
func (m *ModelManager) SwitchModel(ctx context.Context, name string, provider string) (model.ToolCallingChatModel, error) {
	chatModel, err := m.GetChatModel(ctx, provider, name)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.CurrentProvider = provider
	m.CurrentName = name
	m.mu.Unlock()
	return chatModel, nil
}

// FetchModelsFromBaseURL 请求指定 baseURL 的 OpenAI/Ollama 兼容 models 接口，动态获取可用模型
func FetchModelsFromBaseURL(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	baseURL = strings.TrimSpace(baseURL)
	baseURL = strings.TrimRight(baseURL, "/")
	if baseURL == "" {
		return nil, errors.New("base_url is required")
	}

	targetURL := baseURL
	if !strings.HasSuffix(targetURL, "/models") {
		targetURL = targetURL + "/models"
	}

	models, status, err := fetchModelsHTTP(ctx, targetURL, apiKey)
	// 如果目标地址返回 404 且原 URL 未包含 /v1，尝试补充 /v1/models 重试
	if err != nil && status == http.StatusNotFound && !strings.Contains(baseURL, "/v1") {
		retryURL := baseURL + "/v1/models"
		if m, _, err2 := fetchModelsHTTP(ctx, retryURL, apiKey); err2 == nil && len(m) > 0 {
			return m, nil
		}
	}
	// 如果依然 404，尝试适配本地 Ollama 的 /api/tags 端点
	if err != nil && status == http.StatusNotFound {
		cleanBase := strings.TrimSuffix(baseURL, "/v1")
		ollamaURL := cleanBase + "/api/tags"
		if m, _, err3 := fetchModelsHTTP(ctx, ollamaURL, apiKey); err3 == nil && len(m) > 0 {
			return m, nil
		}
	}
	if err != nil {
		return nil, err
	}
	return models, nil
}

var httpClient = &http.Client{Timeout: 6 * time.Second}

func fetchModelsHTTP(ctx context.Context, targetURL, apiKey string) ([]string, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}

	var modelSet = make(map[string]struct{})
	var result []string

	// 1. 标准 OpenAI 格式: { "data": [ { "id": "model-name" } ] }
	var openAIResp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &openAIResp); err == nil && len(openAIResp.Data) > 0 {
		for _, item := range openAIResp.Data {
			id := strings.TrimSpace(item.ID)
			if id != "" {
				if _, exists := modelSet[id]; !exists {
					modelSet[id] = struct{}{}
					result = append(result, id)
				}
			}
		}
		if len(result) > 0 {
			sort.Strings(result)
			return result, resp.StatusCode, nil
		}
	}

	// 2. Ollama / API tags 格式: { "models": [ { "name": "...", "model": "..." } ] }
	var ollamaResp struct {
		Models []struct {
			Name  string `json:"name"`
			Model string `json:"model"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &ollamaResp); err == nil && len(ollamaResp.Models) > 0 {
		for _, item := range ollamaResp.Models {
			name := strings.TrimSpace(item.Name)
			if name == "" {
				name = strings.TrimSpace(item.Model)
			}
			if name != "" {
				if _, exists := modelSet[name]; !exists {
					modelSet[name] = struct{}{}
					result = append(result, name)
				}
			}
		}
		if len(result) > 0 {
			sort.Strings(result)
			return result, resp.StatusCode, nil
		}
	}

	// 3. 通用字符串数组格式: ["gpt-4o", ...]
	var stringList []string
	if err := json.Unmarshal(body, &stringList); err == nil && len(stringList) > 0 {
		for _, item := range stringList {
			id := strings.TrimSpace(item)
			if id != "" {
				if _, exists := modelSet[id]; !exists {
					modelSet[id] = struct{}{}
					result = append(result, id)
				}
			}
		}
		if len(result) > 0 {
			sort.Strings(result)
			return result, resp.StatusCode, nil
		}
	}

	return nil, resp.StatusCode, errors.New("no models found in response")
}

// SaveAndSwitchModel 保存模型配置至 config.yaml 与 .env，并热更新 ModelManager 运行态
func (m *ModelManager) SaveAndSwitchModel(ctx context.Context, req request.SaveModelReq) (AvailableModels, error) {
	provider := strings.TrimSpace(req.Provider)
	modelName := strings.TrimSpace(req.Model)
	baseURL := strings.TrimSpace(req.BaseURL)
	apiKey := strings.TrimSpace(req.APIKey)

	if provider == "" {
		return AvailableModels{}, errors.New("provider 不能为空")
	}
	if modelName == "" {
		return AvailableModels{}, errors.New("model 不能为空")
	}
	if baseURL == "" {
		return AvailableModels{}, errors.New("base_url 不能为空")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	pCfg, exists := m.Configs[provider]
	if !exists {
		pCfg = config.ModelConfig{
			Type:        "openai",
			Temperature: 0.3,
			MaxTokens:   8192,
		}
	}
	pCfg.BaseURL = baseURL
	pCfg.DefaultModel = modelName
	if apiKey != "" {
		pCfg.APIKey = apiKey
	}
	m.Configs[provider] = pCfg

	// 清理该 provider 的历史缓存，使后续调用即时以新配置热生效
	for k := range m.Cache {
		if strings.HasPrefix(k, provider+":") {
			delete(m.Cache, k)
		}
	}

	if req.SetAsDefault || m.CurrentProvider == provider {
		m.CurrentProvider = provider
		m.CurrentName = modelName
	}

	// 持久化到 config.yaml 与 .env
	if m.ConfigDir != "" {
		if err := config.SaveModelConfig(m.ConfigDir, provider, pCfg, apiKey, req.SetAsDefault); err != nil {
			return AvailableModels{}, fmt.Errorf("持久化保存 config.yaml 失败: %w", err)
		}
	}

	return m.getAvailableModelsLocked(ctx), nil
}

// GetAvailableModels 获取可用模型列表。如果指定了 BaseURL 则从该 BaseURL 动态获取；未指定则遍历配置中的各 Provider BaseURL。
func (m *ModelManager) GetAvailableModels(ctx context.Context, req request.GetModelsReq) (AvailableModels, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 指定了 BaseURL：向该 BaseURL 发起网络请求获取模型
	if strings.TrimSpace(req.BaseURL) != "" {
		baseURL := strings.TrimSpace(req.BaseURL)
		provider := req.Provider
		if provider == "" {
			for pName, pCfg := range m.Configs {
				if strings.TrimRight(pCfg.BaseURL, "/") == strings.TrimRight(baseURL, "/") {
					provider = pName
					break
				}
			}
			if provider == "" {
				provider = "custom"
			}
		}

		apiKey := req.APIKey
		if apiKey == "" {
			if cfg, ok := m.Configs[provider]; ok {
				apiKey = cfg.APIKey
			}
		}

		models, err := FetchModelsFromBaseURL(ctx, baseURL, apiKey)
		if err != nil {
			return AvailableModels{}, fmt.Errorf("通过 BaseURL (%s) 获取模型列表失败: %w", baseURL, err)
		}

		cfg, ok := m.Configs[provider]
		if !ok {
			cfg = config.ModelConfig{
				Type:        "openai",
				Temperature: 0.3,
				MaxTokens:   8192,
			}
		}
		cfg.BaseURL = baseURL
		if apiKey != "" {
			cfg.APIKey = apiKey
		}
		if len(models) > 0 && cfg.DefaultModel == "" {
			cfg.DefaultModel = models[0]
		}
		m.Configs[provider] = cfg

		var providers []ProviderInfo
		for pName, pCfg := range m.Configs {
			providers = append(providers, ProviderInfo{
				Name:         pName,
				BaseURL:      pCfg.BaseURL,
				DefaultModel: pCfg.DefaultModel,
			})
		}
		sort.Slice(providers, func(i, j int) bool {
			return providers[i].Name < providers[j].Name
		})

		var list []ModelItem
		for i, name := range models {
			list = append(list, ModelItem{
				Provider:  provider,
				Model:     name,
				Label:     fmt.Sprintf("%s (%s)", provider, name),
				BaseURL:   baseURL,
				IsDefault: i == 0,
			})
		}

		return AvailableModels{
			DefaultProvider: provider,
			DefaultModel:    "",
			Providers:       providers,
			Models:          list,
		}, nil
	}

	return m.getAvailableModelsLocked(ctx), nil
}

func (m *ModelManager) getAvailableModelsLocked(ctx context.Context) AvailableModels {
	var providers []ProviderInfo
	for pName, pCfg := range m.Configs {
		providers = append(providers, ProviderInfo{
			Name:         pName,
			BaseURL:      pCfg.BaseURL,
			DefaultModel: pCfg.DefaultModel,
		})
	}
	sort.Slice(providers, func(i, j int) bool {
		return providers[i].Name < providers[j].Name
	})

	var allModels []ModelItem
	for provider, cfg := range m.Configs {
		var fetched []string
		if cfg.BaseURL != "" {
			models, err := FetchModelsFromBaseURL(ctx, cfg.BaseURL, cfg.APIKey)
			if err == nil && len(models) > 0 {
				fetched = models
			}
		}

		if len(fetched) > 0 {
			for _, name := range fetched {
				isDefault := (provider == m.CurrentProvider && name == cfg.DefaultModel)
				allModels = append(allModels, ModelItem{
					Provider:  provider,
					Model:     name,
					Label:     fmt.Sprintf("%s (%s)", provider, name),
					BaseURL:   cfg.BaseURL,
					IsDefault: isDefault,
				})
			}
		} else {
			// 保底降级策略：网络不可达时保留配置文件中的默认模型
			isDefault := (provider == m.CurrentProvider)
			allModels = append(allModels, ModelItem{
				Provider:  provider,
				Model:     cfg.DefaultModel,
				Label:     fmt.Sprintf("%s (%s)", provider, cfg.DefaultModel),
				BaseURL:   cfg.BaseURL,
				IsDefault: isDefault,
			})
		}
	}

	sort.Slice(allModels, func(i, j int) bool {
		if allModels[i].Provider == allModels[j].Provider {
			return allModels[i].Model < allModels[j].Model
		}
		return allModels[i].Provider < allModels[j].Provider
	})

	return AvailableModels{
		DefaultProvider: m.CurrentProvider,
		DefaultModel:    m.CurrentName,
		Providers:       providers,
		Models:          allModels,
	}
}
