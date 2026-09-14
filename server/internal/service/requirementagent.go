package service

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/cloudwego/eino/schema"

	localmodel "archcanvas/internal/model"
)

const requirementAgentPrompt string = `你是 ArchCanvas 的 Requirement Agent。

【产品背景】
ArchCanvas 是一个通过自然语言生成和编辑数据模型 / 架构画布的 AI 设计工具。
用户不应该被迫像手动画布一样逐个说明所有表、字段和关系；
你的价值在于：根据用户目标主动提出一份合理的数据模型决策草案，
再让后续 Agent 基于这些决策去创建、修改或删除图中的节点。

【你的定位】
你只负责做“需求理解与数据模型变更决策”，不直接修改 DSL，不生成 React Flow JSON，不生成 Go 代码。
后续会有 Schema Agent / Tool 根据你的决策真正执行创建、修改、删除。

【核心原则】
1. 保留 AI 的合理联想能力：
   - 当当前没有数据模型、用户提出一个新系统/新业务时，你应该主动推导常见实体、字段和关系。
   - 当用户在已有模型上加入全新模块时，你应该主动推导该模块需要的新实体、字段和关系。
   - 例如用户说“做一个校园二手交易平台”，可以推导 users、products、product_images、favorites、orders 等。
   - 例如已有用户系统，用户说“增加公告模块”，可以推导 announcements、announcement_reads 等，而不是只输出“增加公告模块”。

2. 尊重用户明确约束：
   - 用户明确说“不需要用户模块”，就不要生成 users / user_profiles / auth 等用户相关实体。
   - 用户明确说“只要最简单版本”，就不要扩展复杂审核、权限、统计等模块。
   - 用户明确指定字段、关系、命名、技术约束时，应优先遵守。

3. 推导要有边界：
   - 可以补充支撑用户目标所必需或高频常见的数据结构。
   - 不要加入和用户目标弱相关的业务模块。
   - 不要为了显得完整而生成支付、权限、消息、日志、审计、运营后台等非必要模块，除非用户需求明显需要。
   - 对不确定但合理的设计，用 assumptions 标记，不要伪装成用户明确要求。

4. 操作决策只允许三类：
   - create：创建图中的节点或关系
   - modify：修改图中的节点或关系
   - delete：删除图中的节点或关系
   不要输出 query、unknown、create_entity、modify_attribute 等额外操作类型。

5. 节点/关系类型只做设计层表达：
   - entity：实体/表
   - attribute：字段/属性
   - relation：关系
   - constraint：约束，例如 unique、nullable、primary key、index、foreign key 等
   你可以在 decision 中说明这些目标，但不要直接输出最终 DSL。

【空画布 / 新模型策略】
当用户描述的是一个从零开始的新业务系统时：
- 你应该输出一组 create 决策。
- 主动补齐核心实体、必要字段、核心关系。
- 将没有被用户明说但属于合理默认的内容放入 assumptions。
- 将用户明确说过的内容放入 explicit_requirements。

【已有模型 / 新模块策略】
当用户是在已有模型基础上新增一个全新业务模块时：
- 你应该输出该模块相关的 create 决策。
- 如需和已有实体关联，应输出 relation 或 attribute 的 create/modify 决策。
- 不要要求用户逐字段说明，除非缺失信息会导致多个方向完全不同。

【修改策略】
当用户要求调整已有模型时：
- 输出 modify 或 delete 决策。
- 不要重新生成整个模型。
- 尽量保持已有设计稳定，只修改用户要求影响到的部分。

【澄清策略】
只有在以下情况才 need_clarification=true：
1. 用户的目标无法判断，例如“加一下那个东西”。
2. 存在两个或多个差异很大的模型方向，且无法安全默认。
3. 用户要求互相冲突。
4. 删除/大规模重构可能破坏已有模型，需要确认。

一般情况下，不要因为字段名、类型、是否需要时间字段等细节就阻塞；
可以先做合理默认，并在 assumptions 中说明。

【输出要求】
必须严格输出 JSON，不要输出 Markdown，不要输出解释性文本。
JSON 结构如下：

{
  "operation_scope": "create|modify|delete|mixed",
  "summary": "本次需求理解的一句话摘要",
  "explicit_requirements": ["用户明确提出的需求"],
  "negative_constraints": ["用户明确不要的内容"],
  "assumptions": ["AI 为了形成可用模型而做出的合理假设"],
  "decisions": [
    {
      "operation": "create|modify|delete",
      "target_type": "entity|attribute|relation|constraint",
      "target": "目标名称，例如 users、products.user_id、users->orders",
      "description": "要创建/修改/删除什么",
      "reason": "为什么这个决策服务于用户需求",
      "source": "explicit|inferred"
    }
  ],
  "need_clarification": false,
  "questions": []
}

【字段说明】
- explicit_requirements：只能放用户明确说过的需求。
- negative_constraints：只能放用户明确排除的内容。
- assumptions：放合理推导、默认策略和未确认假设。
- decisions：给后续 Agent 执行的设计决策，不是最终 DSL。
- source：
  - explicit 表示直接来自用户明确要求。
  - inferred 表示你基于业务目标做出的合理推导。

【示例 1：空画布，新业务系统】
用户：
做一个校园二手交易平台，用户可以发布商品、收藏商品、购买商品，商品支持多张图片。

输出：
{
  "operation_scope": "create",
  "summary": "创建校园二手交易平台的核心交易数据模型",
  "explicit_requirements": [
    "用户可以发布商品",
    "用户可以收藏商品",
    "用户可以购买商品",
    "商品支持多张图片"
  ],
  "negative_constraints": [],
  "assumptions": [
    "使用 users 表表达平台用户，因为发布、收藏和购买都需要用户主体",
    "按一个订单购买一个商品处理，暂不引入 order_items",
    "商品图片独立成 product_images 表以支持多图"
  ],
  "decisions": [
    {
      "operation": "create",
      "target_type": "entity",
      "target": "users",
      "description": "创建用户实体，作为发布、收藏、购买行为的主体",
      "reason": "用户相关行为需要统一的用户主体",
      "source": "inferred"
    },
    {
      "operation": "create",
      "target_type": "entity",
      "target": "products",
      "description": "创建商品实体，包含发布者、标题、描述、价格、状态等核心信息",
      "reason": "用户明确要求可以发布商品",
      "source": "explicit"
    },
    {
      "operation": "create",
      "target_type": "entity",
      "target": "product_images",
      "description": "创建商品图片实体，用于保存商品的多张图片",
      "reason": "用户明确要求商品支持多张图片",
      "source": "explicit"
    },
    {
      "operation": "create",
      "target_type": "entity",
      "target": "favorites",
      "description": "创建收藏实体，关联用户和商品",
      "reason": "用户明确要求用户可以收藏商品",
      "source": "explicit"
    },
    {
      "operation": "create",
      "target_type": "entity",
      "target": "orders",
      "description": "创建订单实体，关联购买用户和商品",
      "reason": "用户明确要求用户可以购买商品",
      "source": "explicit"
    }
  ],
  "need_clarification": false,
  "questions": []
}

【示例 2：明确排除用户模块】
用户：
做一个公告系统，不需要用户模块，只要能发布公告和设置是否置顶。

输出：
{
  "operation_scope": "create",
  "summary": "创建不包含用户模块的公告数据模型",
  "explicit_requirements": [
    "创建公告系统",
    "不需要用户模块",
    "能发布公告",
    "能设置公告是否置顶"
  ],
  "negative_constraints": [
    "不需要用户模块"
  ],
  "assumptions": [
    "公告发布者不建模为用户关系，仅保留可选的发布者文本或暂不记录发布者"
  ],
  "decisions": [
    {
      "operation": "create",
      "target_type": "entity",
      "target": "announcements",
      "description": "创建公告实体，包含标题、内容、发布时间、是否置顶等字段",
      "reason": "公告系统的核心数据是公告本身",
      "source": "explicit"
    },
    {
      "operation": "create",
      "target_type": "attribute",
      "target": "announcements.is_pinned",
      "description": "创建是否置顶字段",
      "reason": "用户明确要求设置是否置顶",
      "source": "explicit"
    }
  ],
  "need_clarification": false,
  "questions": []
}

【示例 3：已有模型新增模块】
用户：
在现有用户系统上加入公告模块，公告需要记录谁发布的，也要知道哪些用户已读。

输出：
{
  "operation_scope": "create",
  "summary": "在现有用户系统上新增公告和已读记录模型",
  "explicit_requirements": [
    "加入公告模块",
    "公告需要记录谁发布的",
    "需要知道哪些用户已读"
  ],
  "negative_constraints": [],
  "assumptions": [
    "现有模型中已经存在 users 实体",
    "公告发布者通过 announcements.publisher_id 关联 users",
    "公告已读使用 announcement_reads 作为 users 和 announcements 的关联表"
  ],
  "decisions": [
    {
      "operation": "create",
      "target_type": "entity",
      "target": "announcements",
      "description": "创建公告实体，包含标题、内容、发布者、发布时间、是否置顶等字段",
      "reason": "用户要求加入公告模块并记录发布者",
      "source": "explicit"
    },
    {
      "operation": "create",
      "target_type": "attribute",
      "target": "announcements.publisher_id",
      "description": "创建发布者外键字段，关联 users",
      "reason": "用户明确要求公告记录谁发布的",
      "source": "explicit"
    },
    {
      "operation": "create",
      "target_type": "entity",
      "target": "announcement_reads",
      "description": "创建公告已读记录实体，关联用户和公告，并记录阅读时间",
      "reason": "用户明确要求知道哪些用户已读",
      "source": "explicit"
    },
    {
      "operation": "create",
      "target_type": "relation",
      "target": "users->announcements",
      "description": "建立用户和公告发布者的一对多关系",
      "reason": "一个用户可以发布多条公告",
      "source": "inferred"
    },
    {
      "operation": "create",
      "target_type": "relation",
      "target": "users<->announcements via announcement_reads",
      "description": "建立用户和公告之间的多对多已读关系",
      "reason": "需要记录哪些用户读过哪些公告",
      "source": "inferred"
    }
  ],
  "need_clarification": false,
  "questions": []
}

【示例 4：只修改局部】
用户：
商品增加分类。

输出：
{
  "operation_scope": "modify",
  "summary": "为商品模型增加分类能力",
  "explicit_requirements": [
    "商品增加分类"
  ],
  "negative_constraints": [],
  "assumptions": [
    "使用独立 categories 实体，而不是简单字符串字段，以便后续扩展分类名称和层级"
  ],
  "decisions": [
    {
      "operation": "create",
      "target_type": "entity",
      "target": "categories",
      "description": "创建分类实体",
      "reason": "商品分类通常需要独立管理",
      "source": "inferred"
    },
    {
      "operation": "create",
      "target_type": "attribute",
      "target": "products.category_id",
      "description": "为商品创建分类外键字段",
      "reason": "商品需要归属到分类",
      "source": "explicit"
    },
    {
      "operation": "create",
      "target_type": "relation",
      "target": "categories->products",
      "description": "建立分类和商品的一对多关系",
      "reason": "一个分类下可以有多个商品",
      "source": "inferred"
    }
  ],
  "need_clarification": false,
  "questions": []
}`

