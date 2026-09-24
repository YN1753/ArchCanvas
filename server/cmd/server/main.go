package main

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/config"
	"archcanvas/internal/database"
	"archcanvas/internal/generator"
	"archcanvas/internal/handler"
	"archcanvas/internal/repository"
	"archcanvas/internal/router"
	"archcanvas/internal/service"
	"context"
	"fmt"
)

func main() {
	cfg := config.Load("./configs")
	db, err := database.InitSQLite(cfg.Database)
	if err != nil {
		panic(err)
	}

	erDesignRepo := repository.NewERDesignRepository(db)
	projectRepo := repository.NewProjectRepository(db)
	messageRepo := repository.NewMessageRepository(db)

	ctx := context.Background()
	modelManager := agent.NewModelManager(ctx, cfg.Agent.Models, cfg.Agent.DefaultModelProvider, "./configs")

	projectService := service.NewProjectService(projectRepo, erDesignRepo, messageRepo, modelManager)
	projectHandler := handler.NewProjectHandler(projectService)

	agentService := service.NewAgentService(modelManager, projectService)
	agentHandler := handler.NewAgentHandler(agentService)

	generatorService, err := generator.NewGeneratorService(projectService)
	if err != nil {
		panic(err)
	}
	generatorHandler := handler.NewGeneratorHandler(generatorService)

	totalHandler := handler.NewTotalHandler(agentHandler, projectHandler, generatorHandler)

	r := router.InitRouter(totalHandler)
	r.Run(fmt.Sprintf("%s:%d", cfg.Service.Host, cfg.Service.Port))
}
