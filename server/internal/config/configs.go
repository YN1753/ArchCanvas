package config

type Config struct {
	Agent    AgentConfig    `mapstructure:"agent" yaml:"agent"`
	Service  Server         `mapstructure:"server" yaml:"server"`
	Database Database       `mapstructure:"database" yaml:"database"`
	Showcase ShowcaseConfig `mapstructure:"showcase" yaml:"showcase,omitempty"`
}

type Server struct {
	Host string `mapstructure:"host" yaml:"host"`
	Port int    `mapstructure:"port" yaml:"port"`
}

type Database struct {
	Path string `mapstructure:"path" yaml:"path"`
}

type ShowcaseConfig struct {
	Enabled               bool `mapstructure:"enabled" yaml:"enabled"`
	IPDailyLimit          int  `mapstructure:"ip_daily_limit" yaml:"ip_daily_limit"`
	GlobalDailyLimit      int  `mapstructure:"global_daily_limit" yaml:"global_daily_limit"`
	VisitorTTLHours       int  `mapstructure:"visitor_ttl_hours" yaml:"visitor_ttl_hours"`
	MaxProjectsPerVisitor int  `mapstructure:"max_projects_per_visitor" yaml:"max_projects_per_visitor"`
}

func (s *ShowcaseConfig) NormalizeDefaults() {
	if s.IPDailyLimit <= 0 {
		s.IPDailyLimit = 20
	}
	if s.GlobalDailyLimit <= 0 {
		s.GlobalDailyLimit = 100
	}
	if s.VisitorTTLHours <= 0 {
		s.VisitorTTLHours = 24
	}
	if s.MaxProjectsPerVisitor <= 0 {
		s.MaxProjectsPerVisitor = 10
	}
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
