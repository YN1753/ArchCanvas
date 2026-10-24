package tools

import (
	"context"
	"testing"
)

func TestNewProposeRequirementTool(t *testing.T) {
	ctx := context.Background()
	tool, info, err := NewProposeRequirementTool(ctx)
	if err != nil {
		t.Fatalf("NewProposeRequirementTool failed: %v", err)
	}
	if info == nil || info.Name != ProposeRequirementToolName {
		t.Fatalf("unexpected ToolInfo: %+v", info)
	}

	// 验证工具调用
	raw, err := tool.InvokableRun(ctx, `{"summary":"测试业务需求模型","concepts":[{"id":"c_user","name":"用户"}]}`)
	if err != nil {
		t.Fatalf("tool invocation failed: %v", err)
	}
	if raw != "success" {
		t.Fatalf("expected 'success', got %v", raw)
	}
}

func TestNewSaveERDesignTool(t *testing.T) {
	ctx := context.Background()
	tool, info, err := NewSaveERDesignTool(ctx)
	if err != nil {
		t.Fatalf("NewSaveERDesignTool failed: %v", err)
	}
	if info == nil || info.Name != SaveERDesignToolName {
		t.Fatalf("unexpected ToolInfo: %+v", info)
	}

	// 验证工具调用
	raw, err := tool.InvokableRun(ctx, `{"summary":"物理表设计","entities":[{"id":"ent_1","name":"users"}]}`)
	if err != nil {
		t.Fatalf("tool invocation failed: %v", err)
	}
	if raw != "success" {
		t.Fatalf("expected 'success', got %v", raw)
	}
}

func TestBuildRequirementTools(t *testing.T) {
	ctx := context.Background()
	tools, err := BuildRequirementTools(ctx)
	if err != nil {
		t.Fatalf("BuildRequirementTools failed: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != ProposeRequirementToolName {
		t.Fatalf("expected 1 tool 'propose_requirement', got: %+v", tools)
	}
}

func TestBuildDesignTools(t *testing.T) {
	ctx := context.Background()
	tools, err := BuildDesignTools(ctx)
	if err != nil {
		t.Fatalf("BuildDesignTools failed: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != SaveERDesignToolName {
		t.Fatalf("expected 1 tool 'save_er_design', got: %+v", tools)
	}

	legacyTools, err := BuildTools(ctx)
	if err != nil {
		t.Fatalf("BuildTools failed: %v", err)
	}
	if len(legacyTools) != 1 || legacyTools[0].Name != SaveERDesignToolName {
		t.Fatalf("expected legacy BuildTools to align with BuildDesignTools, got: %+v", legacyTools)
	}
}
