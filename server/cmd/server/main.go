package main

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/config"
	"context"
)

func main() {
	cfg := config.Load("./configs")
	ctx := context.Background()
	modelManager := agent.NewModelManager(ctx, cfg.Agent.Models, cfg.Agent.DefaultModelProvider)
}
