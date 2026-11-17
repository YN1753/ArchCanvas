package config

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"archcanvas/internal/validator"

	"github.com/goccy/go-yaml"
	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

var (
	envRefRe         = regexp.MustCompile(`^[A-Z][A-Z0-9_]+$`)
	nonEnvIdentChars = regexp.MustCompile(`[^A-Z0-9_]`)
)

const defaultConfigYAML = `agent:
  default_model_provider: deepseek
  models:
    deepseek:
      api_key: DEEPSEEK_API_KEY
      base_url: https://api.deepseek.com/v1
      default_model: deepseek-chat
      max_tokens: 8192
      temperature: 0.3
      type: openai
    openai:
      api_key: OPENAI_API_KEY
      base_url: https://api.openai.com/v1
      default_model: gpt-4o
      max_tokens: 8192
      temperature: 0.7
      type: openai
database:
  path: ./data/archcanvas.db
server:
  host: 127.0.0.1
  port: 8080
`

// isEnvReference 判断配置中的 api_key 字符串是否为环境变量引用名（如 DEEPSEEK_API_KEY）而非真实密钥。
func isEnvReference(val string) bool {
	trimmed := strings.TrimSpace(val)
	return trimmed != "" && envRefRe.MatchString(trimmed)
}

// sanitizeEnvKeyPrefix 将 provider 名规范化为安全的全大写环境变量前缀。
func sanitizeEnvKeyPrefix(provider string) string {
	upper := strings.ToUpper(strings.TrimSpace(provider))
	upper = strings.ReplaceAll(upper, "-", "_")
	upper = nonEnvIdentChars.ReplaceAllString(upper, "_")
	upper = strings.Trim(upper, "_")
	if upper == "" {
		return "CUSTOM"
	}
	if upper[0] >= '0' && upper[0] <= '9' {
		upper = "PROVIDER_" + upper
	}
	return upper
}

// writeFileAtomic 使用同目录临时文件 + Rename 实现原子落盘，并强制收紧权限位。
func writeFileAtomic(targetPath string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create config directory %q: %w", dir, err)
	}

	tmpFile, err := os.CreateTemp(dir, ".archcanvas-cfg-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp file in %q: %w", dir, err)
	}
	tmpName := tmpFile.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := tmpFile.Chmod(perm); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("chmod temp file: %w", err)
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("sync temp file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}

	if err := os.Rename(tmpName, targetPath); err != nil {
		return fmt.Errorf("atomic rename %q -> %q: %w", tmpName, targetPath, err)
	}
	cleanup = false
	return nil
}

// Load 加载配置目录；发生解析异常时记录错误并回退默认配置以保持兼容签名。
func Load(configDir string) *Config {
	cfg, err := LoadWithError(configDir)
	if err != nil {
		slog.Error("加载配置文件失败，已回退内置安全默认配置", "config_dir", configDir, "error", err)
		return &Config{
			Service:  Server{Host: "127.0.0.1", Port: 8080},
			Database: Database{Path: "./data/archcanvas.db"},
			Agent:    AgentConfig{Models: make(map[string]ModelConfig)},
		}
	}
	return cfg
}

