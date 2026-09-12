package main

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/config"
	"archcanvas/internal/database"
	"archcanvas/internal/handler"
	"archcanvas/internal/router"
	"archcanvas/internal/service"
	"context"
	"fmt"
)

func main() {
	cfg := config.Load("./configs")
	if _, err := database.Initialize(cfg.Database); err != nil {
		panic(err)
	}
	ctx := context.Background()
	modelManager := agent.NewModelManager(ctx, cfg.Agent.Models, cfg.Agent.DefaultModelProvider)

	requireAgent := service.NewRequirementAgent(modelManager)
	agentService := service.NewAgentService(requireAgent)

	agentHandler := handler.NewAgentHandler(agentService)
	totalHandler := handler.NewTotalHandler(agentHandler)

	r := router.InitRouter(totalHandler)
	r.Run(fmt.Sprintf("%s:%d", cfg.Service.Host, cfg.Service.Port))

}
