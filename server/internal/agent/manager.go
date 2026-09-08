package agent

import (
	"archcanvas/internal/config"
	"context"
	"fmt"

	"github.com/cloudwego/eino/components/model"
)

type ModelManager struct {
	configs         map[string]config.ModelConfig
	currentName     string
	currentProvider string
	cache           map[string]model.BaseChatModel
}

func NewModelManager(
	ctx context.Context,
	configs map[string]config.ModelConfig,
	defaultProvider string,
) *ModelManager {
	defaultModelConfig, ok := configs[defaultProvider]
	if !ok {
		panic(fmt.Errorf("default provider not found: %s", defaultProvider))
	}
	manager := &ModelManager{
		configs:         configs,
		currentProvider: defaultProvider,
		currentName:     defaultModelConfig.DefaultModel,
		cache:           make(map[string]model.BaseChatModel),
	}

	defaultModelKey, defaultModel, err := manager.CreateModel(
		ctx,
		defaultModelConfig.DefaultModel,
		defaultProvider,
	)
	if err != nil {
		panic(err)
	}
	manager.cache[defaultModelKey] = defaultModel

	return manager
}
func (m *ModelManager) CreateModel(ctx context.Context, name string, provider string) (string, model.BaseChatModel, error) {
	key := fmt.Sprintf("%s:%s", provider, name)
	baseModel, err := NewChatModel(ctx, m.configs[provider], name)
	if err != nil {
		return "", nil, err
	}
	return key, baseModel, nil
}
func (m *ModelManager) LoadModel(ctx context.Context) (model.BaseChatModel, error) {

	key := fmt.Sprintf(
		"%s:%s",
		m.currentProvider,
		m.currentName,
	)

	if chatModel, ok := m.cache[key]; ok {
		return chatModel, nil
	}

	_, chatModel, err := m.CreateModel(
		ctx,
		m.currentName,
		m.currentProvider,
	)
	if err != nil {
		return nil, err
	}

	m.cache[key] = chatModel

	return chatModel, nil
}
func (m *ModelManager) SwitchModel(ctx context.Context, name string, provider string) (model.BaseChatModel, error) {
	key := fmt.Sprintf("%s:%s", provider, name)
	if chatModel, ok := m.cache[key]; ok {
		m.currentName = name
		m.currentProvider = provider
		return chatModel, nil
	}
	_, chatModel, err := m.CreateModel(ctx, name, provider)
	if err != nil {
		return nil, err
	}
	m.cache[key] = chatModel
	m.currentProvider = provider
	m.currentName = name
	return chatModel, nil
}