// LoadWithError 加载并解析配置文件与 .env 环境变量，不触发 panic 且不在运行期修改全局进程环境变量。
func LoadWithError(configDir string) (*Config, error) {
	if strings.TrimSpace(configDir) == "" {
		configDir = "./configs"
	}

	configPath := filepath.Join(configDir, "config.yaml")
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		if err := writeFileAtomic(configPath, []byte(defaultConfigYAML), 0o600); err != nil {
			return nil, fmt.Errorf("initialize default config.yaml: %w", err)
		}
	}

	envPath := filepath.Join(configDir, ".env")
	if _, err := os.Stat(envPath); os.IsNotExist(err) {
		_ = writeFileAtomic(envPath, []byte("# ArchCanvas Environment Variables\n# DEEPSEEK_API_KEY=your_key_here\n"), 0o600)
	}

	// 只读解析 .env 文件字典，避免运行期修改全局进程环境变量引发并发竞态
	dotEnvMap, _ := godotenv.Read(envPath)
	lookupEnv := func(key string) string {
		if key == "" {
			return ""
		}
		if v := os.Getenv(key); v != "" {
			return v
		}
		if dotEnvMap != nil {
			return dotEnvMap[key]
		}
		return ""
	}

	v := viper.New()
	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(configDir)

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config.yaml: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config.yaml: %w", err)
	}

	cfg.Agent.Models = make(map[string]ModelConfig)
	models := v.GetStringMap("agent.models")

	modelNames := make([]string, 0, len(models))
	for name := range models {
		modelNames = append(modelNames, name)
	}
	sort.Strings(modelNames)

	for _, name := range modelNames {
		var modelConfig ModelConfig
		if err := v.UnmarshalKey("agent.models."+name, &modelConfig); err != nil {
			return nil, fmt.Errorf("unmarshal agent.models.%s: %w", name, err)
		}

		rawKey := strings.TrimSpace(modelConfig.APIKey)
		resolvedKey := lookupEnv(rawKey)
		if resolvedKey == "" {
			// 若是未设置的环境变量占位符（如 DEEPSEEK_API_KEY），置为空串而非误当作真实 Bearer Token
			if !isEnvReference(rawKey) {
				resolvedKey = rawKey
			}
		}

		modelConfig.APIKey = resolvedKey
		cfg.Agent.Models[name] = modelConfig
	}

	defaultProvider := lookupEnv("DEFAULT_PROVIDER")
	if defaultProvider == "" {
		defaultProvider = cfg.Agent.DefaultModelProvider
	}
	if defaultProvider == "" && len(modelNames) > 0 {
		defaultProvider = modelNames[0]
	}
	cfg.Agent.DefaultModelProvider = defaultProvider

	// 解析简历公开演示沙盒模式配置（支持 SHOWCASE_MODE=true/1/yes/on 或 config.yaml showcase.enabled）
	if rawMode := strings.ToLower(strings.TrimSpace(lookupEnv("SHOWCASE_MODE"))); rawMode != "" {
		cfg.Showcase.Enabled = rawMode == "true" || rawMode == "1" || rawMode == "yes" || rawMode == "on"
	}
	if vStr := strings.TrimSpace(lookupEnv("SHOWCASE_IP_DAILY_LIMIT")); vStr != "" {
		if n, err := strconv.Atoi(vStr); err == nil && n > 0 {
			cfg.Showcase.IPDailyLimit = n
		}
	}
	if vStr := strings.TrimSpace(lookupEnv("SHOWCASE_GLOBAL_DAILY_LIMIT")); vStr != "" {
		if n, err := strconv.Atoi(vStr); err == nil && n > 0 {
			cfg.Showcase.GlobalDailyLimit = n
		}
	}
	if vStr := strings.TrimSpace(lookupEnv("SHOWCASE_VISITOR_TTL_HOURS")); vStr != "" {
		if n, err := strconv.Atoi(vStr); err == nil && n > 0 {
			cfg.Showcase.VisitorTTLHours = n
		}
	}
	if vStr := strings.TrimSpace(lookupEnv("SHOWCASE_MAX_PROJECTS_PER_VISITOR")); vStr != "" {
		if n, err := strconv.Atoi(vStr); err == nil && n > 0 {
			cfg.Showcase.MaxProjectsPerVisitor = n
		}
	}
	cfg.Showcase.NormalizeDefaults()

	return &cfg, nil
}

// UpdateEnvFile 原子更新 .env 文件中的指定键值对（权限 0600），严格拦截换行与键名注入。
func UpdateEnvFile(envPath string, updates map[string]string) error {
	for k, v := range updates {
		if !isEnvReference(k) {
			return validator.NewValidationError("非法的环境变量名 %q", k)
		}
		if err := validator.ValidateSingleLine(k, v, 4096); err != nil {
			return err
		}
	}

	data, err := os.ReadFile(envPath)
	var lines []string
	if err == nil {
		lines = strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	}

	updatedKeys := make(map[string]bool, len(updates))
	var newLines []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			newLines = append(newLines, line)
			continue
		}
		parts := strings.SplitN(trimmed, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			if newVal, ok := updates[key]; ok {
				newLines = append(newLines, fmt.Sprintf("%s=%s", key, newVal))
				updatedKeys[key] = true
				continue
			}
		}
		newLines = append(newLines, line)
	}

	sortedKeys := make([]string, 0, len(updates))
	for k := range updates {
		if !updatedKeys[k] {
			sortedKeys = append(sortedKeys, k)
		}
	}
	sort.Strings(sortedKeys)

	for _, k := range sortedKeys {
		if len(newLines) > 0 && newLines[len(newLines)-1] != "" {
			newLines = append(newLines, "")
		}
		newLines = append(newLines, fmt.Sprintf("%s=%s", k, updates[k]))
	}

	content := strings.Join(newLines, "\n")
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return writeFileAtomic(envPath, []byte(content), 0o600)
}

