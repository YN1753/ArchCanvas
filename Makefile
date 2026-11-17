.PHONY: all build build-web build-server test test-race eval eval-live check clean run

BINARY_NAME=archcanvas
VERSION?=$(shell git describe --tags --always --dirty 2>/dev/null || echo "v1.0.0")
COMMIT?=$(shell git rev-parse --short HEAD 2>/dev/null || echo "dev")
BUILD_TIME?=$(shell date -u '+%Y-%m-%dT%H:%M:%SZ')
LDFLAGS=-ldflags "-s -w -X main.Version=$(VERSION) -X main.GitCommit=$(COMMIT) -X main.BuildTime=$(BUILD_TIME)"

all: build

build-web:
	@echo "==> 构建前端静态资源 (web)..."
	@cd web && npm run build
	@echo "==> 清空历史陈旧静态产物并同步至 Go embed 目录..."
	@rm -rf server/internal/static/dist/assets
	@mkdir -p server/internal/static/dist
	@cp -r web/dist/* server/internal/static/dist/

build-server:
	@echo "==> 编译 Go 单可执行文件 (嵌入前端资源)..."
	@cd server && go build $(LDFLAGS) -o ../$(BINARY_NAME) cmd/server/main.go
	@echo "==> 构建成功: ./$(BINARY_NAME)"

build: build-web build-server

test:
	@echo "==> 运行前端测试..."
	@cd web && npm test
	@echo "==> 运行后端测试..."
	@cd server && go test ./...

test-race:
	@echo "==> 执行后端竞态检测 (go test -race)..."
	@cd server && go test -race ./...

eval:
	@echo "==> 执行离线确定性需求澄清与端到端编译/迁移基准评测 (35 场景)..."
	@cd server && go test -v ./internal/eval -run TestRunBenchmark

eval-live:
	@echo "==> 执行真实在线大模型基准评测 (ARCHCANVAS_LIVE_EVAL=1)..."
	@cd server && ARCHCANVAS_LIVE_EVAL=1 go test -v ./internal/eval -run TestRunBenchmark

check:
	@echo "==> 执行前端类型检查与单元测试..."
	@cd web && npm run typecheck && npm test
	@echo "==> 执行后端静态检查 (go vet)..."
	@cd server && go vet ./...
	@echo "==> 执行后端全量单元测试与竞态检测..."
	@$(MAKE) test-race
	@echo "==> 质量检测全部通过！"

run: build
	@echo "==> 启动 ArchCanvas..."
	@./$(BINARY_NAME)

clean:
	@echo "==> 清理构建产物并还原开发态静态占位页..."
	@rm -f $(BINARY_NAME) $(BINARY_NAME).exe
	@rm -rf web/dist server/tmp tmp server/internal/static/dist/assets
	@cp server/internal/static/dev_placeholder.html server/internal/static/dist/index.html
