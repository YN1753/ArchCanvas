package reqctx

import (
	"context"
	"log/slog"
)

type contextKey string

const (
	traceIDKey        contextKey = "trace_id"
	loggerKey         contextKey = "trace_logger"
	visitorIDKey      contextKey = "visitor_id"
	showcaseModeKey   contextKey = "showcase_mode"
	OfficialVisitorID string     = "__official__"
)

// WithTraceID returns a derived context carrying traceID.
func WithTraceID(ctx context.Context, traceID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, traceIDKey, traceID)
}

// TraceIDFromContext extracts the bound traceID from ctx, or returns "" if absent.
func TraceIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if val, ok := ctx.Value(traceIDKey).(string); ok && val != "" {
		return val
	}
	return ""
}

// WithLogger returns a derived context carrying logger.
func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, loggerKey, logger)
}

// LoggerFromContext extracts the request-scoped slog.Logger from ctx, falling back to a trace_id-enriched or default logger.
func LoggerFromContext(ctx context.Context) *slog.Logger {
	if ctx != nil {
		if l, ok := ctx.Value(loggerKey).(*slog.Logger); ok && l != nil {
			return l
		}
		if traceID := TraceIDFromContext(ctx); traceID != "" {
			return slog.Default().With(slog.String("trace_id", traceID))
		}
	}
	return slog.Default()
}

// WithVisitorID returns a derived context carrying visitorID.
func WithVisitorID(ctx context.Context, visitorID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, visitorIDKey, visitorID)
}

// VisitorIDFromContext extracts the isolated anonymous visitorID from ctx.
func VisitorIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(visitorIDKey).(string)
	return v
}

// WithShowcaseMode returns a derived context marking whether showcase sandbox mode is active.
func WithShowcaseMode(ctx context.Context, enabled bool) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, showcaseModeKey, enabled)
}

// IsShowcaseMode reports whether ctx is running in public showcase sandbox mode.
func IsShowcaseMode(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	v, _ := ctx.Value(showcaseModeKey).(bool)
	return v
}

// WithShowcaseVisitor injects both showcase mode=true and visitorID into ctx.
func WithShowcaseVisitor(ctx context.Context, visitorID string) context.Context {
	ctx = WithShowcaseMode(ctx, true)
	return WithVisitorID(ctx, visitorID)
}
