package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"runtime/debug"
	"strings"
	"time"

	"archcanvas/internal/dialect"
	"archcanvas/pkg/reqctx"

	"github.com/cloudwego/eino/schema"
)

var errModelManagerNotConfigured = errors.New("model manager is not configured")

func normalizeDialect(raw string) string {
	return dialect.NormalizeID(raw)
}

type projectAccessPolicy int

const (
	accessNone projectAccessPolicy = iota
	accessReadable
	accessWritable
)

type sseTaskOptions struct {
	Access  projectAccessPolicy
	Timeout time.Duration
}

type sseStreamSession struct {
	svc              *AgentService
	ctx              context.Context
	projectID        string
	readOnlyTemplate bool
	convID           string
	send             func(StreamEvent) bool
	thinking         strings.Builder
}

func (s *sseStreamSession) onThinking(chunk string) {
	s.thinking.WriteString(chunk)
	s.send(StreamEvent{Type: EventThinking, Data: chunk})
}

func (s *sseStreamSession) ensureConversation() string {
	if s.convID != "" || s.readOnlyTemplate {
		return s.convID
	}
	if s.svc.ProjectService != nil && s.projectID != "" {
		if cid, err := s.svc.ProjectService.EnsureProjectConversation(s.ctx, s.projectID); err == nil && cid != "" {
			s.convID = cid
		}
	}
	return s.convID
}

func (s *sseStreamSession) saveAssistant(payload map[string]any) {
	if s.readOnlyTemplate {
		return
	}
	s.svc.saveAssistantMessage(s.convID, payload)
}

func (s *sseStreamSession) failWithError(summary string, sendPrefix string, err error) {
	if errors.Is(err, context.Canceled) || s.ctx.Err() != nil {
		return
	}
	msg := err.Error()
	if sendPrefix != "" {
		msg = sendPrefix + msg
	}
	s.send(StreamEvent{Type: EventError, Data: msg})
	s.saveAssistant(map[string]any{
		"summary":  summary,
		"thinking": s.thinking.String(),
		"status":   "error",
		"error":    err.Error(),
	})
}

func makeStreamSender(ctx context.Context, outCh chan<- StreamEvent) func(StreamEvent) bool {
	return func(evt StreamEvent) bool {
		// 对高频 thinking token 实施非阻塞降级保护：若慢客户端已填满大容量缓冲，仅等待短暂窗口，避免永久反压卡死上游 LLM 读取
		if evt.Type == EventThinking {
			select {
			case outCh <- evt:
				return true
			case <-ctx.Done():
				return false
			case <-time.After(2 * time.Second):
				return ctx.Err() == nil
			}
		}
		select {
		case outCh <- evt:
			return true
		case <-ctx.Done():
			return false
		}
	}
}

// launchSSETask 统一封装 SSE 流式任务的同步前置鉴权、缓冲通道创建、生命周期注册、异常恢复与资源释放。
func (a *AgentService) launchSSETask(
	ctx context.Context,
	projectID string,
	opts sseTaskOptions,
	fn func(session *sseStreamSession),
) (<-chan StreamEvent, error) {
	var readOnlyTemplate bool
	trimmedProjectID := strings.TrimSpace(projectID)
	if a.ProjectService != nil && trimmedProjectID != "" {
		switch opts.Access {
		case accessWritable:
			if _, err := a.ProjectService.EnsureWritableProject(ctx, trimmedProjectID); err != nil {
				return nil, err
			}
		case accessReadable:
			proj, err := a.ProjectService.EnsureReadableProject(ctx, trimmedProjectID)
			if err != nil {
				return nil, err
			}
			readOnlyTemplate = proj.IsTemplate
		}
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = defaultAgentRunTimeout
	}

	outCh := make(chan StreamEvent, sseChannelBufferSize)
	runCtx, finishRun := a.lifecycle.beginRun(ctx, projectID, timeout)

	go func() {
		defer close(outCh)
		defer finishRun()

		session := &sseStreamSession{
			svc:              a,
			ctx:              runCtx,
			projectID:        projectID,
			readOnlyTemplate: readOnlyTemplate,
			send:             makeStreamSender(runCtx, outCh),
		}

		defer func() {
			if recovered := recover(); recovered != nil {
				reqctx.LoggerFromContext(runCtx).Error("agent_sse_task_panic_recovered",
					"project_id", projectID,
					"panic", fmt.Sprintf("%v", recovered),
					"stack", string(debug.Stack()),
				)
				if runCtx.Err() == nil {
					session.send(StreamEvent{
						Type: EventError,
						Data: "AI 任务执行期间发生内部异常",
					})
				}
			}
		}()

		fn(session)
	}()

	return outCh, nil
}

// buildRetryAssistantContent 保证纠错重试轮次的 Assistant 消息非空且携带错误参数摘要，避免上游模型报 400 空消息错误。
func buildRetryAssistantContent(concatMsg *schema.Message) string {
	if concatMsg == nil {
		return "[empty model output]"
	}
	if strings.TrimSpace(concatMsg.Content) != "" {
		return truncateRunes(concatMsg.Content, 3000)
	}
	if len(concatMsg.ToolCalls) > 0 {
		tc := concatMsg.ToolCalls[0]
		args := truncateRunes(tc.Function.Arguments, 2000)
		return fmt.Sprintf("[tool_call %s arguments]: %s", tc.Function.Name, args)
	}
	return "[empty model output]"
}

