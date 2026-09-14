package request

type GetChatReq struct {
	Input string `json:"input" binding:"required"`
}

type AnalyzeRequirementReq struct {
	ProjectID string `json:"project_id" binding:"required"`
	Input     string `json:"input" binding:"required"`
}
