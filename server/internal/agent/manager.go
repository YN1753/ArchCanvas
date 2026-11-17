package agent

import (
	"archcanvas/internal/config"
	"archcanvas/internal/dto"
	"archcanvas/internal/validator"
	"archcanvas/pkg/safenet"
	"context"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"sort"
	"strings"
	"sync"

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
	HTTPClient      *http.Client
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

	clonedConfigs := make(map[string]config.ModelConfig, len(configs))
	maps.Copy(clonedConfigs, configs)

	defaultModelConfig, ok := clonedConfigs[defaultProvider]
	if !ok {
		providerNames := make([]string, 0, len(clonedConfigs))
		for p := range clonedConfigs {
			providerNames = append(providerNames, p)
		}
		sort.Strings(providerNames)
		if len(providerNames) > 0 {
			defaultProvider = providerNames[0]
			defaultModelConfig = clonedConfigs[defaultProvider]
		} else {
			slog.Warn("configs 中未配置任何大模型提供商，服务将以离线基础模式启动", "default_provider", defaultProvider)
		}
	}

	manager := &ModelManager{
		Configs:         clonedConfigs,
		CurrentProvider: defaultProvider,
		CurrentName:     defaultModelConfig.DefaultModel,
		Cache:           make(map[string]model.ToolCallingChatModel),
		ConfigDir:       configDir,
		HTTPClient:      defaultProbeHTTPClient,
	}

	// 仅当存在可用 APIKey 或本地环回端点时才预初始化，避免未配置密钥时打印冗余警告
	if defaultModelConfig.DefaultModel != "" && (defaultModelConfig.APIKey != "" || safenet.IsLoopbackEndpoint(defaultModelConfig.BaseURL)) {
		if _, err := manager.GetChatModel(ctx, defaultProvider, defaultModelConfig.DefaultModel); err != nil {
			slog.Warn("预初始化默认大模型客户端失败，待配置正确后动态生效",
				"provider", defaultProvider,
				"model", defaultModelConfig.DefaultModel,
				"error", err,
			)
		}
	}

	return manager
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

	if m.Cache != nil {
		if chatModel, ok := m.Cache[key]; ok {
			m.mu.RUnlock()
			return chatModel, nil
		}
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
	if m.Cache == nil {
		m.Cache = make(map[string]model.ToolCallingChatModel)
	}
	if existing, ok := m.Cache[key]; ok {
		m.mu.Unlock()
		return existing, nil
	}
	m.Cache[key] = chatModel
	m.mu.Unlock()

	return chatModel, nil
}

// SaveAndSwitchModel 保存模型配置至 config.yaml 与 .env，并热更新 ModelManager 运行态（无全局锁阻塞探测）。
func (m *ModelManager) SaveAndSwitchModel(ctx context.Context, req dto.SaveModelReq) (AvailableModels, error) {
	provider := strings.TrimSpace(req.Provider)
	modelName := strings.TrimSpace(req.Model)
	baseURL := safenet.NormalizeEndpointURL(req.BaseURL)
	apiKey := strings.TrimSpace(req.APIKey)

	if err := validator.ValidateProviderName(provider); err != nil {
		return AvailableModels{}, err
	}
	if modelName == "" {
		return AvailableModels{}, validator.NewValidationError("model 不能为空")
	}
	if err := validator.ValidateSingleLine("model", modelName, 256); err != nil {
		return AvailableModels{}, err
	}
	if baseURL == "" {
		return AvailableModels{}, validator.NewValidationError("base_url 不能为空")
	}
	if err := validateModelEndpointURL(baseURL); err != nil {
		return AvailableModels{}, err
	}
	if err := validator.ValidateSingleLine("api_key", apiKey, 2048); err != nil {
		return AvailableModels{}, err
	}

	m.mu.RLock()
	pCfg, exists := m.Configs[provider]
	configDir := m.ConfigDir
	m.mu.RUnlock()

	if !exists {
		pCfg = config.ModelConfig{
			Type:        "openai",
			Temperature: 0.3,
			MaxTokens:   8192,
		}
	}

	// 安全防线：若修改了 BaseURL 且未提供新 APIKey，绝不沿用旧端点的存储密钥，防止保存后将真实密钥外发至恶意地址
	prevBaseURL := safenet.NormalizeEndpointURL(pCfg.BaseURL)
	pCfg.BaseURL = baseURL
	pCfg.DefaultModel = modelName
	if apiKey != "" {
		pCfg.APIKey = apiKey
	} else if exists && prevBaseURL != baseURL {
		pCfg.APIKey = ""
	}

	// 先完成磁盘原子持久化，成功后再更新内存态，确保内存与磁盘强一致且不阻塞并发读锁
	if configDir != "" {
		if err := config.SaveModelConfig(configDir, provider, pCfg, apiKey, req.SetAsDefault); err != nil {
			return AvailableModels{}, fmt.Errorf("持久化保存 config.yaml 失败: %w", err)
		}
	}

	m.mu.Lock()
	if m.Configs == nil {
		m.Configs = make(map[string]config.ModelConfig)
	}
	m.Configs[provider] = pCfg
	for k := range m.Cache {
		if strings.HasPrefix(k, provider+":") {
			delete(m.Cache, k)
		}
	}
	if req.SetAsDefault || m.CurrentProvider == provider || m.CurrentProvider == "" {
		m.CurrentProvider = provider
		m.CurrentName = modelName
	}
	m.mu.Unlock()

	return m.listConfiguredModels(ctx), nil
}

// GetAvailableModels 获取可用模型列表。如果指定了 BaseURL 则从该 BaseURL 动态探测（只读，不污染内存配置）；未指定则并发遍历配置中的各 Provider BaseURL。
func (m *ModelManager) GetAvailableModels(ctx context.Context, req dto.GetModelsReq) (AvailableModels, error) {
	if strings.TrimSpace(req.BaseURL) != "" {
		baseURL := safenet.NormalizeEndpointURL(req.BaseURL)
		if err := validateModelEndpointURL(baseURL); err != nil {
			return AvailableModels{}, err
		}

		m.mu.RLock()
		provider := strings.TrimSpace(req.Provider)
		if provider == "" {
			for pName, pCfg := range m.Configs {
				if safenet.NormalizeEndpointURL(pCfg.BaseURL) == baseURL {
					provider = pName
					break
				}
			}
			if provider == "" {
				provider = "custom"
			}
		}

		apiKey := strings.TrimSpace(req.APIKey)
		// 安全防线 [P0-SEC-01]：仅当探测的 BaseURL 与服务端预配置的该 Provider BaseURL 完全一致时才允许复用已存 APIKey！
		// 严禁将服务端存储的真实密钥附加到调用方传入的任意第三方 BaseURL。
		if apiKey == "" {
			if cfg, ok := m.Configs[provider]; ok && safenet.NormalizeEndpointURL(cfg.BaseURL) == baseURL {
				apiKey = cfg.APIKey
			}
		}

		var providers []ProviderInfo
		hasProvider := false
		for pName, pCfg := range m.Configs {
			if pName == provider {
				hasProvider = true
			}
			providers = append(providers, ProviderInfo{
				Name:         pName,
				BaseURL:      pCfg.BaseURL,
				DefaultModel: pCfg.DefaultModel,
			})
		}
		client := m.probeClient()
		m.mu.RUnlock()

		models, err := fetchModelsFromBaseURLWithClient(ctx, client, baseURL, apiKey)
		if err != nil {
			return AvailableModels{}, fmt.Errorf("通过 BaseURL (%s) 获取模型列表失败: %w", baseURL, err)
		}

		if !hasProvider {
			defaultModel := ""
			if len(models) > 0 {
				defaultModel = models[0]
			}
			providers = append(providers, ProviderInfo{
				Name:         provider,
				BaseURL:      baseURL,
				DefaultModel: defaultModel,
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

	return m.listConfiguredModels(ctx), nil
}
