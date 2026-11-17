package agent

import (
	"archcanvas/internal/config"
	"context"
	"fmt"
	"strings"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"
)

func NewChatModel(ctx context.Context, cfg config.ModelConfig, modelName string) (model.ToolCallingChatModel, error) {
	if strings.TrimSpace(cfg.BaseURL) != "" {
		if err := validateModelEndpointURL(cfg.BaseURL); err != nil {
			return nil, fmt.Errorf("invalid model base_url: %w", err)
		}
	}

	switch cfg.Type {
	case "openai":
		chatCfg := &openai.ChatModelConfig{
			APIKey:     cfg.APIKey,
			BaseURL:    cfg.BaseURL,
			Model:      modelName,
			HTTPClient: newSafeModelHTTPClient(),
		}
		if cfg.Temperature > 0 {
			chatCfg.Temperature = &cfg.Temperature
		}
		if cfg.MaxTokens > 0 {
			chatCfg.MaxTokens = &cfg.MaxTokens
		}
		return openai.NewChatModel(ctx, chatCfg)
	default:
		return nil, fmt.Errorf("unknown model type: %s", cfg.Type)
	}
}
