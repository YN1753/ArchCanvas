package router

import (
	"archcanvas/internal/handler"
	"archcanvas/internal/middleware"
	"archcanvas/internal/static"

	"github.com/gin-gonic/gin"
)

// InitRouter 初始化 Gin 路由引擎（保持原有签名向后兼容）
func InitRouter(handlers handler.TotalHandler) *gin.Engine {
	return InitRouterWithShowcase(handlers, nil)
}

// InitRouterWithShowcase 初始化 Gin 路由引擎，并在开启 SHOWCASE_MODE 时挂载访客沙盒隔离、敏感接口封锁与 AI 体验配额限流。
func InitRouterWithShowcase(handlers handler.TotalHandler, quotaMgr *middleware.ShowcaseQuotaManager) *gin.Engine {
	showcaseEnabled := quotaMgr != nil && quotaMgr.Enabled()
	if !showcaseEnabled && handlers.Project.ProjectService != nil && handlers.Project.ProjectService.ShowcaseCfg.Enabled {
		showcaseEnabled = true
	}

	r := gin.New()
	_ = r.SetTrustedProxies(nil) // 显式禁用默认全信任反向代理，防范客户端 IP 伪造
	r.Use(middleware.TraceMiddleware())
	r.Use(middleware.RequestLogger())
	r.Use(middleware.Recovery())
	r.Use(middleware.CORS())
	r.Use(middleware.MaxBodyBytes(middleware.DefaultMaxBodyBytes))
	r.Use(middleware.OptionalTokenAuth())
	r.Use(middleware.ShowcaseVisitorMiddleware(showcaseEnabled))

	// 根路径健康探针（适配容器与反向代理探活）
	r.GET("/healthz", handlers.Health.Check)

	route := r.Group("/api/v1")
	route.GET("healthz", handlers.Health.Check)
	route.GET("showcase/status", handlers.Project.ShowcaseStatus)

	// ================= 1. 模型管理 (演示模式下锁死 save 与 probe 防改配置与 SSRF) =================
	models := route.Group("models")
	models.Use(middleware.ShowcaseModelGuardMiddleware(showcaseEnabled))
	{
		models.GET("list", handlers.Project.GetModels)
		// 支持通过 POST JSON Body 安全传递探测所需的 base_url 与 api_key，避免密钥出现在 URL Query 中
		models.POST("list", handlers.Project.ProbeModels)
		models.POST("probe", handlers.Project.ProbeModels)
		// 保存模型配置并持久化至 config.yaml 与 .env
		models.POST("save", handlers.Project.SaveModel)
	}

	projects := route.Group("projects")
	{
		projects.GET("list", handlers.Project.ListProjects)                            // 项目列表
		projects.POST("create", handlers.Project.CreateProject)                        // 创建项目
		projects.POST("fork", handlers.Project.ForkProject)                            // 克隆项目/样板至访客沙盒
		projects.POST("delete", handlers.Project.DeleteProject)                        // 删除项目
		projects.POST("update", handlers.Project.UpdateProject)                        // 更新/重命名项目
		projects.GET("detail", handlers.Project.GetProject)                            // 项目详情
		projects.GET("get-er-design", handlers.Project.GetERDesign)                    // 获取 ER 设计图
		projects.POST("save-er-design", handlers.Project.SaveERDesign)                 // 保存 ER 设计图
		projects.GET("get-conceptual-design", handlers.Project.GetConceptualDesign)    // 获取概念模型 (陈氏图)
		projects.POST("save-conceptual-design", handlers.Project.SaveConceptualDesign) // 保存概念模型 (陈氏图)
		projects.GET("messages", handlers.Project.ListMessages)                        // 获取项目对话历史
		projects.POST("messages/clear", handlers.Project.ClearMessages)                // 清空项目对话历史
	}

	agent := route.Group("agent")
	if quotaMgr != nil && showcaseEnabled {
		agent.Use(quotaMgr.AgentRateLimitMiddleware())
	}
	{
		agent.POST("chat", handlers.Agent.Chat)
		agent.POST("propose-concepts", handlers.Agent.ProposeConcepts) // Layer 1: 业务概念建模
		agent.POST("derive-physical", handlers.Agent.DerivePhysical)   // Layer 2: 物理表与索引工程推导
		agent.POST("review-schema", handlers.Agent.ReviewSchema)       // Layer 3: 架构质量与性能体检
		agent.POST("enrich-semantics", handlers.Agent.EnrichSemantics) // 全图概念层语义推导
	}

	generator := route.Group("generator")
	{
		generator.POST("preview", handlers.Generator.Preview)
		generator.POST("download", handlers.Generator.Download)
	}

	// 注册内嵌前端静态页面与 SPA 路由兜底回退
	static.RegisterSPA(r)

	return r
}
