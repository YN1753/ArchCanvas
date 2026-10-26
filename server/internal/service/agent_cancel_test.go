package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"archcanvas/internal/agent"
	"archcanvas/internal/domain"
	"archcanvas/internal/service/tools"
	"archcanvas/request"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

func TestAgent_AnalyzeRequirement_ImmediateCancellation(t *testing.T) {
	mockModel := NewMockChatModel(
		[]*schema.Message{
			schema.AssistantMessage("正在思考...", nil),
			makeRequirementToolMsg(tools.ProposeRequirementArgs{
				Summary: "模型",
				Concepts: []domain.BusinessConcept{
					{ID: "c1", Name: "User"},
					{ID: "c2", Name: "Order"},
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

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 预先取消上下文，模拟请求到达时客户端已断开

	_, err := svc.AnalyzeRequirement(ctx, RequirementInput{
		ProjectID: "p1",
		Message:   "设计一个电商系统，包含用户模块和订单模块",
	}, nil)

	if err == nil {
		t.Fatalf("expected context.Canceled error, but got nil")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected error to be context.Canceled, got: %v", err)
	}
}

func TestAgent_DerivePhysicalSchema_Cancellation_NoRuleFallback(t *testing.T) {
	mockModel := NewMockChatModel()
	modelManager := &agent.ModelManager{
		CurrentProvider: "mock",
		CurrentName:     "mock_model",
		Cache: map[string]model.ToolCallingChatModel{
			"mock:mock_model": mockModel,
		},
	}

	svc := NewAgentService(modelManager, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	conceptualDesign := &domain.ConceptualDesign{
		Concepts: []domain.BusinessConcept{
			{ID: "c_user", Name: "User", DisplayName: "用户"},
			{ID: "c_order", Name: "Order", DisplayName: "订单"},
		},
	}

	// 当上下文取消时，禁止盲目回退到本地规则计算，必须立即向外抛出 context.Canceled
	res, err := svc.DerivePhysicalSchema(ctx, DerivePhysicalInput{
		ProjectID:        "p1",
		ConceptualDesign: conceptualDesign,
	}, nil)

	if err == nil {
		t.Fatalf("expected context.Canceled, but got nil with result: %+v", res)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected error to be context.Canceled, got: %v", err)
	}
}

func TestAgent_EnrichSemantics_Cancellation_NoRuleFallback(t *testing.T) {
	mockModel := NewMockChatModel()
	modelManager := &agent.ModelManager{
		CurrentProvider: "mock",
		CurrentName:     "mock_model",
		Cache: map[string]model.ToolCallingChatModel{
			"mock:mock_model": mockModel,
		},
	}

	svc := NewAgentService(modelManager, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	res, err := svc.EnrichSemantics(ctx, request.EnrichSemanticsReq{
		Design: &domain.ERDesign{
			Entities: []domain.Entity{
				{ID: "e1", Name: "users"},
			},
		},
	})

	if err == nil {
		t.Fatalf("expected context.Canceled on EnrichSemantics, got nil with result: %+v", res)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got: %v", err)
	}
}

func TestAgent_ProposeConcepts_ClientDisconnect_CleanTermination(t *testing.T) {
	mockModel := NewMockChatModel(
		[]*schema.Message{
			schema.AssistantMessage("正在进行长文本思考...", nil),
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

	ctx, cancel := context.WithCancel(context.Background())

	outCh, err := svc.ProposeConcepts(ctx, request.ProposeConceptsReq{
		ProjectID: "proj_cancel_1",
		Input:     "这是一个复杂的需求分析设计，包含多个模块",
	})
	if err != nil {
		t.Fatalf("ProposeConcepts returned error: %v", err)
	}

	// 接收第一个状态事件
	select {
	case evt, ok := <-outCh:
		if !ok {
			t.Fatalf("channel closed prematurely")
		}
		if evt.Type != EventStatus {
			t.Fatalf("expected EventStatus, got %s", evt.Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timeout waiting for initial status event")
	}

	// 模拟客户端浏览器主动关闭 SSE 连接 (触发 ctx 取消)
	cancel()

	// 验证通道在毫秒级内安全关闭，没有挂起或泄漏
	done := make(chan struct{})
	go func() {
		for range outCh {
			// 消费剩余缓冲事件
		}
		close(done)
	}()

	select {
	case <-done:
		// 成功快速安全关闭通道
	case <-time.After(2 * time.Second):
		t.Fatalf("timeout waiting for outCh to close after cancellation, potential goroutine leak")
	}
}
