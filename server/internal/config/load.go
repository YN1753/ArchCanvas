package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

func Load(configDir string) *Config {
	envPath := filepath.Join(configDir, ".env")
	if err := godotenv.Load(envPath); err != nil {
		panic(err)
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
			panic(fmt.Errorf(
				"api key not found in .env: %s",
				modelConfig.APIKey,
			))
		}

		modelConfig.APIKey = apiKey
		cfg.Agent.Models[name] = modelConfig
	}

	// 默认模型 Provider
	cfg.Agent.DefaultModelProvider = os.Getenv("DEFAULT_PROVIDER")
	if cfg.Agent.DefaultModelProvider == "" {
		panic(fmt.Errorf("DEFAULT_PROVIDER not found in .env"))
	}

	if _, ok := cfg.Agent.Models[cfg.Agent.DefaultModelProvider]; !ok {
		panic(fmt.Errorf(
			"default provider not found: %s",
			cfg.Agent.DefaultModelProvider,
		))
	}

	return &cfg
}
