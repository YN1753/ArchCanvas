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
		models.GET("list", handlers.Project.GetModels)
		// 保存模型配置并持久化至 config.yaml 与 .env
		models.POST("save", handlers.Project.SaveModel)
	}

	projects := route.Group("projects")
	{
		projects.GET("list", handlers.Project.ListProjects)            // 项目列表
		projects.POST("create", handlers.Project.CreateProject)        // 创建项目
		projects.POST("delete", handlers.Project.DeleteProject)        // 删除项目
		projects.POST("update", handlers.Project.UpdateProject)        // 更新/重命名项目
		projects.GET("detail", handlers.Project.GetProject)            // 项目详情
		projects.GET("get-er-design", handlers.Project.GetERDesign)                    // 获取 ER 设计图
		projects.POST("save-er-design", handlers.Project.SaveERDesign)                 // 保存 ER 设计图
		projects.GET("get-conceptual-design", handlers.Project.GetConceptualDesign)    // 获取概念模型 (陈氏图)
		projects.POST("save-conceptual-design", handlers.Project.SaveConceptualDesign) // 保存概念模型 (陈氏图)
		projects.GET("messages", handlers.Project.ListMessages)                        // 获取项目对话历史
		projects.POST("messages/clear", handlers.Project.ClearMessages)// 清空项目对话历史
	}

	agent := route.Group("agent")
	{
		agent.POST("chat", handlers.Agent.Chat)
	}

	generator := route.Group("generator")
	{
		generator.POST("preview", handlers.Generator.Preview)
		generator.POST("download", handlers.Generator.Download)
	}

	return r
}
