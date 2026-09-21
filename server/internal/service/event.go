package service

type StreamEventType string

const (
	EventThinking StreamEventType = "thinking"  // 思考过程 / 正文 token 流
	EventStatus   StreamEventType = "status"    // 业务阶段状态提示（如"正在分析"、"正在落库"）
	EventToolCall StreamEventType = "tool_call" // 工具调用触发通知
	EventResult   StreamEventType = "result"    // 最终业务结果数据（例如落库后的 ERDesign）
	EventError    StreamEventType = "error"     // 错误信息
	EventDone     StreamEventType = "done"      // 流式结束标识
)

// StreamEvent 统一的流式事件传输载体
type StreamEvent struct {
	Type StreamEventType `json:"type"`
	Data any             `json:"data"`
}
