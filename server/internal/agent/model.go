package agent

import (
	"archcanvas/internal/config"
	"context"
	"fmt"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"
)

func NewChatModel(ctx context.Context, cfg config.ModelConfig, modelName string) (model.ToolCallingChatModel, error) {
	switch cfg.Type {
	case "openai":
		chatCfg := &openai.ChatModelConfig{
			APIKey:  cfg.APIKey,
			BaseURL: cfg.BaseURL,
			Model:   modelName,
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
