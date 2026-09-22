package request

// GenerateRequest 代码生成请求入参
type GenerateRequest struct {
	ProjectID        string `json:"project_id" binding:"required"`
	ModuleName       string `json:"module_name" binding:"required"`
	Port             string `json:"port"`
	DBDriver         string `json:"db_driver"` // mysql | postgres | sqlite
	EnableRedis      bool   `json:"enable_redis"`
	EnableDocker     bool   `json:"enable_docker"`
	EnableSoftDelete bool   `json:"enable_soft_delete"`
}
