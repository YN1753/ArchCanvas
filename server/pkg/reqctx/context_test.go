package reqctx

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func TestContextAccessors(t *testing.T) {
	if TraceIDFromContext(nil) != "" || VisitorIDFromContext(nil) != "" || IsShowcaseMode(nil) {
		t.Fatal("nil context must safely return zero values")
	}

	ctx := WithTraceID(context.Background(), "01960000-0000-7000-8000-000000000099")
	if got := TraceIDFromContext(ctx); got != "01960000-0000-7000-8000-000000000099" {
		t.Fatalf("TraceIDFromContext = %q", got)
	}

	var buf bytes.Buffer
	customLogger := slog.New(slog.NewTextHandler(&buf, nil)).With("custom", "yes")
	ctx = WithLogger(ctx, customLogger)
	LoggerFromContext(ctx).Info("hello")
	if !strings.Contains(buf.String(), "custom=yes") {
		t.Fatalf("expected custom logger from context, got %q", buf.String())
	}

	scCtx := WithShowcaseVisitor(context.Background(), "visitor-123")
	if !IsShowcaseMode(scCtx) {
		t.Fatal("expected IsShowcaseMode=true")
	}
	if got := VisitorIDFromContext(scCtx); got != "visitor-123" {
		t.Fatalf("VisitorIDFromContext = %q, want visitor-123", got)
	}
}
