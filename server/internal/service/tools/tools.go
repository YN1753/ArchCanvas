package tools

import (
	"context"

	"github.com/cloudwego/eino/schema"
)

// BuildRequirementTools 构建需求分析算子专用的结构化工具列表
func BuildRequirementTools(ctx context.Context) ([]*schema.ToolInfo, error) {
	_, reqInfo, err := NewProposeRequirementTool(ctx)
	if err != nil {
		return nil, err
	}
	return []*schema.ToolInfo{reqInfo}, nil
}

// BuildDesignTools 构建物理建模算子专用的结构化工具列表
func BuildDesignTools(ctx context.Context) ([]*schema.ToolInfo, error) {
	_, saveInfo, err := NewSaveERDesignTool(ctx)
	if err != nil {
		return nil, err
	}
	return []*schema.ToolInfo{saveInfo}, nil
}

// BuildTools 兼容旧接口
func BuildTools(ctx context.Context) ([]*schema.ToolInfo, error) {
	return BuildDesignTools(ctx)
}
