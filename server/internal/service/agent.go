package service

import (
	"context"

	"github.com/cloudwego/eino/schema"
)

type AgentService struct {
	Requirement RequirementAgent
}

func NewAgentService(require RequirementAgent) AgentService {
	return AgentService{Requirement: require}
}

func (a *AgentService) Run(ctx context.Context, input string) (*schema.StreamReader[*schema.Message], error) {
	resp, err := a.Requirement.Run(ctx, RequirementInput{
		Message: input,
	})
	return resp, err
}
