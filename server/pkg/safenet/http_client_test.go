package safenet

import (
	"net"
	"net/http"
	"net/url"
	"testing"
)

func TestValidateEndpointURL(t *testing.T) {
	badURLs := []string{
		"file:///etc/passwd",
		"ftp://example.com/v1",
		"http://169.254.169.254/latest/meta-data",
		"http://100.100.100.200/latest/meta-data",
		"http://[fd00:ec2::254]/latest/meta-data",
		"http://metadata.google.internal/computeMetadata/v1",
		"http://0.0.0.0:8080/v1",
		"https://user:pass@example.com/v1",
		"http:///v1",
	}
	for _, u := range badURLs {
		if err := ValidateEndpointURL(u); err == nil {
			t.Errorf("ValidateEndpointURL(%q) = nil, expected error", u)
		}
	}

	goodURLs := []string{
		"https://api.openai.com/v1",
		"http://localhost:11434/v1",
		"http://127.0.0.1:8000",
	}
	for _, u := range goodURLs {
		if err := ValidateEndpointURL(u); err != nil {
			t.Errorf("ValidateEndpointURL(%q) unexpected error: %v", u, err)
		}
	}
}

func TestIsDisallowedIP_PrivateBlockingEnv(t *testing.T) {
	loopback := net.ParseIP("127.0.0.1")
	priv := net.ParseIP("10.0.0.5")

	t.Setenv("ARCHCANVAS_BLOCK_PRIVATE_MODEL_URLS", "0")
	if IsDisallowedIP(loopback) || IsDisallowedIP(priv) {
		t.Fatalf("expected loopback/private allowed when ARCHCANVAS_BLOCK_PRIVATE_MODEL_URLS != 1")
	}

	t.Setenv("ARCHCANVAS_BLOCK_PRIVATE_MODEL_URLS", "1")
	if !IsDisallowedIP(loopback) || !IsDisallowedIP(priv) {
		t.Fatalf("expected loopback/private blocked when ARCHCANVAS_BLOCK_PRIVATE_MODEL_URLS == 1")
	}
}

func TestCheckRedirect_StripsCrossHostAuthAndBlocksIMDS(t *testing.T) {
	origURL, _ := url.Parse("https://api.openai.com/v1/models")
	origReq := &http.Request{URL: origURL, Header: http.Header{"Authorization": []string{"Bearer sk-secret"}}}

	crossURL, _ := url.Parse("https://cdn.other-host.com/v1/models")
	crossReq := &http.Request{URL: crossURL, Header: http.Header{"Authorization": []string{"Bearer sk-secret"}}}

	if err := CheckRedirect(crossReq, []*http.Request{origReq}); err != nil {
		t.Fatalf("unexpected error on safe cross-host redirect: %v", err)
	}
	if got := crossReq.Header.Get("Authorization"); got != "" {
		t.Fatalf("expected Authorization header stripped on cross-host redirect, got %q", got)
	}

	imdsURL, _ := url.Parse("http://169.254.169.254/latest/meta-data")
	imdsReq := &http.Request{URL: imdsURL, Header: make(http.Header)}
	if err := CheckRedirect(imdsReq, []*http.Request{origReq}); err == nil {
		t.Fatal("expected IMDS redirect to be blocked")
	}

	if err := CheckRedirect(crossReq, []*http.Request{origReq, origReq, origReq}); err == nil {
		t.Fatal("expected >3 redirects to be stopped")
	}
}

func TestHelpersAndClients(t *testing.T) {
	if !IsLoopbackEndpoint("http://localhost:11434/v1") || !IsLoopbackEndpoint("http://[::1]:8080") {
		t.Fatal("expected loopback endpoint detection to return true")
	}
	if IsLoopbackEndpoint("https://api.openai.com/v1") {
		t.Fatal("expected public endpoint to return false")
	}
	if got := NormalizeEndpointURL(" https://api.openai.com/v1/// "); got != "https://api.openai.com/v1" {
		t.Fatalf("NormalizeEndpointURL = %q", got)
	}
	if NewProbeHTTPClient() == nil || NewModelHTTPClient() == nil {
		t.Fatal("expected non-nil HTTP clients")
	}
}
