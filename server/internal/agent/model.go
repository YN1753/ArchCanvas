package agent

import (
	"archcanvas/internal/config"
	"context"
	"fmt"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"
)

func NewChatModel(ctx context.Context, cfg config.ModelConfig, modelName string) (model.BaseChatModel, error) {
	switch cfg.Type {
	case "openai":
		return openai.NewChatModel(ctx, &openai.ChatModelConfig{
			APIKey:  cfg.APIKey,
			BaseURL: cfg.BaseURL,
			Model:   modelName,
			//Temperature:         &cfg.Temperature,
			//MaxCompletionTokens: &cfg.MaxTokens,
		})
	default:
		return nil, fmt.Errorf("unknown model type: %s", cfg.Type)
	}
}
