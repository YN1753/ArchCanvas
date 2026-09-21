package router

import (
	"archcanvas/internal/handler"
	"archcanvas/internal/middleware"

	"github.com/gin-gonic/gin"
)

// InitRouter 初始化 Gin 路由引擎并注册纯语义风格 API 路由（只使用 GET 与 POST）
func InitRouter(handlers handler.TotalHandler) *gin.Engine {
	r := gin.New()
	r.Use(middleware.CORS())
	route := r.Group("/api/v1")

	// ================= 1. 模型管理 (纯语义 GET/POST) =================
	models := route.Group("models")
	{
		// 获取当前配置的模型，或传入 base_url/provider/api_key 实时探测可用模型列表
		models.GET("list", handlers.Project.GetModels)
		// 保存模型配置并持久化至 config.yaml 与 .env
		models.POST("save", handlers.Project.SaveModel)
	}

	// ================= 2. 项目与 ER 设计管理 (纯语义 GET/POST) =================
	projects := route.Group("projects")
	{
		projects.GET("list", handlers.Project.ListProjects)           // 项目列表
		projects.POST("create", handlers.Project.CreateProject)       // 创建项目
		projects.GET("detail", handlers.Project.GetProject)           // 项目详情
		projects.GET("get-er-design", handlers.Project.GetERDesign)   // 获取 ER 设计图
		projects.POST("save-er-design", handlers.Project.SaveERDesign)// 保存 ER 设计图
	}

	// ================= 3. AI Agent 对话 (POST) =================
	agent := route.Group("agent")
	{
		agent.POST("chat", handlers.Agent.Chat) // 流式对话 (SSE)
	}

	return r
}