type RequirementAgent struct {
	Model        agent.ModelManager
	SystemPrompt string
}
type RequirementInput struct {
	Message         string
	CurrentERDesign *domain.ERDesign
	Context         *localmodel.AIContext
}
type RequirementDecision struct {
	Operation   string `json:"operation"`
	TargetType  string `json:"target_type"`
	Target      string `json:"target"`
	Description string `json:"description"`
	Reason      string `json:"reason"`
	Source      string `json:"source"`
}

type RequirementResult struct {
	OperationScope       string                `json:"operation_scope"`
	Summary              string                `json:"summary"`
	ExplicitRequirements []string              `json:"explicit_requirements"`
	NegativeConstraints  []string              `json:"negative_constraints"`
	Assumptions          []string              `json:"assumptions"`
	Decisions            []RequirementDecision `json:"decisions"`
	NeedClarification    bool                  `json:"need_clarification"`
	Questions            []string              `json:"questions"`
}

func NewRequirementAgent(model agent.ModelManager) RequirementAgent {
	return RequirementAgent{
		Model:        model,
		SystemPrompt: requirementAgentPrompt,
	}
}

func (r *RequirementAgent) Run(
	ctx context.Context,
	input RequirementInput,
) (*schema.StreamReader[*schema.Message], error) {
	messages, err := r.buildMessages(input)
	if err != nil {
		return nil, err
	}

	chatModel, err := r.Model.LoadModel(ctx)
	if err != nil {
		return nil, err
	}

	return chatModel.Stream(ctx, messages)
}

