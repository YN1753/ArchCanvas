package handler

type TotalHandler struct {
	Agent AgentHandler
}

func NewTotalHandler(agent AgentHandler) TotalHandler {
	return TotalHandler{
		Agent: agent,
	}
}
