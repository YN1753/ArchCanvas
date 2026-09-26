package handler

import (
	"archcanvas/internal/service"
	"archcanvas/pkg/response"
	"archcanvas/request"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type AgentHandler struct {
	Agent *service.AgentService
}

func NewAgentHandler(agent *service.AgentService) AgentHandler {
	return AgentHandler{
		Agent: agent,
	}
}

// Chat 原有全流程黑盒二段生成端点（保留向后兼容）
func (a *AgentHandler) Chat(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.ChatReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	input := strings.TrimSpace(req.Input)
	if input == "" {
		response.Fail(c, http.StatusBadRequest, "input is required", nil)
		return
	}

	req.Input = input
	eventCh, err := a.Agent.Chat(ctx, req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}

	streamSSE(c, eventCh)
}

// ProposeConcepts Layer 1: 业务需求与概念建模端点 (输出陈氏图概念与纯业务关联)
func (a *AgentHandler) ProposeConcepts(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.ProposeConceptsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	input := strings.TrimSpace(req.Input)
	if input == "" {
		response.Fail(c, http.StatusBadRequest, "input is required", nil)
		return
	}

	req.Input = input
	eventCh, err := a.Agent.ProposeConcepts(ctx, req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}

	streamSSE(c, eventCh)
}

// DerivePhysical Layer 2: 逻辑规范化与物理表工程推导端点 (根据陈氏图推导物理表与索引)
func (a *AgentHandler) DerivePhysical(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.DerivePhysicalReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	if req.ProjectID == "" {
		response.Fail(c, http.StatusBadRequest, "project_id is required", nil)
		return
	}

	eventCh, err := a.Agent.DerivePhysical(ctx, req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}

	streamSSE(c, eventCh)
}

// ReviewSchema Layer 3: 架构师质量与性能守卫端点 (对物理数据表执行深度架构体检)
func (a *AgentHandler) ReviewSchema(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.ReviewSchemaReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	if req.ProjectID == "" {
		response.Fail(c, http.StatusBadRequest, "project_id is required", nil)
		return
	}

	eventCh, err := a.Agent.ReviewSchema(ctx, req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}

	streamSSE(c, eventCh)
}

// streamSSE 统一的 SSE 事件流写入与刷写辅助函数
func streamSSE(c *gin.Context, eventCh <-chan service.StreamEvent) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	flusher, _ := c.Writer.(http.Flusher)
	flush := func() {
		if flusher != nil {
			flusher.Flush()
		}
	}
	flush()

	ctx := c.Request.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-eventCh:
			if !ok {
				return
			}
			c.SSEvent(string(event.Type), event.Data)
			flush()
		}
	}
}