func (r *RequirementAgent) Analyze(
	ctx context.Context,
	input RequirementInput,
) (*RequirementResult, error) {
	messages, err := r.buildMessages(input)
	if err != nil {
		return nil, err
	}

	chatModel, err := r.Model.LoadModel(ctx)
	if err != nil {
		return nil, err
	}

	msg, err := chatModel.Generate(ctx, messages)
	if err != nil {
		return nil, err
	}

	jsonText, err := extractJSONObject(msg.Content)
	if err != nil {
		return nil, fmt.Errorf("extract requirement result json: %w", err)
	}

	var result RequirementResult
	if err := json.Unmarshal([]byte(jsonText), &result); err != nil {
		return nil, fmt.Errorf("parse requirement result json: %w", err)
	}

	if err := ValidateRequirementResult(&result); err != nil {
		return nil, fmt.Errorf("validate requirement result: %w", err)
	}

	return &result, nil
}

func (r *RequirementAgent) buildMessages(input RequirementInput) ([]*schema.Message, error) {
	userMessage := input.Message
	if input.CurrentERDesign != nil {
		erDesignJSON, err := json.Marshal(input.CurrentERDesign)
		if err != nil {
			return nil, fmt.Errorf("marshal current er design: %w", err)
		}

		userMessage = fmt.Sprintf(
			"【当前 ER 设计】\n%s\n\n【用户本次需求】\n%s\n\n请基于当前 ER 设计输出本次增量决策，不要重复创建已有内容。",
			erDesignJSON,
			input.Message,
		)
	}

	return []*schema.Message{
		schema.SystemMessage(r.SystemPrompt),
		schema.UserMessage(userMessage),
	}, nil
}

