package service

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultAgentRunTimeout = 3 * time.Minute
	sseChannelBufferSize   = 256
)

type activeRunSlot struct {
	token  uint64
	cancel context.CancelFunc
}

type runLifecycle struct {
	mu         sync.Mutex
	wg         sync.WaitGroup
	nextToken  atomic.Uint64
	activeRuns map[string]activeRunSlot
}

// beginRun 注册一次项目的后台 Agent 执行：
// 1. 纳入全局 WaitGroup 以便优雅停机时等待在途写库安全排空；
// 2. 同一 projectID 若存在未结束的旧推理任务，自动取消旧任务以防并发写库相互覆盖与对话乱序；
// 3. 注入总体超时上限，彻底根除上游大模型 TCP 半开挂死导致的协程永久泄漏。
func (l *runLifecycle) beginRun(parentCtx context.Context, projectID string, timeout time.Duration) (context.Context, func()) {
	if timeout <= 0 {
		timeout = defaultAgentRunTimeout
	}
	runCtx, cancel := context.WithTimeout(parentCtx, timeout)
	token := l.nextToken.Add(1)

	l.wg.Add(1)
	if projectID != "" {
		l.mu.Lock()
		if l.activeRuns == nil {
			l.activeRuns = make(map[string]activeRunSlot)
		}
		if prev, exists := l.activeRuns[projectID]; exists && prev.cancel != nil {
			prev.cancel()
		}
		l.activeRuns[projectID] = activeRunSlot{
			token:  token,
			cancel: cancel,
		}
		l.mu.Unlock()
	}

	var once sync.Once
	finish := func() {
		once.Do(func() {
			cancel()
			if projectID != "" {
				l.mu.Lock()
				if cur, exists := l.activeRuns[projectID]; exists && cur.token == token {
					delete(l.activeRuns, projectID)
				}
				l.mu.Unlock()
			}
			l.wg.Done()
		})
	}

	return runCtx, finish
}

// wait 阻塞直至所有活跃 Agent 协程安全退出或 ctx 超时。
func (l *runLifecycle) wait(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		l.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Wait 等待所有后台 Agent 流式任务排空完成，供主进程优雅停机在关闭 SQLite 前调用。
func (a *AgentService) Wait(ctx context.Context) error {
	if a == nil {
		return nil
	}
	return a.lifecycle.wait(ctx)
}
