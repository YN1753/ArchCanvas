package handler

import (
	"archcanvas/internal/dto"
	"archcanvas/internal/middleware"
	"archcanvas/internal/service"
	"archcanvas/pkg/response"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-contrib/sse"
	"github.com/gin-gonic/gin"
)

const maxAgentInputRunes = 32000

type AgentHandler struct {
	Agent *service.AgentService
}

func NewAgentHandler(agent *service.AgentService) AgentHandler {
	return AgentHandler{
		Agent: agent,
	}
}

// Chat 原有全流程二段生成端点（保留向后兼容）
func (a *AgentHandler) Chat(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.ChatReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	input := strings.TrimSpace(req.Input)
	if input == "" {
		response.Fail(c, http.StatusBadRequest, "input is required", nil)
		return
	}
	if utf8.RuneCountInString(input) > maxAgentInputRunes {
		response.Fail(c, http.StatusBadRequest, fmt.Sprintf("输入内容过长（上限 %d 字符）", maxAgentInputRunes), nil)
		return
	}

	req.Input = input
	eventCh, err := a.Agent.Chat(ctx, req)
	if err != nil {
		respondServiceError(c, err, "启动 AI 架构推导失败")
		return
	}

	streamSSE(c, eventCh)
}

// ProposeConcepts Layer 1: 业务需求与概念建模端点
func (a *AgentHandler) ProposeConcepts(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.ProposeConceptsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	input := strings.TrimSpace(req.Input)
	if input == "" {
		response.Fail(c, http.StatusBadRequest, "input is required", nil)
		return
	}
	if utf8.RuneCountInString(input) > maxAgentInputRunes {
		response.Fail(c, http.StatusBadRequest, fmt.Sprintf("输入内容过长（上限 %d 字符）", maxAgentInputRunes), nil)
		return
	}

	req.Input = input
	eventCh, err := a.Agent.ProposeConcepts(ctx, req)
	if err != nil {
		respondServiceError(c, err, "启动业务概念建模失败")
		return
	}

	streamSSE(c, eventCh)
}

// DerivePhysical Layer 2: 逻辑规范化与物理表工程推导端点
func (a *AgentHandler) DerivePhysical(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.DerivePhysicalReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	if strings.TrimSpace(req.ProjectID) == "" {
		response.Fail(c, http.StatusBadRequest, "project_id is required", nil)
		return
	}

	eventCh, err := a.Agent.DerivePhysical(ctx, req)
	if err != nil {
		respondServiceError(c, err, "启动物理数据表推导失败")
		return
	}

	streamSSE(c, eventCh)
}

// ReviewSchema Layer 3: 架构师质量与性能守卫端点
func (a *AgentHandler) ReviewSchema(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.ReviewSchemaReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	if strings.TrimSpace(req.ProjectID) == "" {
		response.Fail(c, http.StatusBadRequest, "project_id is required", nil)
		return
	}

	eventCh, err := a.Agent.ReviewSchema(ctx, req)
	if err != nil {
		respondServiceError(c, err, "启动架构体检失败")
		return
	}

	streamSSE(c, eventCh)
}

// EnrichSemantics 轻量 LLM 全图概念层语义推导端点（为多轮重试延长写截止时间防止连接被中途截断）
func (a *AgentHandler) EnrichSemantics(c *gin.Context) {
	ctx := c.Request.Context()
	var req dto.EnrichSemanticsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		respondBindError(c, err, "")
		return
	}

	rc := http.NewResponseController(c.Writer)
	_ = rc.SetWriteDeadline(time.Now().Add(3 * time.Minute))

	result, err := a.Agent.EnrichSemantics(ctx, req)
	if err != nil {
		respondServiceError(c, err, "推导概念层语义失败")
		return
	}

	response.Success(c, result)
}

// streamSSE 统一的 SSE 事件流写入与刷写辅助函数（带写错误检测、单调事件序列号与心跳保活）
func streamSSE(c *gin.Context, eventCh <-chan service.StreamEvent) {
	traceID := middleware.GetTraceID(c.Request.Context())
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	if traceID != "" {
		c.Header(middleware.HeaderXRequestID, traceID)
	}
	c.Status(http.StatusOK)

	rc := http.NewResponseController(c.Writer)
	extendDeadline := func() {
		_ = rc.SetWriteDeadline(time.Now().Add(90 * time.Second))
	}

	flusher, _ := c.Writer.(http.Flusher)
	flush := func() {
		extendDeadline()
		if flusher != nil {
			flusher.Flush()
		}
	}
	flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	ctx := c.Request.Context()
	var seq uint64
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			extendDeadline()
			if _, err := c.Writer.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			flush()
		case event, ok := <-eventCh:
			if !ok {
				return
			}
			seq++
			eventID := fmt.Sprintf("%d", seq)
			if traceID != "" {
				eventID = fmt.Sprintf("%s-%d", traceID, seq)
			}
			extendDeadline()
			if err := (sse.Event{
				Id:    eventID,
				Event: string(event.Type),
				Data:  event.Data,
			}).Render(c.Writer); err != nil {
				return
			}
			flush()
		}
	}
}
