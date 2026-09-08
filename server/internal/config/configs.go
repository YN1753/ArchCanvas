package config

type Config struct {
	Agent    AgentConfig `mapstructure:"agent"`
	Service  Server      `mapstructure:"server"`
	Database Database    `mapstructure:"database"`
}

type Server struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
}
type Database struct {
	Path string `mapstructure:"path"`
}
type AgentConfig struct {
	Models               map[string]ModelConfig `mapstructure:"model"`
	DefaultModelProvider string                 `mapstructure:"default_model_provider"`
}

type ModelConfig struct {
	Type         string  `mapstructure:"type"`
	APIKey       string  `mapstructure:"api_key"`
	BaseURL      string  `mapstructure:"base_url"`
	DefaultModel string  `mapstructure:"default_model"`
	Temperature  float32 `mapstructure:"temperature"`
	MaxTokens    int     `mapstructure:"max_tokens"`
}
