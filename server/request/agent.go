package request

type ChatReq struct {
	ProjectID     string `json:"project_id"`
	Input         string `json:"input" binding:"required"`
	ModelProvider string `json:"model_provider,omitempty"` // 可选模型提供商，如 deepseek / openai
	ModelName     string `json:"model_name,omitempty"`     // 可选模型名称，方便测试与切换
}

type SaveModelReq struct {
	Provider     string `json:"provider" binding:"required"`
	Model        string `json:"model" binding:"required"`
	BaseURL      string `json:"base_url" binding:"required"`
	APIKey       string `json:"api_key,omitempty"`
	SetAsDefault bool   `json:"set_as_default"`
}

