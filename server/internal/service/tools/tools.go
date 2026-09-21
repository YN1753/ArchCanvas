package tools

import (
	"context"

	"github.com/cloudwego/eino/schema"
)

func BuildTools(ctx context.Context) ([]*schema.ToolInfo, error) {
	_, saveInfo, err := NewSaveERDesignTool(ctx)
	if err != nil {
		return nil, err
	}

	return []*schema.ToolInfo{
		saveInfo,
	}, nil
}
