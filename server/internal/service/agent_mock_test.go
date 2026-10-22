package service

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/domain"
	"archcanvas/internal/service/tools"
	"archcanvas/request"
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// MockToolCallingChatModel 模拟大模型，支持按调用轮次顺序弹出预设回复
type MockToolCallingChatModel struct {
	mu        sync.Mutex
	responses [][]*schema.Message
	callIndex int
}

func NewMockChatModel(responses ...[]*schema.Message) *MockToolCallingChatModel {
	return &MockToolCallingChatModel{
		responses: responses,
	}
}

func (m *MockToolCallingChatModel) Generate(ctx context.Context, input []*schema.Message, opts ...model.Option) (*schema.Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.callIndex >= len(m.responses) {
		return schema.AssistantMessage("default mock response", nil), nil
	}
	resSlice := m.responses[m.callIndex]
	m.callIndex++

	concat, err := schema.ConcatMessages(resSlice)
	if err != nil {
		return nil, err
	}
	return concat, nil
}

func (m *MockToolCallingChatModel) Stream(ctx context.Context, input []*schema.Message, opts ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var resSlice []*schema.Message
	if m.callIndex < len(m.responses) {
		resSlice = m.responses[m.callIndex]
		m.callIndex++
	} else {
		resSlice = []*schema.Message{schema.AssistantMessage("default mock response", nil)}
	}

	sr, sw := schema.Pipe[*schema.Message](len(resSlice) + 1)
	go func() {
		defer sw.Close()
		for _, msg := range resSlice {
			sw.Send(msg, nil)
		}
	}()

	return sr, nil
}

func (m *MockToolCallingChatModel) WithTools(tools []*schema.ToolInfo) (model.ToolCallingChatModel, error) {
	// 返回自身，保持状态共享
	return m, nil
}

// 辅助创建包含 ProposeRequirement 工具调用的消息
func makeRequirementToolMsg(args tools.ProposeRequirementArgs) *schema.Message {
	argsBytes, _ := json.Marshal(args)
	return &schema.Message{
		Role: schema.Assistant,
		ToolCalls: []schema.ToolCall{
			{
				ID: "tc_req_1",
				Function: schema.FunctionCall{
					Name:      tools.ProposeRequirementToolName,
					Arguments: string(argsBytes),
				},
			},
		},
	}
}

// 辅助创建包含 ProposeDesign 工具调用的消息
func makeDesignToolMsg(args tools.ProposeSchemaDesignArgs) *schema.Message {
	argsBytes, _ := json.Marshal(args)
	return &schema.Message{
		Role: schema.Assistant,
		ToolCalls: []schema.ToolCall{
			{
				ID: "tc_design_1",
				Function: schema.FunctionCall{
					Name:      tools.ProposeSchemaDesignToolName,
					Arguments: string(argsBytes),
				},
			},
		},
	}
}

func TestAgent_MockNormalConceptFlow(t *testing.T) {
	// 场景 1：正常概念建模流程推导成功
	mockModel := NewMockChatModel(
		[]*schema.Message{
			schema.AssistantMessage("AI 分析思考：正在梳理商城核心模型…", nil),
			makeRequirementToolMsg(tools.ProposeRequirementArgs{
				Summary: "电商核心概念模型",
				Concepts: []domain.BusinessConcept{
					{ID: "c_user", Name: "User", DisplayName: "用户"},
					{ID: "c_order", Name: "Order", DisplayName: "订单"},
				},
				Relations: []domain.ConceptRelation{
					{ID: "r_1", SourceConcept: "c_user", TargetConcept: "c_order", Cardinality: "one_to_many"},
				},
				NeedClarification: false,
			}),
		},
	)

	modelManager := &agent.ModelManager{
		CurrentProvider: "mock",
		CurrentName:     "mock_model",
		Cache: map[string]model.ToolCallingChatModel{
			"mock:mock_model": mockModel,
		},
	}

	svc := NewAgentService(modelManager, nil)
	outCh, err := svc.ProposeConcepts(context.Background(), request.ProposeConceptsReq{
		ProjectID:     "proj_mock_1",
		Input:         "构建一个商城系统，包含用户注册管理和订单创建流转",
		ModelProvider: "mock",
		ModelName:     "mock_model",
	})
	if err != nil {
		t.Fatalf("ProposeConcepts returned error: %v", err)
	}

	var hasResult bool
	var finalNeedClarification bool
	for evt := range outCh {
		if evt.Type == EventResult {
			hasResult = true
			if resMap, ok := evt.Data.(map[string]interface{}); ok {
				finalNeedClarification = resMap["need_clarification"].(bool)
			}
		}
	}

	if !hasResult {
		t.Error("expected EventResult event, got none")
	}
	if finalNeedClarification {
		t.Error("expected need_clarification=false for normal flow")
	}
}

