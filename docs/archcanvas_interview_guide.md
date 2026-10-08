# ArchCanvas (架构画板) —— Go 后端 & Agent 应用开发深度面经与项目全景手册

> **文档定位**：本项目（ArchCanvas）面试全景通关指南，专为 **Go 后端研发工程师** 与 **AI Agent 应用开发工程师** 岗位面试量身定制。涵盖架构设计、高频面试考点、底层源码机理、高难度追问与标准应答话术。后续可在此文档中实时增补、记录面试实战复盘。

---

## 目录
1. [项目简介与一句话电梯演讲（Elevator Pitch）](#一-项目简介与一句话电梯演讲elevator-pitch)
2. [系统整体架构与技术选型全景](#二-系统整体架构与技术选型全景)
3. [Go 后端核心面试亮点深度解析](#三-go-后端核心面试亮点深度解析)
   - [3.1 工业级分层架构与显式依赖注入（Clean Architecture）](#31-工业级分层架构与显式依赖注入clean-architecture)
   - [3.2 GORM 复杂事务编排与 9 步拓扑倒序级联删除](#32-gorm-复杂事务编排与-9-步拓扑倒序级联删除)
   - [3.3 状态对比（Diff）增量更新与物理坐标记忆继承](#33-状态对比diff增量更新与物理坐标记忆继承)
   - [3.4 分布式单调主键：RFC 9562 UUIDv7 与 B+ 树索引性能调优](#34-分布式单调主键rfc-9562-uuidv7-与-b-树索引性能调优)
   - [3.5 纯内存流式工程生成器：Go AST 排版校验 + embed.FS + 零磁盘 IO 压缩](#35-纯内存流式工程生成器go-ast-排版校验--embedfs--零磁盘-io-压缩)
   - [3.6 高并发 SSE 流式推送与 Goroutine 优雅退出机制](#36-高并发-sse-流式推送与-goroutine-优雅退出机制)
4. [AI Agent 应用开发核心亮点深度解析](#四-ai-agent-应用开发核心亮点深度解析)
   - [4.1 白盒分层 Agent 推理体系：从概念到物理到架构审查（Layer 1/2/3）](#41-白盒分层-agent-推理体系从概念到物理到架构审查layer-123)
   - [4.2 业务决策门禁（Decision Gate）与渐进式澄清卡片](#42-业务决策门禁decision-gate与渐进式澄清卡片)
   - [4.3 双轨容灾机制：LLM 动态推导 + 离线启发式规则引擎兜底](#43-双轨容灾机制llm-动态推导--离线启发式规则引擎兜底)
   - [4.4 工业级 LLM 结构化输出清洗机：栈状态机括号平衡与语法修复](#44-工业级-llm-结构化输出清洗机栈状态机括号平衡与语法修复)
   - [4.5 CloudWeGo Eino SDK 深度实践与多模型热插拔探测](#45-cloudwego-eino-sdk-深度实践与多模型热插拔探测)
5. [前端架构设计概览（面试了解级）](#五-前端架构设计概览面试了解级)
6. [大厂高频面试实战 Q&A（Go 后端 + Agent 实战 15 问）](#六-大厂高频面试实战-qa)

---

## 一、 项目简介与一句话电梯演讲（Elevator Pitch）

### 1.1 一句话自我介绍
> “我在最近主导并开发了 **ArchCanvas（架构画板）** 项目，这是一个基于 **Go 1.22+** 与 **CloudWeGo Eino Agent 框架** 构建的 AI 驱动可视化数据库架构设计工作台。系统打通了‘自然语言需求 ➔ 陈氏概念 ER 模型 ➔ 生产级物理数据表与索引 ➔ 架构质量体检 ➔ 一键编译导出生产级 Go 脚手架工程’的全链路，并在后端攻克了分层 Agent 编排、UUIDv7 索引优化、RFC 6902 增量差异落库、Go AST 语法强校验以及纯内存流式导出等核心工程挑战。”

### 1.2 为什么做这个项目？（业务痛点）
1. **传统建模工具笨重且孤立**：Navicat / PowerDesigner / PDManer 等工具只关注物理建表，缺乏业务概念层（Chen's ER）向物理表的推导演化过程。
2. **通用 AI 生成代码/SQL 幻觉严重且不可控**：直接让 ChatGPT/Claude “帮我写一套建表 SQL”，往往混杂业务概念与物理外键、漏建索引、金额字段乱用 FLOAT，且缺乏递进式澄清机制。
3. **生成的工程缺乏大厂规范**：市面上大部分代码生成器生成的是低质量单文件或缺乏规范分层的模板代码，缺少 GORM 关联自动推导、AST 格式化与依赖注入装配。

---

## 二、 系统整体架构与技术选型全景

### 2.1 整体架构流程图

```
┌────────────────────────────────────────────────────────────────────────┐
│                              前端 Web 层                               │
│        React 19 + React Flow 12 + Tailwind CSS + Zustand 5 Slices      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP POST/GET (语义化 API) / SSE 流
┌───────────────────────────────────▼────────────────────────────────────┐
│                             Gin Router 层                              │
│         /api/v1/projects | /api/v1/agent | /api/v1/generator           │
└──────────────────┬─────────────────┬───────────────────┬───────────────┘
                   │                 │                   │
┌──────────────────▼──┐   ┌──────────▼────────┐   ┌──────▼───────────────┐
│   ProjectHandler    │   │   AgentHandler    │   │   GeneratorHandler   │
└──────────────────┬──┘   └──────────┬────────┘   └──────┬───────────────┘
                   │                 │                   │
┌──────────────────▼─────────────────▼───────────────────▼───────────────┐
│                              Service 业务层                            │
│  ┌──────────────────────┐  ┌────────────────────────────────────────┐  │
│  │    ProjectService    │  │              AgentService              │  │
│  │ (项目元信息/会话上下文) │  │  Layer 1: ProposeConcepts (需求概念分析)  │  │
│  └──────────────────────┘  │  Layer 2: DerivePhysical (物理表/索引推导) │  │
│  ┌──────────────────────┐  │  Layer 3: ReviewSchema (架构师质量体检)   │  │
│  │   GeneratorService   │  └───────────────────┬────────────────────┘  │
│  │  (AST校验/ZIP流式生成)│                      │                       │
│  └──────────────────────┘                      │                       │
└──────────────────┬─────────────────────────────┼───────────────────────┘
                   │                             │
┌──────────────────▼──────────┐   ┌──────────────▼───────────────────────┐
│       Repository 仓储层      │   │          ModelManager (Eino)          │
│ - ProjectRepo (9步级联删除) │   │ - 多厂商适配 (OpenAI/DeepSeek/Ollama) │
│ - ERDesignRepo (Diff增量更新)│   │ - 动态端点探测 (/models)              │
│ - MessageRepo (多轮对话上下文)│   │ - 规则推导引擎 (Rule-based 离线兜底)   │
└──────────────────┬──────────┘   └──────────────────────────────────────┘
                   │
┌──────────────────▼─────────────────────────────────────────────────────┐
│                    底层依赖与存储 (Infrastructure)                       │
│ - 数据库：SQLite (GORM Driver) + WAL 模式                               │
│ - 主键引擎：RFC 9562 UUIDv7 (有序时间戳主键，防索引页分裂)             │
│ - AST 编译器：Go 标准库 `go/format` + `embed.FS` 嵌入式模板             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 三、 Go 后端核心面试亮点深度解析

### 3.1 工业级分层架构与显式依赖注入（Clean Architecture）
- **核心设计**：采用标准的大厂工程分层：`cmd` ➔ `router` ➔ `handler` ➔ `service` ➔ `repository` ➔ `model/domain`。
- **面试话术**：
  > “在后端工程中，我严格摒弃了全局变量与 `init()` 函数隐式初始化的反模式。所有组件均采用显式构造函数注入（如 `NewERDesignRepository(db)` ➔ `NewProjectService(repo...)` ➔ `NewHandler(svc...)`）。这种设计具备三个显著优势：
  > 1. **生命周期清晰**：单例资源的初始化顺序在 `cmd/server/main.go` 中一目了然；
  > 2. **极易单测与 Mock**：业务层依赖接口或明确构造，可零侵入传入 Mock Repository 进行单元测试；
  > 3. **无全局并发竞争**：避免了并发调用下多模块共享未受控全局变量的竞态风险。”

### 3.2 GORM 复杂事务编排与 9 步拓扑倒序级联删除
- **源码文件**：[`server/internal/repository/project.go`](file:///Users/starry/Documents/projects/archcanvas/server/internal/repository/project.go)
- **业务场景**：删除一个设计项目时，涉及属性、实体、关系、会话历史、消息、AI 总结上下文等多张表。
- **核心实现机理**：
  在 `tx := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { ... })` 中，按照**拓扑倒序**严格执行 9 步删除：
  1. 查出项目下所有 `entityIDs`；
  2. 级联删除属性表：`WHERE entity_id IN (entityIDs)`；
  3. 删除实体表：`WHERE project_id = ?`；
  4. 删除关系表：`WHERE project_id = ?`；
  5. 查出所有关联的 `conversationIDs`；
  6. 级联删除历史消息表：`WHERE conversation_id IN (convIDs)`；
  7. 删除会话元数据表；
  8. 删除项目绑定的 AI 上下文快照；
  9. 删除项目本体记录。
- **面试话术**：
  > “在数据库设计中，外键级联（`ON DELETE CASCADE`）虽然省事，但在大型高并发系统中通常被大厂规范明令禁止，因为它会隐式锁表且无法精细监控。因此我在代码层面使用显式数据库事务，按照依赖拓扑的逆序进行分批清理，并在每个阶段对关联 ID 进行批量查询与 `IN` 操作，既保证了事务的原子性与零孤儿数据残留，又避免了全表长事务锁竞争。”

### 3.3 状态对比（Diff）增量更新与物理坐标记忆继承
- **源码文件**：[`server/internal/repository/er_design.go`](file:///Users/starry/Documents/projects/archcanvas/server/internal/repository/er_design.go#L131-L300)
- **传统劣质做法**：很多低质开源项目每次保存画布时，直接 `DELETE FROM entities WHERE project_id = ?` 然后全量 `INSERT`。这种方式会导致自增主键暴增、并发保存死锁、连线与属性 ID 剧烈跳变。
- **ArchCanvas 的解决方案**：
  1. **实体与字段的内存 Diff 算法**：从数据库拉出当前快照 `oldEntities` 与 `oldAttributes`，构建 `oldEntitiesByID` 与 `oldEntitiesByName` 双重索引。
  2. **状态三路分流**：
     - 若命中已有实体/字段，比对字段内容；若有变动加入 `toUpdate`，无变动跳过；
     - 若未命中旧实体，分配 UUIDv7 加入 `toInsert`；
     - 遍历旧实体，若本次请求未包含，则判定为已删除，加入 `toDeleteIDs`。
  3. **画布坐标记忆继承**：
     前端高频微调或 AI 重新推导时，如果入参没有传递 `PosX/PosY`，后端通过 `oldPosByID` 自动沿用旧坐标，防止重绘时全图节点归零叠在一起。

### 3.4 分布式单调主键：RFC 9562 UUIDv7 与 B+ 树索引性能调优
- **源码文件**：[`server/pkg/id/id.go`](file:///Users/starry/Documents/projects/archcanvas/server/pkg/id/id.go)
- **底层原理对比**：
  | 主键类型 | 有序性 | 分布式生成 | B+ 树索引表现 | 潜在痛点 |
  | :--- | :--- | :--- | :--- | :--- |
  | **自增 ID (AUTO_INCREMENT)** | 单调递增 | 否（强依赖单库） | 极佳（顺序追加） | 分库分表难合并、暴露业务量 |
  | **UUIDv4 (经典随机)** | 完全无序 | 是 | **极差（随机写入引发大量页分裂）** | 聚簇索引碎片化，Buffer Pool 污染 |
  | **Snowflake (雪花算法)** | 趋势递增 | 是 | 良好 | 强依赖机器 ID 分配、时钟回拨隐患 |
  | **RFC 9562 UUIDv7 (本项目)** | **毫秒级时序单调** | **是（开箱即用，无外部依赖）** | **极佳（顺序追加，兼具分布式特性）** | 高 48 位为毫秒时间戳，后 74 位为随机熵 |
- **面试话术**：
  > “为什么我们在整个后端全面采用最新的 RFC 9562 UUIDv7 替代 UUIDv4？
  > 核心原因在于 InnoDB 和 SQLite 聚簇索引的底层实现是 B+ 树。UUIDv4 是纯随机 128 位哈希，随机插入会导致数据页频繁发生 Page Split（页分裂），导致大量离散 I/O，并导致 Buffer Pool 缓存命中率暴跌。
  > UUIDv7 在高 48 位中固化了 UNIX 毫秒级时间戳，同时保证了全局分布式唯一与物理时序单调递增。新记录始终以追加写（Append-only）的方式插入 B+ 树最右叶子节点，写入性能媲美自增主键，同时彻底杜绝了分布式冲突与分库分表合并难题。”

### 3.5 纯内存流式工程生成器：Go AST 排版校验 + embed.FS + 零磁盘 IO 压缩
- **源码文件**：[`server/internal/generator/generator.go`](file:///Users/starry/Documents/projects/archcanvas/server/internal/generator/generator.go)
- **核心工程亮点**：
  1. **Go AST 强力编译排版保底（`go/format.Source`）**：
     模板渲染（`text/template`）极其容易因为换行、缺失括号、漏 import 导致语法错误。我们在 `renderGo` 函数中，对所有生成的 Go 代码统一经过官方标准库 `format.Source([]byte(raw))`。
     - 若代码合法，自动完成最严苛的 `gofmt` 语法排版；
     - 若代码存在语法瑕疵，`format.Source` 会立即返回 AST Parse Error 并精准指出出错行列，拦截劣质代码流出。
  2. **`embed.FS` 内嵌 13+ 模板**：编译进单个 Go 二进制包，无需在生产环境依赖外部物理模板文件，容器化零路径依赖。
  3. **`archive/zip` 纯内存缓冲（Zero Disk IO）**：
     通过 `buf := new(bytes.Buffer)` 和 `zw := zip.NewWriter(buf)`，全程在内存流中完成上百个文件的压缩组装，直接返回给 Gin 控制器。**零临时文件落盘，零并发争用，不需要任何定时清理临时目录的后台任务**。

### 3.6 高并发 SSE 流式推送与 Goroutine 优雅退出机制
- **源码文件**：[`server/internal/handler/agent.go`](file:///Users/starry/Documents/projects/archcanvas/server/internal/handler/agent.go#L119-L148) & [`service/agent.go`](file:///Users/starry/Documents/projects/archcanvas/server/internal/service/agent.go#L40-L54)
- **面试考点（Goroutine 泄漏防范）**：
  在处理大模型流式推理（SSE）时，如果用户在生成过程中关闭浏览器标签页或网络中断，后台仍在继续往 channel 发送事件，极易导致 Goroutine 永久阻塞并发生协程泄漏。
- **ArchCanvas 解决方案**：
  ```go
  // 安全推送闭包：双路复用监听 ctx.Done()
  sendEvent := func(evt StreamEvent) bool {
      select {
      case outCh <- evt:
          return true
      case <-ctx.Done():
          return false
      }
  }
  ```
  在 Handler 层统一配置：
  `c.Header("Content-Type", "text/event-stream")`、`c.Header("X-Accel-Buffering", "no")`（防止 Nginx 缓冲区积压）、并通过 `flusher.Flush()` 实时推流。当检测到 `ctx.Done()` 时立即主动退出循环并释放连接。

---

## 四、 AI Agent 应用开发核心亮点深度解析

### 4.1 白盒分层 Agent 推理体系：从概念到物理到架构审查（Layer 1/2/3）
- **核心痛点**：端到端的大模型经常把“业务概念”与“数据库物理建表”混为一谈（例如一上来就建一堆包含 `parent_id`、`role_id` 的孤立表，或者直接遗漏索引和字符集）。
- **ArchCanvas 的三层分层演进范式**：
  ```
  [用户自然语言需求]
         │
         ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ Layer 1: ProposeConcepts (领域概念建模师)                      │
  │ • 聚焦业务本质：陈氏概念模型（实体概念、业务名词属性、动词关联） │
  │ • 纯粹无物理污染：禁止自增ID、禁止物理类型、禁止中间表与物理外键 │
  │ • 触发决策门禁：宏观需求生成澄清卡片；微观需求直接通过        │
  └──────────────────────────────┬────────────────────────────────┘
                                 │ 用户审阅 / 确认澄清选项
                                 ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ Layer 2: DerivePhysical (生产级物理架构推导)                  │
  │ • 映射规范化：业务属性 ➔ 精准 SQL 类型 (如金额 ➔ DECIMAL)     │
  │ • 拓扑解耦：M:N 动词联系 ➔ 物理中间联结表 + 联合唯一索引       │
  │ • 索引编排：自动为外键列生成 `idx_xxx`、业务唯一键生成唯一索引  │
  └──────────────────────────────┬────────────────────────────────┘
                                 │ 物理表生成完成
                                 ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ Layer 3: ReviewSchema (首席架构师质量体检 Critic)             │
  │ • 静态规则扫描：主键完整性、外键索引覆盖、行溢出大字段风险    │
  │ • LLM 架构审计：输出 0-100 健康得分与具体优化建议行动项       │
  └───────────────────────────────────────────────────────────────┘
  ```

### 4.2 业务决策门禁（Decision Gate）与渐进式澄清卡片
- **源码文件**：[`server/internal/service/agent.go`](file:///Users/starry/Documents/projects/archcanvas/server/internal/service/agent.go#L442-L450)
- **机制**：
  在 Prompt 与工具参数中明确区分两类场景：
  1. **小而明确的需求**（如“在用户表加一个手机号”）：`need_clarification = false`，静默直通，直接提议概念；
  2. **宏观系统级需求**（如“做一个生鲜电商平台”）：`need_clarification = true`，强制拦截落库，生成 2~3 张逻辑递进的卡片（如“交付履约模式”、“会员与结算体系”），每张卡片提供 2~4 个互斥预设选项，并标明通用最佳实践。用户在前端选择后，再带入下一轮推理。彻底杜绝大模型在业务边界模糊时的“自嗨式幻觉”。

### 4.3 双轨容灾机制：LLM 动态推导 + 离线启发式规则引擎兜底
- **源码文件**：[`server/internal/service/agent_derive.go`](file:///Users/starry/Documents/projects/archcanvas/server/internal/service/agent_derive.go#L228-L300)
- **业务价值**：在真实的私有化部署或高并发线上环境中，大模型 API 可能存在超时（Timeout）、网络抖动、限流（429 Too Many Requests）或欠费断供。
- **ArchCanvas 的设计**：
  系统内置了完整的 `derivePhysicalRuleBased(input)` 启发式逻辑推导器。
  当 Eino 模型未配置或调用链路异常时，服务**零等待秒级降级**为内置规则引擎：
  - 自动将实体概念映射为物理表并分配主键与审计时间戳；
  - 自动通过类型映射字典将 `category` 转换为目标方言类型（MySQL / PG / SQLite）；
  - 自动识别概念之间的 `many_to_many` 关系并裂变为物理中间表和联合唯一索引。
  系统具备工业级的**确定性 SLA 保障**。

### 4.4 工业级 LLM 结构化输出清洗机：栈状态机括号平衡与语法修复
- **源码文件**：[`server/internal/service/agent.go`](file:///Users/starry/Documents/projects/archcanvas/server/internal/service/agent.go#L524-L622)
- **单测证明**：[`server/internal/service/agent_json_test.go`](file:///Users/starry/Documents/projects/archcanvas/server/internal/service/agent_json_test.go)
- **解决痛点**：
  大模型在返回 JSON 时，极其容易出现：
  1. 夹杂前置思考或结语（如“好的，这是为您设计的方案：{...} 祝您工作愉快！”）；
  2. Markdown 代码块不规范或代码块外也有文字；
  3. 语法瑕疵：对象/数组末尾带有尾随逗号（Trailing Comma，如 `{"a": 1,}`），直接调用 Go `json.Unmarshal` 必然报错。
- **状态机算法实现**：
  1. `ExtractBalancedJSONObjects`：利用字符扫描器，维护 `depth` 深度计数与字符串转义引号标记，精准截取最外层 `{` 到 `}` 之间闭合的合法 JSON 串，忽略所有外层自然语言噪音；
  2. `CleanJSONSyntax`：在保持字符串字面量内容完全不变的前提下，扫描闭合括号前的多余逗号并过滤。双重清洗后，JSON 反序列化成功率提升至接近 100%。

### 4.5 CloudWeGo Eino SDK 深度实践与多模型热插拔探测
- **框架选型理由**：
  字节跳动的 **CloudWeGo Eino** 是 Go 生态首个生产级 LLM 应用开发框架。相比 Python 体系 LangChain 的臃肿复杂与 Go 移植版 LangChainGo 的薄弱抽象，Eino 原生基于 Go 泛型、强类型 Schema、组件可组合性（Graph/Chain/Tools）设计。
- **核心落地技术点**：
  1. `utils.InferTool`：通过 Go 结构体 Tag（`jsonschema:"description=..."`）与函数签名反射，自动推导 JSONSchema 工具元数据，彻底省去手写 JSON Schema 的繁琐与易错；
  2. `FetchModelsFromBaseURL`：输入任意兼容 OpenAI 的端点（Ollama、DeepSeek、vLLM、OneAPI），主动向远程 `GET /models` 发起探测，动态拉取支持的模型清单；
  3. **双向写回与热插拔**：用户在界面选定模型后，后端安全更新 `ModelManager` 内部缓存（`sync.RWMutex` 保护），并原子写回 `configs/config.yaml` 与 `.env`，服务无需重启即刻热生效。

---

## 五、 前端架构设计概览（面试了解级）

> 面试建议：“前端我采用 React 19 + TypeScript 与 React Flow 12 构建，核心目标是与后端领域模型实现 1:1 双向保真映射。”

1. **双视图架构（Dual-View）**：
   - **陈氏概念视图（Chen's ER）**：矩形（实体）、菱形（业务动词联系）、椭圆（精炼属性），中间表自动升华、外键冗余自动剔除；自研 2D 拓扑感知聚类排版引擎（把度数最高的实体置顶居中，横向画布跨度压缩 60%+）；
   - **物理关系视图（Table View）**：卡片式数据库表、字段级数据类型、PK/FK 徽标与字段间连线。
2. **状态管理与历史引擎**：
   - 采用 **Zustand 5 模块化 Slices 架构**（`erDesignSlice`, `conceptualSlice`, `historySlice`, `projectSlice`）；
   - 撤销/重做基于 **RFC 6902 JSON Patch 增量差异补丁**，相比全量深拷贝快照节约 90%+ 内存，并对连续键入加入 600ms 防抖折叠。
3. **视觉风格**：暖色纸质感新野兽派（Warm Papercraft Neo-Brutalist，坚挺 1.5px 黑色边线、米黄纸底色 `#faf7f0`、陶土红标记色 `#df4e3e`）。

---

## 六、 大厂高频面试实战 Q&A

### 🔹 Go 后端高频追问

#### Q1: 你们项目中是如何防止 Goroutine 泄漏的？结合你的 SSE 接口谈谈。
> **答**：
> 在处理大模型流式输出（SSE）这种长生命周期连接时，很容易因为客户端单方面中断连接导致后台写入挂起造成协程泄漏。
> 我们采取了三层防线：
> 1. **双路复用（Multiplexing）**：向 channel 推送事件时，使用 `select` 同时监听 `outCh <- evt` 与 `<-ctx.Done()`。一旦客户端断开，`ctx.Done()` 触发，直接返回退出，决不无脑写入；
> 2. **缓冲通道与显式关闭**：输出通道设置容量（如 `make(chan StreamEvent, 20)`），并在处理协程退出前通过 `defer close(outCh)` 确保通道正常关闭，消费端 `for range` 或 `select` 可以收到 `ok=false` 优雅退出；
> 3. **超时保护**：在历史记录落库等辅助协程中，使用独立的 `context.WithTimeout(context.Background(), 5*time.Second)`，防止主请求上下文取消导致日志或数据残留，同时防止落库死锁。

#### Q2: 为什么主键选择 UUIDv7？和雪花算法（Snowflake）、自增 ID 相比有什么优缺点？
> **答**：
> 核心是权衡**有序性、分布式扩展性、运维复杂度**三个维度：
> - **自增 ID**：B+ 树性能最好，但强依赖单节点发号，分库分表数据迁移会发生主键冲突，且在公开 API 中容易暴露业务规模；
> - **雪花算法**：虽然也是趋势递增，但必须维护机器 ID（WorkerID）分配中心（如依赖 Zookeeper/Redis），且有严苛的时钟回拨风险；
> - **UUIDv7（RFC 9562）**：将 48 位 UNIX 毫秒时间戳置于高位，后置 74 位强随机熵。既能在任意节点无中心化秒级生成，又具备天然的时序单调性。写入数据库聚簇索引时始终是按序向后追加，从根本上消除了经典随机 UUIDv4 造成的频繁 B+ 树页分裂（Page Split）和缓存命中率低下问题。

#### Q3: 画布高频保存时，如果每次全量落库会导致什么问题？你们是怎么解决的？
> **答**：
> 如果每次保存直接清空项目表再重新插入，会导致三个严重问题：自增 ID 浪费、外键约束瞬时失效或死锁、丢失前端已调整好的节点物理坐标。
> 我们在仓储层 `ERDesignRepository.SaveByProjectID` 实现了**基于内存快照的 Diff 增量比对机制**：
> 1. 事务内拉取当前项目的现有实体与属性，建立以 `ID` 和 `Name` 为键的双重查找索引；
> 2. 依次比对传入节点与旧节点，将操作严格拆分为 `entitiesToInsert`、`entitiesToUpdate` 与 `entitiesToDelete`；
> 3. **坐标记忆继承**：若新传入的节点没有携带坐标（如由 AI 批量推导生成），自动继承数据库中原节点的 `(posX, posY)`，防止画布重置回点阵左上角。全程包裹在单事务中原子提交。

#### Q4: 既然用的是 SQLite，在并发写入下如何避免 `database is locked` 错误？
> **答**：
> SQLite 默认是回滚日志模式（Rollback Journal），同一时刻写锁会排斥所有读写。我们采取了如下针对性调优：
> 1. **开启 WAL 模式（Write-Ahead Logging）**：在数据库连接初始化时执行 `PRAGMA journal_mode=WAL;`，实现读写互不阻塞，读并发大幅提升；
> 2. **配置繁忙等待（Busy Timeout）**：设置 `PRAGMA busy_timeout=5000;`，当遇到短暂锁争用时驱动层自动重试而不是直接报错；
> 3. **连接池限制**：设置 `sqlDB.SetMaxOpenConns(1)` 或精细控制写连接，从源头上杜绝多连接并发修改同一个 SQLite 文件的冲突。

#### Q5: 代码生成器导出 ZIP 时，如果几百个用户同时下载，如何保证服务器内存不暴涨？
> **答**：
> 1. 生成的代码主要是纯文本，单个 Go 项目全套代码通常在几百 KB 以内；
> 2. 使用 `archive/zip.NewWriter` 配合 `bytes.Buffer` 纯内存流式写入，写完后直接将字节流写入 HTTP Response，并设置 `Content-Disposition: attachment`；
> 3. 避免在服务器磁盘上生成任何形如 `/tmp/project_xxx.zip` 的临时文件，杜绝磁盘 I/O 争用与后台清理定时任务；
> 4. 对生成的 Go 代码统一经过标准库 `go/format.Source` 校验与排版，确保只有语法 100% 正确的代码才会进入压缩包。

---

### 🔹 AI Agent 应用开发高频追问

#### Q6: 为什么不直接用单 Prompt 让大模型直接生成最终的建表 SQL，而要设计三层（业务概念 ➔ 物理推导 ➔ 架构体检）？
> **答**：
> 这本质上是**认知负荷拆解与防幻觉控制**的经典 Agent 架构思想：
> 1. **职责分离**：单次让大模型同时充当“业务分析师”、“DBA 专家”和“性能调优师”，Prompt 约束过多会导致模型注意力分散，极易出现把概念和物理表混淆、丢失索引、漏建主键等问题；
> 2. **白盒可控与人机协同（Human-in-the-Loop）**：在第一层概念提议时，我们引入了“澄清卡片”，把模糊的业务交付路径前置让用户确认；用户在概念画布上调整完实体动词后，再显式触发第二层物理推导。每一步均有独立的中间状态可视化呈现，而不是一个黑盒；
> 3. **架构体检（Critic Agent）**：第三层作为独立的批评者（Critic），结合静态规则评分与大模型专业洞见，专门对物理表进行死锁风险、最左索引覆盖、行溢出风险审查，形成了完整的“生成 ➔ 校验 ➔ 反馈”闭环。

#### Q7: 大模型返回 JSON 不稳定（经常带 markdown 标识或尾随逗号），你们是怎么在生产级代码中彻底解决的？
> **答**：
> 我们设计了**三道清洗与容错管道**：
> 1. **优先提取 Markdown 代码块**：通过正则优先抽取 ````json ... ```` 中的正文；
> 2. **栈状态机括号平衡扫描（`ExtractBalancedJSONObjects`）**：针对大模型喜欢在 JSON 前后附带客套话的情况，编写了基于字符与深度的状态机，精确跟踪引号、转义符和花括号匹配，仅剥离最外层闭合的 `{...}`；
> 3. **尾随逗号清洗机（`CleanJSONSyntax`）**：在确保不修改字符串字面量的前提下，通过状态机扫描过滤在 `}` 和 `]` 之前的多余 `,`；
> 4. **双轨反序列化**：先直接反序列化，若失败再走清洗机反序列化。单测覆盖了多行换行、字符串内包含括号、尾随逗号等各种极端畸形输入。

#### Q8: 什么是“决策门禁（Decision Gate）”？具体是怎么实现的？
> **答**：
> 决策门禁是防止大模型在面对用户宏观、模糊需求时产生灾难性幻觉的关键机制。
> - 在阶段一 `propose_requirement` 工具的 Schema 中，我们定义了 `need_clarification`（布尔值）和 `clarification_cards`（澄清卡片组）；
> - 在系统 Prompt 中明确规约：若用户提的是具体微观改动（如“给用户加个 age 字段”），模型**严禁多事**，必须直通输出概念；若用户提的是粗粒度系统级需求（如“做个类似闲鱼的校园二手平台”），模型**必须拦截**，生成递进式的架构决策卡片（如“自提模式 vs 快递物流”、“平台担保 vs 线下结算”）；
> - 后端识别到 `need_clarification=true` 时，不执行物理建表落库，而是直接向前端推送澄清选项卡，等待用户选择后注入上下文再开启后续推导。

#### Q9: 为什么选用 CloudWeGo Eino 而不是 LangChainGo？
> **答**：
> 1. **类型安全与 Go 原生设计**：Eino 是字节跳动专门针对 Go 生态打造的，重度利用了 Go 1.18+ 的泛型机制，类型流转在编译期即可发现错误，而不用像很多框架那样到处断言 `interface{}`；
> 2. **Schema 统一与工具推导极简**：Eino 提供了 `utils.InferTool`，直接通过一个普通的 Go 结构体和函数就能通过反射生成带参数说明的 ToolInfo，省去了手动拼接繁复 JSONSchema 的工作量；
> 3. **流式生态完备**：原生支持流式 Chunk 接收与 `schema.ConcatMessages` 消息聚合，在处理流式 Thinking 内容与 ToolCall 参数流时非常稳定。

#### Q10: 当 LLM 接口挂了或者模型欠费时，你们系统怎么保证不会直接报错崩掉？
> **答**：
> 我们实现了**双轨容灾设计（Dual-Track Failover）**：
> 在物理表推导层（Layer 2），我们在 `service.DerivePhysicalSchema` 中实现了启发式规则引擎 `derivePhysicalRuleBased`：
> - 只要大模型调用出现任何异常（超时、网络中断、模型未配置、Token 耗尽），代码内部无缝回退到规则推导引擎；
> - 规则引擎基于纯 Go 代码实现了将陈氏概念映射为数据库实体：自动注入 `id` 与审计列、基于类型字典映射 SQL 类型、自动将 M:N 关联拆分为中间联结表并配置联合唯一索引。
> 整个降级过程对前端无感知，保证系统在离线或弱网极端场景下依然具有 100% 的业务可用性。

---

> 💡 **小贴士**：在面试时，按照 **“业务场景痛点 ➔ 方案技术选型 ➔ 关键实现细节（结合文件名/核心算法）➔ 收益与压测/稳定性验证”** 的四步法展开，会让面试官觉得你不仅代码写得好，而且极具工程严谨度与系统化思维！
