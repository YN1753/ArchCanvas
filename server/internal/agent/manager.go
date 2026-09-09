package agent

import (
	"archcanvas/internal/config"
	"context"
	"fmt"

	"github.com/cloudwego/eino/components/model"
)

type ModelManager struct {
	Configs         map[string]config.ModelConfig
	CurrentName     string
	CurrentProvider string
	Cache           map[string]model.BaseChatModel
}

func NewModelManager(
	ctx context.Context,
	configs map[string]config.ModelConfig,
	defaultProvider string,
) ModelManager {
	defaultModelConfig, ok := configs[defaultProvider]
	if !ok {
		panic(fmt.Errorf("default provider not found: %s", defaultProvider))
	}
	manager := &ModelManager{
		Configs:         configs,
		CurrentProvider: defaultProvider,
		CurrentName:     defaultModelConfig.DefaultModel,
		Cache:           make(map[string]model.BaseChatModel),
	}

	defaultModelKey, defaultModel, err := manager.CreateModel(
		ctx,
		defaultModelConfig.DefaultModel,
		defaultProvider,
	)
	if err != nil {
		panic(err)
	}
	manager.Cache[defaultModelKey] = defaultModel

	return *manager
}
func (m *ModelManager) GetKey() string {
	return fmt.Sprintf("%s:%s", m.CurrentProvider, m.CurrentName)
}
func (m *ModelManager) CreateModel(ctx context.Context, name string, provider string) (string, model.BaseChatModel, error) {
	key := fmt.Sprintf("%s:%s", provider, name)
	baseModel, err := NewChatModel(ctx, m.Configs[provider], name)
	if err != nil {
		return "", nil, err
	}
	return key, baseModel, nil
}
func (m *ModelManager) LoadModel(ctx context.Context) (model.BaseChatModel, error) {

	key := fmt.Sprintf(
		"%s:%s",
		m.CurrentProvider,
		m.CurrentName,
	)

	if chatModel, ok := m.Cache[key]; ok {
		return chatModel, nil
	}

	_, chatModel, err := m.CreateModel(
		ctx,
		m.CurrentName,
		m.CurrentProvider,
	)
	if err != nil {
		return nil, err
	}

	m.Cache[key] = chatModel

	return chatModel, nil
}
func (m *ModelManager) SwitchModel(ctx context.Context, name string, provider string) (model.BaseChatModel, error) {
	key := fmt.Sprintf("%s:%s", provider, name)
	if chatModel, ok := m.Cache[key]; ok {
		m.CurrentName = name
		m.CurrentProvider = provider
		return chatModel, nil
	}
	_, chatModel, err := m.CreateModel(ctx, name, provider)
	if err != nil {
		return nil, err
	}
	m.Cache[key] = chatModel
	m.CurrentProvider = provider
	m.CurrentName = name
	return chatModel, nil
}
