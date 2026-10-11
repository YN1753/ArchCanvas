.PHONY: all build build-web build-server test clean run

BINARY_NAME=archcanvas
VERSION?=$(shell git describe --tags --always --dirty 2>/dev/null || echo "v1.0.0")
COMMIT?=$(shell git rev-parse --short HEAD 2>/dev/null || echo "dev")
BUILD_TIME?=$(shell date -u '+%Y-%m-%dT%H:%M:%SZ')
LDFLAGS=-ldflags "-s -w -X main.Version=$(VERSION) -X main.GitCommit=$(COMMIT) -X main.BuildTime=$(BUILD_TIME)"

all: build

build-web:
	@echo "==> 构建前端静态资源 (web)..."
	@cd web && npm run build
	@echo "==> 复制静态资源至 Go embed 目录..."
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

run: build
	@echo "==> 启动 ArchCanvas..."
	@./$(BINARY_NAME)

clean:
	@echo "==> 清理构建产物..."
	@rm -f $(BINARY_NAME) $(BINARY_NAME).exe
	@rm -rf web/dist server/tmp tmp