// SaveModelConfig 将模型配置原子持久化写入 config.yaml 与 .env 文件（权限 0600）。
func SaveModelConfig(configDir string, provider string, modelCfg ModelConfig, apiKeyDirect string, setAsDefault bool) error {
	if err := validator.ValidateProviderName(provider); err != nil {
		return err
	}
	if err := validator.ValidateSingleLine("default_model", modelCfg.DefaultModel, 256); err != nil {
		return err
	}
	if err := validator.ValidateSingleLine("base_url", modelCfg.BaseURL, 1024); err != nil {
		return err
	}
	if err := validator.ValidateSingleLine("api_key", apiKeyDirect, 2048); err != nil {
		return err
	}

	configPath := filepath.Join(configDir, "config.yaml")
	envPath := filepath.Join(configDir, ".env")

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			data = []byte(defaultConfigYAML)
		} else {
			return fmt.Errorf("读取 config.yaml 失败: %w", err)
		}
	}

	var root map[string]any
	if err := yaml.Unmarshal(data, &root); err != nil {
		return fmt.Errorf("解析 config.yaml 失败: %w", err)
	}
	if root == nil {
		root = make(map[string]any)
	}

	agentMap, _ := root["agent"].(map[string]any)
	if agentMap == nil {
		agentMap = make(map[string]any)
		root["agent"] = agentMap
	}

	modelsMap, _ := agentMap["models"].(map[string]any)
	if modelsMap == nil {
		modelsMap = make(map[string]any)
		agentMap["models"] = modelsMap
	}

	provMap, _ := modelsMap[provider].(map[string]any)
	if provMap == nil {
		provMap = make(map[string]any)
		modelsMap[provider] = provMap
	}

	mType := strings.TrimSpace(modelCfg.Type)
	if mType == "" {
		mType = "openai"
	}
	provMap["type"] = mType
	provMap["default_model"] = strings.TrimSpace(modelCfg.DefaultModel)
	provMap["base_url"] = strings.TrimSpace(modelCfg.BaseURL)

	temp := modelCfg.Temperature
	if temp == 0 {
		if existingTemp, ok := provMap["temperature"].(float64); ok && existingTemp > 0 {
			temp = float32(existingTemp)
		} else {
			temp = 0.3
		}
	}
	provMap["temperature"] = temp

	maxTokens := modelCfg.MaxTokens
	if maxTokens == 0 {
		switch v := provMap["max_tokens"].(type) {
		case int:
			if v > 0 {
				maxTokens = v
			}
		case uint64:
			if v > 0 {
				maxTokens = int(v)
			}
		case int64:
			if v > 0 {
				maxTokens = int(v)
			}
		}
		if maxTokens == 0 {
			maxTokens = 8192
		}
	}
	provMap["max_tokens"] = maxTokens

	envUpdates := make(map[string]string)

	if strings.TrimSpace(apiKeyDirect) != "" {
		apiKeyClean := strings.TrimSpace(apiKeyDirect)
		existingKeyRef, _ := provMap["api_key"].(string)
		envKeyName := strings.TrimSpace(existingKeyRef)
		// 仅当原值本身就是合法的环境变量引用名（如 DEEPSEEK_API_KEY）时才沿用，否则生成标准引用名
		if !isEnvReference(envKeyName) {
			envKeyName = sanitizeEnvKeyPrefix(provider) + "_API_KEY"
		}
		provMap["api_key"] = envKeyName
		envUpdates[envKeyName] = apiKeyClean
	}

	if setAsDefault {
		agentMap["default_model_provider"] = provider
		envUpdates["DEFAULT_PROVIDER"] = provider
	}

	if len(envUpdates) > 0 {
		if err := UpdateEnvFile(envPath, envUpdates); err != nil {
			return fmt.Errorf("写入 .env 失败: %w", err)
		}
	}

	out, err := yaml.Marshal(root)
	if err != nil {
		return fmt.Errorf("序列化 config.yaml 失败: %w", err)
	}

	if err := writeFileAtomic(configPath, out, 0o600); err != nil {
		return fmt.Errorf("写入 config.yaml 失败: %w", err)
	}

	return nil
}
