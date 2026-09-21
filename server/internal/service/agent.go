package service

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/domain"
	"archcanvas/internal/service/tools"
	"archcanvas/request"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/cloudwego/eino/schema"
)

type AgentService struct {
	ModelManager   *agent.ModelManager
	ProjectService *ProjectService
}

func NewAgentService(
	modelManager *agent.ModelManager,
	projectService *ProjectService,
) *AgentService {
	return &AgentService{
		ModelManager:   modelManager,
		ProjectService: projectService,
	}
}

// Chat 作为总指挥中枢，显式编排全流程：
// 1. 组装输入；2. 调用 AnalyzeRequirement 推理并推送打字流；
// 3. 开发者在代码中执行硬编码业务决策（如澄清分支）；4. 显式调用 ProjectService 落库；5. 推送最终结果。
func (a *AgentService) Chat(
	ctx context.Context,
	req request.ChatReq,
) (<-chan StreamEvent, error) {
	outCh := make(chan StreamEvent, 20)

	go func() {
		defer close(outCh)

		// 1. 获取项目已有画布设计作为上下文
		var currentDesign *domain.ERDesign
		if a.ProjectService != nil && req.ProjectID != "" {
			design, err := a.ProjectService.GetERDesign(ctx, req.ProjectID)
			if err == nil {
				currentDesign = design
			}
		}

		// 2. 发送初始状态
		outCh <- StreamEvent{Type: EventStatus, Data: "AI 正在分析架构需求…"}

		// 3. 调用纯净推理方法：只负责接收 Input、产出 Output，期间将思考 token 回调推给打字机
		output, err := a.AnalyzeRequirement(ctx, RequirementInput{
			ProjectID:       req.ProjectID,
			Message:         req.Input,
			CurrentERDesign: currentDesign,
			ModelProvider:   req.ModelProvider,
			ModelName:       req.ModelName,
		}, func(chunk string) {
			outCh <- StreamEvent{Type: EventThinking, Data: chunk}
		})
		if err != nil {
			outCh <- StreamEvent{Type: EventError, Data: err.Error()}
			return
		}

		// 4. 开发者在代码里写显式硬编码业务逻辑判断！
		if output.NeedClarification {
			// 检测到需求存在歧义，不盲目落库，直接向前端返回确认问题
			outCh <- StreamEvent{Type: EventStatus, Data: "检测到需求存在疑问，需要进一步确认"}
			outCh <- StreamEvent{Type: EventResult, Data: output}
			outCh <- StreamEvent{Type: EventDone, Data: true}
			return
		}

		// 5. 显式调用 ProjectService 落库，代码清晰可控
		outCh <- StreamEvent{Type: EventStatus, Data: "数据模型分析完成，正在持久化落库…"}
		outCh <- StreamEvent{Type: EventToolCall, Data: output}

		if a.ProjectService != nil && req.ProjectID != "" {
			savedResult, err := a.ProjectService.SaveERDesign(ctx, req.ProjectID, domain.ERDesign{
				Entities:  output.Entities,
				Relations: output.Relations,
			})
			if err != nil {
				outCh <- StreamEvent{Type: EventError, Data: "落库失败: " + err.Error()}
				return
			}
			// 6. 将最终落库成功的设计图回传前端
			outCh <- StreamEvent{Type: EventResult, Data: savedResult.Design}
		} else {
			outCh <- StreamEvent{Type: EventResult, Data: domain.ERDesign{
				Entities:  output.Entities,
				Relations: output.Relations,
			}}
		}

		// 7. 发送流式完成标记
		outCh <- StreamEvent{Type: EventDone, Data: true}
	}()

	return outCh, nil
}

