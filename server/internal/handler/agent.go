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