type structuredStreamConfig[T any] struct {
	ModelProvider             string
	ModelName                 string
	BuildTools                func(ctx context.Context) ([]*schema.ToolInfo, error)
	InitialMessages           []*schema.Message
	MaxRetries                int
	RetryOnStreamError        bool
	AllowPartialStreamOnError bool
	OnThinking                func(chunk string)
	RetryNotice               func(attempt int) string
	ParseToolCall             func(tc schema.ToolCall) (*T, bool, error)
	ParseContent              func(raw string) (*T, error)
	BuildRetryPrompt          func(parseErr error) string
	FinalErrorMessage         string
}

// executeStructuredStream 统一收敛全后端流式大模型调用、双路解析（ToolCall + llmjson.Parse 正文回退）与格式校验自纠错重试闭环。
func executeStructuredStream[T any](
	ctx context.Context,
	a *AgentService,
	cfg structuredStreamConfig[T],
) (*T, string, error) {
	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}
	if a == nil || a.ModelManager == nil {
		return nil, "", errModelManagerNotConfigured
	}

	chatModel, err := a.ModelManager.GetChatModel(ctx, cfg.ModelProvider, cfg.ModelName)
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			return nil, "", ctx.Err()
		}
		return nil, "", err
	}

	if cfg.BuildTools != nil {
		toolList, err := cfg.BuildTools(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return nil, "", ctx.Err()
			}
			return nil, "", err
		}
		chatModel, err = chatModel.WithTools(toolList)
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return nil, "", ctx.Err()
			}
			return nil, "", err
		}
	}

	currentMessages := cfg.InitialMessages
	var lastRaw string

	for attempt := 0; attempt <= cfg.MaxRetries; attempt++ {
		if ctx.Err() != nil {
			return nil, "", ctx.Err()
		}
		if attempt > 0 && cfg.OnThinking != nil && cfg.RetryNotice != nil {
			if notice := cfg.RetryNotice(attempt); notice != "" {
				cfg.OnThinking(notice)
			}
		}

		stream, err := chatModel.Stream(ctx, currentMessages)
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return nil, "", ctx.Err()
			}
			if cfg.RetryOnStreamError && attempt < cfg.MaxRetries {
				continue
			}
			return nil, "", err
		}

		var accumulated []*schema.Message
		var rawBuilder strings.Builder
		var streamErr error

		for {
			select {
			case <-ctx.Done():
				stream.Close()
				return nil, "", ctx.Err()
			default:
			}
			chunk, recvErr := stream.Recv()
			if errors.Is(recvErr, io.EOF) {
				break
			}
			if recvErr != nil {
				stream.Close()
				if errors.Is(recvErr, context.Canceled) || ctx.Err() != nil {
					return nil, "", ctx.Err()
				}
				streamErr = recvErr
				break
			}
			if chunk.Content != "" {
				rawBuilder.WriteString(chunk.Content)
				if cfg.OnThinking != nil {
					cfg.OnThinking(chunk.Content)
				}
			}
			accumulated = append(accumulated, chunk)
		}
		stream.Close()
		lastRaw = rawBuilder.String()

		if streamErr != nil && !cfg.AllowPartialStreamOnError {
			if cfg.RetryOnStreamError && attempt < cfg.MaxRetries {
				continue
			}
			return nil, lastRaw, streamErr
		}

		concatMsg, concatErr := schema.ConcatMessages(accumulated)
		var parseErr error

		if concatErr == nil && cfg.ParseToolCall != nil && len(concatMsg.ToolCalls) > 0 {
			for _, tc := range concatMsg.ToolCalls {
				parsed, matched, tcErr := cfg.ParseToolCall(tc)
				if !matched {
					continue
				}
				if tcErr == nil && parsed != nil {
					return parsed, lastRaw, nil
				}
				parseErr = tcErr
			}
		}

		if cfg.ParseContent != nil {
			content := lastRaw
			if concatErr == nil && concatMsg != nil && concatMsg.Content != "" {
				content = concatMsg.Content
			}
			if content != "" || cfg.AllowPartialStreamOnError {
				parsed, cErr := cfg.ParseContent(content)
				if cErr == nil && parsed != nil {
					return parsed, content, nil
				}
				if cErr != nil {
					parseErr = cErr
				}
			}
		}

		if attempt < cfg.MaxRetries && cfg.BuildRetryPrompt != nil {
			var retryConcat *schema.Message
			if concatErr == nil {
				retryConcat = concatMsg
			} else if lastRaw != "" {
				retryConcat = schema.AssistantMessage(lastRaw, nil)
			}
			currentMessages = append(currentMessages,
				schema.AssistantMessage(buildRetryAssistantContent(retryConcat), nil),
				schema.UserMessage(cfg.BuildRetryPrompt(parseErr)),
			)
		}
	}

	if cfg.FinalErrorMessage != "" {
		return nil, lastRaw, errors.New(cfg.FinalErrorMessage)
	}
	return nil, lastRaw, errors.New("failed to obtain structured LLM response")
}