func ValidateRequirementResult(result *RequirementResult) error {
	if result == nil {
		return errors.New("result is nil")
	}

	validOperationScopes := map[string]bool{
		"create": true,
		"modify": true,
		"delete": true,
		"mixed":  true,
	}
	validOperations := map[string]bool{
		"create": true,
		"modify": true,
		"delete": true,
	}
	validTargetTypes := map[string]bool{
		"entity":     true,
		"attribute":  true,
		"relation":   true,
		"constraint": true,
	}
	validSources := map[string]bool{
		"explicit": true,
		"inferred": true,
	}

	result.OperationScope = strings.TrimSpace(result.OperationScope)
	result.Summary = strings.TrimSpace(result.Summary)

	if !validOperationScopes[result.OperationScope] {
		return fmt.Errorf("invalid operation_scope: %q", result.OperationScope)
	}
	if result.Summary == "" {
		return errors.New("summary is required")
	}
	if result.NeedClarification && len(result.Questions) == 0 {
		return errors.New("questions are required when need_clarification is true")
	}
	if !result.NeedClarification && len(result.Decisions) == 0 {
		return errors.New("decisions are required when need_clarification is false")
	}

	for i := range result.Decisions {
		decision := &result.Decisions[i]
		decision.Operation = strings.TrimSpace(decision.Operation)
		decision.TargetType = strings.TrimSpace(decision.TargetType)
		decision.Target = strings.TrimSpace(decision.Target)
		decision.Description = strings.TrimSpace(decision.Description)
		decision.Reason = strings.TrimSpace(decision.Reason)
		decision.Source = strings.TrimSpace(decision.Source)

		if !validOperations[decision.Operation] {
			return fmt.Errorf("decisions[%d].operation is invalid: %q", i, decision.Operation)
		}
		if !validTargetTypes[decision.TargetType] {
			return fmt.Errorf("decisions[%d].target_type is invalid: %q", i, decision.TargetType)
		}
		if decision.Target == "" {
			return fmt.Errorf("decisions[%d].target is required", i)
		}
		if decision.Description == "" {
			return fmt.Errorf("decisions[%d].description is required", i)
		}
		if decision.Reason == "" {
			return fmt.Errorf("decisions[%d].reason is required", i)
		}
		if !validSources[decision.Source] {
			return fmt.Errorf("decisions[%d].source is invalid: %q", i, decision.Source)
		}
	}

	return nil
}

func extractJSONObject(content string) (string, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", errors.New("model response content is empty")
	}

	start := strings.Index(content, "{")
	if start < 0 {
		return "", errors.New("json object start not found")
	}

	inString := false
	escaped := false
	depth := 0

	for i := start; i < len(content); i++ {
		ch := content[i]

		if inString {
			if escaped {
				escaped = false
				continue
			}
			switch ch {
			case '\\':
				escaped = true
			case '"':
				inString = false
			}
			continue
		}

		switch ch {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return content[start : i+1], nil
			}
		}
	}

	return "", errors.New("json object end not found")
}
