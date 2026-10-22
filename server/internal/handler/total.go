package handler

// TotalHandler 聚合所有业务模块的 HTTP 控制器
type TotalHandler struct {
	Agent     AgentHandler
	Project   ProjectHandler
	Generator GeneratorHandler
	Health    HealthHandler
}

func NewTotalHandler(agent AgentHandler, project ProjectHandler, generator GeneratorHandler, health HealthHandler) TotalHandler {
	return TotalHandler{
		Agent:     agent,
		Project:   project,
		Generator: generator,
		Health:    health,
	}
}
