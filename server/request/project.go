package request

type CreateProjectReq struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

type GetModelsReq struct {
	BaseURL  string `form:"base_url" json:"base_url"`
	APIKey   string `form:"api_key" json:"api_key"`
	Provider string `form:"provider" json:"provider"`
}

