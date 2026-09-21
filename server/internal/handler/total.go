package handler

// TotalHandler 聚合所有业务模块的 HTTP 控制器
type TotalHandler struct {
	Agent   AgentHandler
	Project ProjectHandler
}

func NewTotalHandler(agent AgentHandler, project ProjectHandler) TotalHandler {
	return TotalHandler{
		Agent:   agent,
		Project: project,
	}
}
