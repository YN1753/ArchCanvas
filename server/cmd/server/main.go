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
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var (
	Version   = "v1.0.0"
	GitCommit = "dev"
	BuildTime = "unknown"
)

func main() {
	var (
		portFlag    int
		hostFlag    string
		configFlag  string
		dataFlag    string
		versionFlag bool
	)

	flag.IntVar(&portFlag, "port", 0, "HTTP 服务监听端口（优先级高于配置文件与环境变量）")
	flag.IntVar(&portFlag, "p", 0, "HTTP 服务监听端口（简写）")
	flag.StringVar(&hostFlag, "host", "", "HTTP 服务绑定主机地址 (例如 0.0.0.0 或 127.0.0.1)")
	flag.StringVar(&configFlag, "config", "", "指定配置文件目录路径（默认: 可执行文件同级 configs/ 目录）")
	flag.StringVar(&configFlag, "c", "", "指定配置文件目录路径（简写）")
	flag.StringVar(&dataFlag, "data", "", "指定 SQLite 数据库文件路径（默认: 可执行文件同级 data/archcanvas.db）")
	flag.StringVar(&dataFlag, "d", "", "指定 SQLite 数据库文件路径（简写）")
	flag.BoolVar(&versionFlag, "version", false, "显示版本信息")
	flag.BoolVar(&versionFlag, "v", false, "显示版本信息（简写）")
	flag.Parse()

	if versionFlag {
		fmt.Printf("ArchCanvas %s (commit: %s, built: %s)\n", Version, GitCommit, BuildTime)
		return
	}

	baseDir := getBaseDir()

	configDir := configFlag
	if configDir == "" {
		configDir = filepath.Join(baseDir, "configs")
	}

	cfg := config.Load(configDir)

	// 端口优先级: 命令行参数 -port > 环境变量 PORT > 配置文件 server.port > 默认 8080
	if portFlag > 0 {
		cfg.Service.Port = portFlag
	} else if envPort := os.Getenv("PORT"); envPort != "" {
		if p, err := strconv.Atoi(envPort); err == nil && p > 0 {
			cfg.Service.Port = p
		}
	}
	if cfg.Service.Port <= 0 {
		cfg.Service.Port = 8080
	}

	// 主机优先级: 命令行参数 -host > 环境变量 HOST > 配置文件 server.host > 默认 0.0.0.0
	if hostFlag != "" {
		cfg.Service.Host = hostFlag
	} else if envHost := os.Getenv("HOST"); envHost != "" {
		cfg.Service.Host = envHost
	}
	if cfg.Service.Host == "" {
		cfg.Service.Host = "0.0.0.0"
	}

	// 数据库路径优先级: 命令行参数 -data > 配置文件（相对路径自动定位到可执行文件基准目录）
	if dataFlag != "" {
		cfg.Database.Path = dataFlag
	} else if cfg.Database.Path != "" && cfg.Database.Path != ":memory:" && !filepath.IsAbs(cfg.Database.Path) {
		cfg.Database.Path = filepath.Join(baseDir, cfg.Database.Path)
	}

	db, err := database.InitSQLite(cfg.Database)
	if err != nil {
		panic(fmt.Sprintf("初始化数据库失败 [%s]: %v", cfg.Database.Path, err))
	}

	erDesignRepo := repository.NewERDesignRepository(db)
	projectRepo := repository.NewProjectRepository(db)
	messageRepo := repository.NewMessageRepository(db)

	ctx := context.Background()
	modelManager := agent.NewModelManager(ctx, cfg.Agent.Models, cfg.Agent.DefaultModelProvider, configDir)

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

	printBanner(cfg, configDir)

	addr := fmt.Sprintf("%s:%d", cfg.Service.Host, cfg.Service.Port)
	if err := r.Run(addr); err != nil {
		panic(fmt.Sprintf("启动服务失败 [%s]: %v", addr, err))
	}
}

// getBaseDir 获取可执行文件基准工作目录（打包运行时为 exe 所在目录，go run 开发时回退到当前目录）
func getBaseDir() string {
	if custom := os.Getenv("ARCHCANVAS_DIR"); custom != "" {
		return custom
	}

	execPath, err := os.Executable()
	if err == nil {
		execDir := filepath.Dir(execPath)
		if !isGoRunTempDir(execDir) {
			return execDir
		}
	}

	return "."
}

func isGoRunTempDir(dir string) bool {
	lower := strings.ToLower(dir)
	return strings.Contains(lower, "go-build") ||
		strings.Contains(lower, "tmp") ||
		strings.Contains(lower, "temp") ||
		strings.Contains(lower, "var/folders")
}

func printBanner(cfg *config.Config, configDir string) {
	port := cfg.Service.Port
	localURL := fmt.Sprintf("http://localhost:%d", port)
	netURL := fmt.Sprintf("http://%s:%d", cfg.Service.Host, port)

	fmt.Println()
	fmt.Println("  ╭─────────────────────────────────────────────────────────────╮")
	fmt.Printf("  │  ArchCanvas %-47s│\n", Version)
	fmt.Println("  │  AI 驱动的领域业务架构建模与企业级数据库智能 CAD            │")
	fmt.Println("  ├─────────────────────────────────────────────────────────────┤")
	fmt.Printf("  │  * 本地 Web 入口 : %-41s│\n", localURL)
	if cfg.Service.Host != "127.0.0.1" && cfg.Service.Host != "localhost" {
		fmt.Printf("  │  * 局域网访问   : %-41s│\n", netURL)
	}
	fmt.Printf("  │  * 数据文件     : %-41s│\n", truncatePath(cfg.Database.Path, 41))
	fmt.Printf("  │  * 配置目录     : %-41s│\n", truncatePath(configDir, 41))
	fmt.Println("  ╰─────────────────────────────────────────────────────────────╯")
	fmt.Println()
}

func truncatePath(p string, maxLen int) string {
	if len(p) <= maxLen {
		return p
	}
	return "..." + p[len(p)-maxLen+3:]
}
