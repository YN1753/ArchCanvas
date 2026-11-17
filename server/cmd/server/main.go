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
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
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
	flag.StringVar(&hostFlag, "host", "", "HTTP 服务绑定主机地址 (默认 127.0.0.1；局域网访问请指定 0.0.0.0)")
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

	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	baseDir := getBaseDir()

	configDir := configFlag
	if configDir == "" {
		configDir = filepath.Join(baseDir, "configs")
	}

	cfg, err := config.LoadWithError(configDir)
	if err != nil {
		slog.Error("加载配置文件失败，已回退默认配置", "config_dir", configDir, "error", err)
		cfg = config.Load(configDir)
	}

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

	// 主机优先级: 命令行参数 -host > 环境变量 HOST > 配置文件 server.host > 默认 127.0.0.1（本机安全模式）
	if hostFlag != "" {
		cfg.Service.Host = hostFlag
	} else if envHost := os.Getenv("HOST"); envHost != "" {
		cfg.Service.Host = envHost
	}
	if cfg.Service.Host == "" {
		cfg.Service.Host = "127.0.0.1"
	}

	// 数据库路径优先级: 命令行参数 -data > 配置文件（相对路径自动定位到可执行文件基准目录）
	if dataFlag != "" {
		cfg.Database.Path = dataFlag
	} else if cfg.Database.Path != "" && cfg.Database.Path != ":memory:" && !strings.HasPrefix(cfg.Database.Path, "file:") && !filepath.IsAbs(cfg.Database.Path) {
		cfg.Database.Path = filepath.Join(baseDir, cfg.Database.Path)
	}

	db, err := database.InitSQLite(cfg.Database)
	if err != nil {
		slog.Error("初始化 SQLite 数据库失败", "path", cfg.Database.Path, "error", err)
		os.Exit(1)
	}

	appCtx, appCancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer appCancel()

	erDesignRepo := repository.NewERDesignRepository(db)
	projectRepo := repository.NewProjectRepository(db)
	messageRepo := repository.NewMessageRepository(db)

	modelManager := agent.NewModelManager(appCtx, cfg.Agent.Models, cfg.Agent.DefaultModelProvider, configDir)

	projectService := service.NewProjectService(projectRepo, erDesignRepo, messageRepo, modelManager)
	projectHandler := handler.NewProjectHandler(projectService)

	agentService := service.NewAgentService(modelManager, projectService)
	agentHandler := handler.NewAgentHandler(agentService)

	generatorService, err := generator.NewGeneratorService(projectService)
	if err != nil {
		slog.Error("初始化代码生成器失败", "error", err)
		os.Exit(1)
	}
	generatorHandler := handler.NewGeneratorHandler(generatorService)
	healthHandler := handler.NewHealthHandler(db)

	totalHandler := handler.NewTotalHandler(agentHandler, projectHandler, generatorHandler, healthHandler)
	r := router.InitRouter(totalHandler)

	printBanner(cfg, configDir)

	addr := net.JoinHostPort(cfg.Service.Host, strconv.Itoa(cfg.Service.Port))
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
		// 将应用级可取消 Context 注入 BaseContext，确保收到停机信号时活跃 SSE 流立即感知取消并退出
		BaseContext: func(_ net.Listener) context.Context {
			return appCtx
		},
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("启动 HTTP 服务失败", "addr", addr, "error", err)
			os.Exit(1)
		}
	}()

	<-appCtx.Done()
	appCancel()
	slog.Info("接收到系统停机信号，正在通知活跃连接与后台任务优雅退出…")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Warn("HTTP 服务停机超时或异常", "error", err)
	}

	// 等待在途 Agent 后台协程完成收尾落库后再关闭 SQLite，防止 sql: database is closed 竞态
	if err := agentService.Wait(shutdownCtx); err != nil {
		slog.Warn("等待后台 Agent 任务排空超时", "error", err)
	}

	if sqlDB, err := db.DB(); err == nil {
		if err := sqlDB.Close(); err != nil {
			slog.Warn("关闭 SQLite 数据库连接池异常", "error", err)
		} else {
			slog.Info("SQLite 数据库连接已安全关闭")
		}
	}

	slog.Info("ArchCanvas 服务已安全退出")
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
	cleanDir := filepath.Clean(dir)
	lower := strings.ToLower(cleanDir)
	if strings.Contains(lower, "go-build") {
		return true
	}
	sysTmp := filepath.Clean(os.TempDir())
	if sysTmp != "" && sysTmp != "." && sysTmp != string(filepath.Separator) {
		if strings.HasPrefix(strings.ToLower(cleanDir), strings.ToLower(sysTmp)+string(filepath.Separator)) {
			return true
		}
	}
	return false
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
	if cfg.Service.Host != "127.0.0.1" && cfg.Service.Host != "localhost" && cfg.Service.Host != "::1" {
		fmt.Printf("  │  * 局域网访问   : %-41s│\n", netURL)
	}
	fmt.Printf("  │  * 数据文件     : %-41s│\n", truncatePath(cfg.Database.Path, 41))
	fmt.Printf("  │  * 配置目录     : %-41s│\n", truncatePath(configDir, 41))
	fmt.Println("  ╰─────────────────────────────────────────────────────────────╯")
	fmt.Println()
}

// truncatePath 按 Unicode Rune 字符安全截断路径，防止破坏中文多字节 UTF-8 字符。
func truncatePath(p string, maxLen int) string {
	runes := []rune(p)
	if len(runes) <= maxLen {
		return p
	}
	if maxLen <= 3 {
		return string(runes[:maxLen])
	}
	return "..." + string(runes[len(runes)-(maxLen-3):])
}
