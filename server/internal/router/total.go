package router

import (
	"archcanvas/internal/handler"
	"archcanvas/internal/middleware"

	"github.com/gin-gonic/gin"
)

func InitRouter(total handler.TotalHandler) *gin.Engine {
	r := gin.New()
	r.Use(middleware.CORS())
	route := r.Group("/api/v1")

	agent := route.Group("agent")
	{
		agent.POST("chat", total.Agent.Chat)
	}

	return r
}
