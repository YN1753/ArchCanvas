package agent

import (
	"archcanvas/internal/config"
	"archcanvas/internal/dto"
	"archcanvas/internal/validator"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"net/url"
	"os"
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
			ok = true
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
		HTTPClient:      httpClient,
	}

	// 仅当存在可用 APIKey 或本地环回端点时才预初始化，避免未配置密钥时打印冗余警告
	if defaultModelConfig.DefaultModel != "" && (defaultModelConfig.APIKey != "" || isLoopbackEndpoint(defaultModelConfig.BaseURL)) {
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

func isLoopbackEndpoint(rawURL string) bool {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

func normalizeEndpointURL(rawURL string) string {
	return strings.TrimRight(strings.TrimSpace(rawURL), "/")
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

// GetModel 保持兼容的调用别名
func (m *ModelManager) GetModel(ctx context.Context, provider, name string) (model.ToolCallingChatModel, error) {
	return m.GetChatModel(ctx, provider, name)
}

// SwitchModel 临时切换当前活跃模型（安全解析空参数，防止覆盖为空串）
func (m *ModelManager) SwitchModel(ctx context.Context, name string, provider string) (model.ToolCallingChatModel, error) {
	m.mu.RLock()
	resolvedProvider := strings.TrimSpace(provider)
	if resolvedProvider == "" {
		resolvedProvider = m.CurrentProvider
	}
	resolvedName := strings.TrimSpace(name)
	if resolvedName == "" {
		resolvedName = m.CurrentName
	}
	m.mu.RUnlock()

	chatModel, err := m.GetChatModel(ctx, resolvedProvider, resolvedName)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.CurrentProvider = resolvedProvider
	m.CurrentName = resolvedName
	m.mu.Unlock()
	return chatModel, nil
}

// isDisallowedIP 判断 IP 是否属于云元数据、链路本地、未指定或多播等高危 SSRF 目标。
func isDisallowedIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	ipStr := ip.String()
	// 拦截阿里云 IMDS (100.100.100.200) 与 AWS IPv6 IMDS (fd00:ec2::254)
	if ipStr == "100.100.100.200" || strings.EqualFold(ipStr, "fd00:ec2::254") {
		return true
	}
	// 若显式启用公网共享安全隔离模式，额外禁止访问内网私有网段与本机环回
	if os.Getenv("ARCHCANVAS_BLOCK_PRIVATE_MODEL_URLS") == "1" {
		if ip.IsPrivate() || ip.IsLoopback() {
			return true
		}
	}
	return false
}

// validateModelEndpointURL 校验模型探测 BaseURL 的协议合法性，并拦截云元数据与链路本地地址以防范 SSRF。
func validateModelEndpointURL(rawURL string) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return validator.NewValidationError("invalid base_url: %v", err)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return validator.NewValidationError("unsupported url scheme %q: only http and https are allowed", parsed.Scheme)
	}
	if parsed.User != nil {
		return validator.NewValidationError("credentials in base_url are not allowed")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return validator.NewValidationError("base_url host is required")
	}
	switch host {
	case "metadata.google.internal", "metadata", "metadata.azure.internal", "169.254.169.254", "100.100.100.200":
		return validator.NewValidationError("disallowed metadata host %q", host)
	}
	if ip := net.ParseIP(host); ip != nil {
		if isDisallowedIP(ip) {
			return validator.NewValidationError("disallowed IP address %q", host)
		}
	}
	return nil
}

func newSafeDialContext(timeout time.Duration) func(ctx context.Context, network, addr string) (net.Conn, error) {
	dialer := &net.Dialer{
		Timeout:   timeout,
		KeepAlive: 30 * time.Second,
	}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("no IP addresses resolved for host %q", host)
		}
		for _, ipAddr := range ips {
			if isDisallowedIP(ipAddr.IP) {
				return nil, fmt.Errorf("blocked SSRF connection to disallowed resolved IP %s for host %q", ipAddr.IP.String(), host)
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}
}

func safeCheckRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 3 {
		return errors.New("stopped after 3 redirects")
	}
	if err := validateModelEndpointURL(req.URL.String()); err != nil {
		return fmt.Errorf("blocked unsafe redirect target: %w", err)
	}
	// 跨主机重定向时剥离 Authorization 头，严防 302 诱导泄露 APIKey
	if len(via) > 0 && !strings.EqualFold(req.URL.Host, via[0].URL.Host) {
		req.Header.Del("Authorization")
	}
	return nil
}

func newSafeProbeHTTPClient() *http.Client {
	return &http.Client{
		Timeout:       6 * time.Second,
		CheckRedirect: safeCheckRedirect,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           newSafeDialContext(4 * time.Second),
			MaxIdleConns:          32,
			IdleConnTimeout:       60 * time.Second,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 6 * time.Second,
		},
	}
}

func newSafeModelHTTPClient() *http.Client {
	return &http.Client{
		CheckRedirect: safeCheckRedirect,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           newSafeDialContext(10 * time.Second),
			MaxIdleConns:          64,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
		},
	}
}

var httpClient = newSafeProbeHTTPClient()

func (m *ModelManager) probeClient() *http.Client {
	if m != nil && m.HTTPClient != nil {
		return m.HTTPClient
	}
	return httpClient
}

// FetchModelsFromBaseURL 请求指定 baseURL 的 OpenAI/Ollama 兼容 models 接口，动态获取可用模型
func FetchModelsFromBaseURL(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	return fetchModelsFromBaseURLWithClient(ctx, httpClient, baseURL, apiKey)
}

func fetchModelsFromBaseURLWithClient(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]string, error) {
	baseURL = normalizeEndpointURL(baseURL)
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

// fetchModelsHTTPWithRetry 封装带有指数退避（Exponential Backoff）重试的 HTTP 请求
func fetchModelsHTTPWithRetry(ctx context.Context, targetURL, apiKey string) ([]string, int, error) {
	return fetchModelsHTTPWithRetryClient(ctx, httpClient, targetURL, apiKey)
}

func fetchModelsHTTPWithRetryClient(ctx context.Context, client *http.Client, targetURL, apiKey string) ([]string, int, error) {
	if client == nil {
		client = httpClient
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

func fetchModelsHTTP(ctx context.Context, targetURL, apiKey string) ([]string, int, error) {
	return fetchModelsHTTPClient(ctx, httpClient, targetURL, apiKey)
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

	// 2. Ollama / API tags 格式
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

	// 3. 通用字符串数组格式
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

// SaveAndSwitchModel 保存模型配置至 config.yaml 与 .env，并热更新 ModelManager 运行态（无全局锁阻塞探测）。
func (m *ModelManager) SaveAndSwitchModel(ctx context.Context, req dto.SaveModelReq) (AvailableModels, error) {
	provider := strings.TrimSpace(req.Provider)
	modelName := strings.TrimSpace(req.Model)
	baseURL := normalizeEndpointURL(req.BaseURL)
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
	prevBaseURL := normalizeEndpointURL(pCfg.BaseURL)
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
		baseURL := normalizeEndpointURL(req.BaseURL)
		if err := validateModelEndpointURL(baseURL); err != nil {
			return AvailableModels{}, err
		}

		m.mu.RLock()
		provider := strings.TrimSpace(req.Provider)
		if provider == "" {
			for pName, pCfg := range m.Configs {
				if normalizeEndpointURL(pCfg.BaseURL) == baseURL {
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
			if cfg, ok := m.Configs[provider]; ok && normalizeEndpointURL(cfg.BaseURL) == baseURL {
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

// listConfiguredModels 快照读取内存配置后释放锁，并发探测各提供商可用模型，避免慢网络冻结全局模型读写。
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
			// 仅当配置了真实 APIKey 或是本地无需鉴权的端点（如 Ollama）时才发起远程探测，避免空密钥无意义请求外网
			if c.BaseURL != "" && (c.APIKey != "" || isLoopbackEndpoint(c.BaseURL)) {
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