func TestAgent_MockClarificationBranch(t *testing.T) {
	// 场景 2：需求存在模糊点，模型主动发起澄清卡片
	mockModel := NewMockChatModel(
		[]*schema.Message{
			schema.AssistantMessage("AI 分析：需要澄清交付履约细节…", nil),
			makeRequirementToolMsg(tools.ProposeRequirementArgs{
				Summary:           "发现模糊需求，请确认业务规则",
				Concepts:          []domain.BusinessConcept{{ID: "c_user", Name: "User"}},
				NeedClarification: true,
				Questions:         []string{"系统是否支持自提与邮寄多模式？"},
				ClarificationCards: []domain.ClarificationCard{
					{
						ID:    "delivery_mode",
						Title: "交付模式确认",
					},
				},
			}),
		},
	)

	modelManager := &agent.ModelManager{
		CurrentProvider: "mock",
		CurrentName:     "mock_model",
		Cache: map[string]model.ToolCallingChatModel{
			"mock:mock_model": mockModel,
		},
	}

	svc := NewAgentService(modelManager, nil)
	outCh, err := svc.ProposeConcepts(context.Background(), request.ProposeConceptsReq{
		ProjectID:     "proj_mock_2",
		Input:         "我们要搭建一个支持商品和交付的系统",
		ModelProvider: "mock",
		ModelName:     "mock_model",
	})
	if err != nil {
		t.Fatalf("ProposeConcepts returned error: %v", err)
	}

	var clarifFired bool
	for evt := range outCh {
		if evt.Type == EventResult {
			if resMap, ok := evt.Data.(map[string]interface{}); ok {
				if need, ok := resMap["need_clarification"].(bool); ok && need {
					clarifFired = true
				}
			}
		}
	}

	if !clarifFired {
		t.Error("expected clarification branch to trigger with need_clarification=true")
	}
}

func TestAgent_MockRetryFeedbackLoop(t *testing.T) {
	// 场景 3：结构化自纠错重试机制（Feedback Loop）
	// 第 1 轮：模型返回损坏的 JSON / 缺失闭合
	// 第 2 轮：系统捕获错误后提示模型重试，模型返回合法的物理表 ER 设计
	corruptedJSONMsg := schema.AssistantMessage("```json\n{\"entities\": [{\"id\": \"e1\", \"name\": \"users\", \"attributes\": [ \n```", nil)
	validDesignToolMsg := makeDesignToolMsg(tools.ProposeSchemaDesignArgs{
		Entities: []domain.Entity{
			{
				ID:   "ent_user",
				Name: "users",
				Attributes: []domain.Attribute{
					{ID: "a1", Name: "id", DBType: "BIGINT", CodeType: "uint64", IsPrimaryKey: true},
					{ID: "a2", Name: "name", DBType: "VARCHAR(64)", CodeType: "string"},
				},
			},
		},
	})

	mockModel := NewMockChatModel(
		[]*schema.Message{corruptedJSONMsg},
		[]*schema.Message{validDesignToolMsg},
	)

	modelManager := &agent.ModelManager{
		CurrentProvider: "mock",
		CurrentName:     "mock_model",
		Cache: map[string]model.ToolCallingChatModel{
			"mock:mock_model": mockModel,
		},
	}

	svc := NewAgentService(modelManager, nil)
	var thinkLogs []string

	design, err := svc.DesignSchema(context.Background(), SchemaDesignInput{
		ModelProvider: "mock",
		ModelName:     "mock_model",
	}, func(chunk string) {
		thinkLogs = append(thinkLogs, chunk)
	})

	if err != nil {
		t.Fatalf("DesignSchema failed on retry loop: %v", err)
	}
	if design == nil || len(design.Entities) != 1 {
		t.Fatalf("expected 1 entity after retry, got: %v", design)
	}
	if design.Entities[0].Name != "users" {
		t.Errorf("expected entity 'users', got: %s", design.Entities[0].Name)
	}

	// 验证确实发生了纠错提示重试
	retryNoticeFound := false
	for _, log := range thinkLogs {
		if json.Valid([]byte(log)) || len(log) > 0 {
			if log != "" && (len(log) > 10 && log[0] == '\n') {
				retryNoticeFound = true
			}
		}
	}
	if !retryNoticeFound && mockModel.callIndex < 2 {
		t.Errorf("expected at least 2 model calls due to retry, got callIndex=%d", mockModel.callIndex)
	}
}

func TestAgent_MockContextCancel(t *testing.T) {
	// 场景 4：客户端提前断开/取消上下文，流程安全终止，通道关闭且不 panic
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 立即取消

	mockModel := NewMockChatModel(
		[]*schema.Message{
			schema.AssistantMessage("chunk1", nil),
		},
	)

	modelManager := &agent.ModelManager{
		CurrentProvider: "mock",
		CurrentName:     "mock_model",
		Cache: map[string]model.ToolCallingChatModel{
			"mock:mock_model": mockModel,
		},
	}

	svc := NewAgentService(modelManager, nil)
	outCh, err := svc.ProposeConcepts(ctx, request.ProposeConceptsReq{
		ProjectID:     "proj_mock_cancel",
		Input:         "做一套客户关系系统",
		ModelProvider: "mock",
		ModelName:     "mock_model",
	})
	if err != nil {
		t.Fatalf("expected no initial error, got %v", err)
	}

	// 验证通道能正常消费并在取消后及时退出
	done := make(chan bool)
	go func() {
		for range outCh {
		}
		done <- true
	}()

	select {
	case <-done:
		// 成功退出
	case <-time.After(2 * time.Second):
		t.Fatal("ProposeConcepts goroutine hung after ctx was canceled")
	}
}
