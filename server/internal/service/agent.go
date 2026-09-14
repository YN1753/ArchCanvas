package service

import (
	"archcanvas/internal/repository"
	"context"
	"errors"

	"github.com/cloudwego/eino/schema"
)

type AgentService struct {
	Requirement  RequirementAgent
	ERDesignRepo *repository.ERDesignRepository
}

func NewAgentService(
	require RequirementAgent,
	erDesignRepo *repository.ERDesignRepository,
) AgentService {
	return AgentService{
		Requirement:  require,
		ERDesignRepo: erDesignRepo,
	}
}

func (a *AgentService) Run(ctx context.Context, input string) (*schema.StreamReader[*schema.Message], error) {
	resp, err := a.Requirement.Run(ctx, RequirementInput{
		Message: input,
	})
	return resp, err
}

func (a *AgentService) AnalyzeRequirement(
	ctx context.Context,
	projectID string,
	input string,
) (*RequirementResult, error) {
	if a.ERDesignRepo == nil {
		return nil, errors.New("er design repository is not configured")
	}

	currentERDesign, err := a.ERDesignRepo.GetByProjectID(ctx, projectID)
	if err != nil {
		return nil, err
	}

	return a.Requirement.Analyze(ctx, RequirementInput{
		Message:         input,
		CurrentERDesign: currentERDesign,
	})
}
