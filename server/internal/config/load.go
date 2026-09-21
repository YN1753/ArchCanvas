package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/goccy/go-yaml"
	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

func Load(configDir string) *Config {
	envPath := filepath.Join(configDir, ".env")
	if err := godotenv.Load(envPath); err != nil {
		// .env 不存在时不强行崩溃，尝试仅读取环境变量
	}

	v := viper.New()
	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(configDir)

	if err := v.ReadInConfig(); err != nil {
		panic(err)
	}

	var cfg Config

	// 加载普通配置
	if err := v.Unmarshal(&cfg); err != nil {
		panic(err)
	}

	// Agent Models 单独处理 API Key
	cfg.Agent.Models = make(map[string]ModelConfig)

	models := v.GetStringMap("agent.models")

	for name := range models {
		var modelConfig ModelConfig

		if err := v.UnmarshalKey(
			"agent.models."+name,
			&modelConfig,
		); err != nil {
			panic(err)
		}

		apiKey := os.Getenv(modelConfig.APIKey)
		if apiKey == "" {
			if modelConfig.APIKey != "" {
				apiKey = modelConfig.APIKey
			}
		}

		modelConfig.APIKey = apiKey
		cfg.Agent.Models[name] = modelConfig
	}

	// 默认模型 Provider
	defaultProvider := os.Getenv("DEFAULT_PROVIDER")
	if defaultProvider == "" {
		defaultProvider = cfg.Agent.DefaultModelProvider
	}
	if defaultProvider == "" {
		for name := range cfg.Agent.Models {
			defaultProvider = name
			break
		}
	}
	cfg.Agent.DefaultModelProvider = defaultProvider

	return &cfg
}

// UpdateEnvFile 更新 .env 文件，更新指定键值对，若不存在则追加
func UpdateEnvFile(envPath string, updates map[string]string) error {
	data, err := os.ReadFile(envPath)
	var lines []string
	if err == nil {
		lines = strings.Split(string(data), "\n")
	}

	updatedKeys := make(map[string]bool)
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

	for k, v := range updates {
		if !updatedKeys[k] {
			if len(newLines) > 0 && newLines[len(newLines)-1] != "" {
				newLines = append(newLines, "")
			}
			newLines = append(newLines, fmt.Sprintf("%s=%s", k, v))
		}
	}

	content := strings.Join(newLines, "\n")
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return os.WriteFile(envPath, []byte(content), 0644)
}

// SaveModelConfig 将模型配置持久化写入 config.yaml 与 .env 文件
func SaveModelConfig(configDir string, provider string, modelCfg ModelConfig, apiKeyDirect string, setAsDefault bool) error {
	configPath := filepath.Join(configDir, "config.yaml")
	envPath := filepath.Join(configDir, ".env")

	data, err := os.ReadFile(configPath)
	if err != nil {
		return fmt.Errorf("读取 config.yaml 失败: %w", err)
	}

	var root map[string]any
	if err := yaml.Unmarshal(data, &root); err != nil {
		return fmt.Errorf("解析 config.yaml 失败: %w", err)
	}
	if root == nil {
		root = make(map[string]any)
	}

	agentRaw, ok := root["agent"]
	var agentMap map[string]any
	if ok && agentRaw != nil {
		if m, ok := agentRaw.(map[string]any); ok {
			agentMap = m
		}
	}
	if agentMap == nil {
		agentMap = make(map[string]any)
		root["agent"] = agentMap
	}

	modelsRaw, ok := agentMap["models"]
	var modelsMap map[string]any
	if ok && modelsRaw != nil {
		if m, ok := modelsRaw.(map[string]any); ok {
			modelsMap = m
		}
	}
	if modelsMap == nil {
		modelsMap = make(map[string]any)
		agentMap["models"] = modelsMap
	}

	provRaw, ok := modelsMap[provider]
	var provMap map[string]any
	if ok && provRaw != nil {
		if m, ok := provRaw.(map[string]any); ok {
			provMap = m
		}
	}
	if provMap == nil {
		provMap = make(map[string]any)
		modelsMap[provider] = provMap
	}

	// 更新模型配置字段
	mType := modelCfg.Type
	if mType == "" {
		mType = "openai"
	}
	provMap["type"] = mType
	provMap["default_model"] = modelCfg.DefaultModel
	provMap["base_url"] = modelCfg.BaseURL

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
		if existingTokens, ok := provMap["max_tokens"].(int); ok && existingTokens > 0 {
			maxTokens = existingTokens
		} else {
			maxTokens = 8192
		}
	}
	provMap["max_tokens"] = maxTokens

	envUpdates := make(map[string]string)

	// 处理 API Key
	if strings.TrimSpace(apiKeyDirect) != "" {
		apiKeyClean := strings.TrimSpace(apiKeyDirect)
		// 如果已有环境变量引用名，更新该环境变量；否则生成标准环境变量名
		existingKeyRef, _ := provMap["api_key"].(string)
		envKeyName := existingKeyRef
		if envKeyName == "" || strings.HasPrefix(envKeyName, "sk-") {
			envKeyName = strings.ToUpper(provider) + "_API_KEY"
		}
		provMap["api_key"] = envKeyName
		envUpdates[envKeyName] = apiKeyClean
		_ = os.Setenv(envKeyName, apiKeyClean)
	}

	if setAsDefault {
		agentMap["default_model_provider"] = provider
		envUpdates["DEFAULT_PROVIDER"] = provider
		_ = os.Setenv("DEFAULT_PROVIDER", provider)
	}

	if len(envUpdates) > 0 {
		_ = UpdateEnvFile(envPath, envUpdates)
	}

	// 格式化并写回 config.yaml
	out, err := yaml.Marshal(root)
	if err != nil {
		return fmt.Errorf("序列化 config.yaml 失败: %w", err)
	}

	if err := os.WriteFile(configPath, out, 0644); err != nil {
		return fmt.Errorf("写入 config.yaml 失败: %w", err)
	}

	return nil
}
