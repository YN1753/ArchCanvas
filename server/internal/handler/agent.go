package handler

import (
	"archcanvas/internal/service"
	"archcanvas/pkg/response"
	"archcanvas/request"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type AgentHandler struct {
	Agent service.AgentService
}

func NewAgentHandler(agent service.AgentService) AgentHandler {
	return AgentHandler{
		Agent: agent,
	}
}

func (a *AgentHandler) AnalyzeRequirement(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.AnalyzeRequirementReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error(), nil)
		return
	}

	input := strings.TrimSpace(req.Input)
	if input == "" {
		response.Fail(c, http.StatusBadRequest, "input is required", nil)
		return
	}

	result, err := a.Agent.AnalyzeRequirement(ctx, req.ProjectID, input)
	if err != nil {
		response.Fail(c, http.StatusBadGateway, err.Error(), nil)
		return
	}

	response.Success(c, result)
}

func (a *AgentHandler) Chat(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.GetChatReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, 400, err.Error(), nil)
		return
	}
	stream, err := a.Agent.Run(ctx, req.Input)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	defer stream.Close()
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

	for {
		msg, err := stream.Recv()

		if err == io.EOF {
			c.SSEvent("done", gin.H{"ok": true})
			flush()
			break
		}

		if err != nil {
			c.SSEvent("error", gin.H{"message": err.Error()})
			flush()
			return
		}

		if msg.Content == "" {
			continue
		}

		c.SSEvent("message", gin.H{"content": msg.Content})
		flush()
	}
}
