package domain

// AIContextContent 项目持久化 AI 演进上下文载荷。
type AIContextContent struct {
	Goal        string   `json:"goal"`
	TechStack   []string `json:"tech_stack"`
	Decisions   []string `json:"decisions"`
	Constraints []string `json:"constraints"`
	Progress    string   `json:"progress"`
}