// AnalyzeRequirement 纯净的推理方法：
// 职责单一：接收 Input，返回严格填写的 Output；每收到一个思考 token 触发 onThinking 回调。
// 绝不触碰任何数据库逻辑，不产生隐式副作用。
func (a *AgentService) AnalyzeRequirement(
	ctx context.Context,
	input RequirementInput,
	onThinking func(chunk string),
) (*RequirementOutput, error) {
	if a.ModelManager == nil {
		return nil, errors.New("model manager is not configured")
	}

	chatModel, err := a.ModelManager.GetModel(ctx, input.ModelProvider, input.ModelName)
	if err != nil {
		return nil, err
	}

	toolList, err := tools.BuildTools(ctx)
	if err != nil {
		return nil, err
	}
	toolModel, err := chatModel.WithTools(toolList)
	if err != nil {
		return nil, err
	}

	messages := a.buildRequirementMessages(input)

	// 调用大模型 Stream 发起流式推理
	stream, err := toolModel.Stream(ctx, messages)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	var accumulatedMses []*schema.Message

	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}

		if chunk.Content != "" && onThinking != nil {
			onThinking(chunk.Content)
		}

		accumulatedMses = append(accumulatedMses, chunk)
	}

	concatMsg, err := schema.ConcatMessages(accumulatedMses)
	if err == nil && len(concatMsg.ToolCalls) > 0 {
		for _, tc := range concatMsg.ToolCalls {
			if tc.Function.Name == tools.SaveERDesignToolName {
				var args tools.ProposeERDesignArgs
				if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err == nil {
					return &RequirementOutput{
						Summary:           args.Summary,
						Entities:          args.Entities,
						Relations:         args.Relations,
						NeedClarification: args.NeedClarification,
						Questions:         args.Questions,
					}, nil
				}
			}
		}
	}
	if concatMsg != nil && concatMsg.Content != "" {
		if parsed, err := tryParseJSONContent(concatMsg.Content); err == nil {
			return parsed, nil
		}
		return &RequirementOutput{
			Summary:           concatMsg.Content,
			Entities:          []domain.Entity{},
			Relations:         []domain.Relation{},
			NeedClarification: false,
		}, nil
	}

	return nil, errors.New("大模型未返回有效的结构化数据模型设计方案")
}

// buildRequirementMessages 组装大模型结构化 Prompt
func (a *AgentService) buildRequirementMessages(input RequirementInput) []*schema.Message {
	var prompt strings.Builder
	prompt.WriteString("你是 ArchCanvas 的资深数据模型架构师。请分析用户需求，并通过调用 save_er_design 工具提交完整合理的设计方案。\n\n")

	if len(input.Constraints) > 0 {
		prompt.WriteString("【用户历史明确提出的硬性红线与禁忌（必须绝对遵守，严禁推翻违背）】：\n")
		for _, c := range input.Constraints {
			prompt.WriteString(fmt.Sprintf("- %s\n", c))
		}
		prompt.WriteString("\n")
	}
	if len(input.Decisions) > 0 {
		prompt.WriteString("【历史已达成的核心设计共识与决策】：\n")
		for _, d := range input.Decisions {
			prompt.WriteString(fmt.Sprintf("- %s\n", d))
		}
		prompt.WriteString("\n")
	}

	if input.CurrentERDesign != nil {
		erJSON, err := json.Marshal(input.CurrentERDesign)
		if err == nil {
			prompt.WriteString(fmt.Sprintf("【当前已有数据库设计】：\n%s\n\n请在已有设计基础上做增量修改或扩展，切勿无故删除或重构已有表。\n\n", string(erJSON)))
		}
	}

	prompt.WriteString("请先用自然语言简要陈述你的设计思路与业务考虑（这会实时展现给用户），并在最后调用 `save_er_design` 工具提交结构化数据模型。")

	return []*schema.Message{
		schema.SystemMessage(prompt.String()),
		schema.UserMessage(input.Message),
	}
}

func tryParseJSONContent(content string) (*RequirementOutput, error) {
	content = strings.TrimSpace(content)
	if strings.Contains(content, "```json") {
		parts := strings.Split(content, "```json")
		if len(parts) > 1 {
			jsonBlock, _, _ := strings.Cut(parts[1], "```")
			var out RequirementOutput
			if err := json.Unmarshal([]byte(strings.TrimSpace(jsonBlock)), &out); err == nil {
				return &out, nil
			}
		}
	}
	var out RequirementOutput
	if err := json.Unmarshal([]byte(content), &out); err == nil {
		return &out, nil
	}
	return nil, errors.New("cannot parse JSON")
}
