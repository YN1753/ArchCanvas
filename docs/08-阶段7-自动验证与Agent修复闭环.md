# Stage 7：自动验证与 Agent 修复

## 目标

生成项目后自动验证，并让 Agent 在有限次数内修复。

## 1. Loop

```text
Generate
 ↓
go mod tidy
 ↓
go test ./...
 ↓
go vet ./...
 ↓
go build ./...
 ↓
Error?
 ├─ No → Success
 └─ Yes
      ↓
   Analyze
      ↓
   Repair
      ↓
   Retry
```

## 2. Tool

第一版：

```text
go_mod_tidy
go_test
go_vet
go_build
```

每个 Tool 都应该返回结构化结果：

```json
{
  "success": false,
  "command": "go build ./...",
  "exitCode": 1,
  "stdout": "",
  "stderr": "...",
  "durationMs": 420
}
```

## 3. Command Runner

必须限制：

- 工作目录
- 超时时间
- 最大输出
- 可执行命令
- 环境变量
- 文件范围

公网环境不要给 Agent 无限 Shell 权限。

## 4. Repair Agent

拿到：

```text
Architecture DSL
ER DSL
Generated Files
Build Error
```

判断错误属于：

- DSL
- Generator
- 文件实现
- 用户需求缺失

然后选择：

- 修改 DSL
- 修改 Generator
- 修改文件
- 请求用户确认

## 5. Retry

设置：

```text
max_attempts = 3
```

绝不能无限循环。

## 6. Human-in-the-loop

涉及：

- 删除文件
- 修改大量代码
- 数据库 migration
- 安装依赖
- 高风险 shell

需要用户确认。

Eino 当前提供 Interrupt/Resume 和 Human-in-the-Loop 相关能力，可用于实现审批与恢复。citeturn0search8turn0search1

## 7. 指标

重点记录：

- First Build Success Rate
- First Test Success Rate
- Auto Repair Success Rate
- Average Retry Count
- Token
- Latency
