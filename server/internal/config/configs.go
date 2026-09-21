package config

type Config struct {
	Agent    AgentConfig `mapstructure:"agent" yaml:"agent"`
	Service  Server      `mapstructure:"server" yaml:"server"`
	Database Database    `mapstructure:"database" yaml:"database"`
}

type Server struct {
	Host string `mapstructure:"host" yaml:"host"`
	Port int    `mapstructure:"port" yaml:"port"`
}
type Database struct {
	Path string `mapstructure:"path" yaml:"path"`
}
type AgentConfig struct {
	Models               map[string]ModelConfig `mapstructure:"models" yaml:"models"`
	DefaultModelProvider string                 `mapstructure:"default_model_provider" yaml:"default_model_provider,omitempty"`
}

type ModelConfig struct {
	Type         string  `mapstructure:"type" yaml:"type"`
	APIKey       string  `mapstructure:"api_key" yaml:"api_key"`
	BaseURL      string  `mapstructure:"base_url" yaml:"base_url"`
	DefaultModel string  `mapstructure:"default_model" yaml:"default_model"`
	Temperature  float32 `mapstructure:"temperature" yaml:"temperature"`
	MaxTokens    int     `mapstructure:"max_tokens" yaml:"max_tokens"`
}
