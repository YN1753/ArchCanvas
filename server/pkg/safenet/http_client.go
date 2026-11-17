package safenet

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// IsLoopbackEndpoint reports whether rawURL targets a local loopback hostname (localhost, 127.0.0.1, ::1).
func IsLoopbackEndpoint(rawURL string) bool {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

// NormalizeEndpointURL trims surrounding whitespace and trailing slashes.
func NormalizeEndpointURL(rawURL string) string {
	return strings.TrimRight(strings.TrimSpace(rawURL), "/")
}

// IsDisallowedIP reports whether ip belongs to cloud IMDS, link-local, multicast, unspecified,
// or (when ARCHCANVAS_BLOCK_PRIVATE_MODEL_URLS=1) private/loopback ranges.
func IsDisallowedIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	ipStr := ip.String()
	// Aliyun IMDS (100.100.100.200) and AWS IPv6 IMDS (fd00:ec2::254)
	if ipStr == "100.100.100.200" || strings.EqualFold(ipStr, "fd00:ec2::254") {
		return true
	}
	if os.Getenv("ARCHCANVAS_BLOCK_PRIVATE_MODEL_URLS") == "1" {
		if ip.IsPrivate() || ip.IsLoopback() {
			return true
		}
	}
	return false
}

// ValidateEndpointURL validates URL scheme, rejects embedded userinfo credentials, and blocks cloud metadata / SSRF targets.
func ValidateEndpointURL(rawURL string) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return fmt.Errorf("invalid base_url: %w", err)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("unsupported url scheme %q: only http and https are allowed", parsed.Scheme)
	}
	if parsed.User != nil {
		return errors.New("credentials in base_url are not allowed")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return errors.New("base_url host is required")
	}
	switch host {
	case "metadata.google.internal", "metadata", "metadata.azure.internal", "169.254.169.254", "100.100.100.200":
		return fmt.Errorf("disallowed metadata host %q", host)
	}
	if ip := net.ParseIP(host); ip != nil {
		if IsDisallowedIP(ip) {
			return fmt.Errorf("disallowed IP address %q", host)
		}
	}
	return nil
}

// NewSafeDialContext builds a DNS-rebinding-resistant DialContext that validates all resolved IPs before connecting.
func NewSafeDialContext(timeout time.Duration) func(ctx context.Context, network, addr string) (net.Conn, error) {
	dialer := &net.Dialer{
		Timeout:   timeout,
		KeepAlive: 30 * time.Second,
	}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("no IP addresses resolved for host %q", host)
		}
		for _, ipAddr := range ips {
			if IsDisallowedIP(ipAddr.IP) {
				return nil, fmt.Errorf("blocked SSRF connection to disallowed resolved IP %s for host %q", ipAddr.IP.String(), host)
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}
}

// CheckRedirect enforces at most 3 redirects, validates redirect targets against SSRF,
// and strips Authorization headers on cross-host redirects to prevent API key exfiltration.
func CheckRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 3 {
		return errors.New("stopped after 3 redirects")
	}
	if err := ValidateEndpointURL(req.URL.String()); err != nil {
		return fmt.Errorf("blocked unsafe redirect target: %w", err)
	}
	if len(via) > 0 && !strings.EqualFold(req.URL.Host, via[0].URL.Host) {
		req.Header.Del("Authorization")
	}
	return nil
}

// NewProbeHTTPClient builds an SSRF-safe HTTP client tuned for fast model-list endpoint probing.
func NewProbeHTTPClient() *http.Client {
	return &http.Client{
		Timeout:       6 * time.Second,
		CheckRedirect: CheckRedirect,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           NewSafeDialContext(4 * time.Second),
			MaxIdleConns:          32,
			IdleConnTimeout:       60 * time.Second,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 6 * time.Second,
		},
	}
}

// NewModelHTTPClient builds an SSRF-safe HTTP client tuned for long-running streaming LLM inference.
func NewModelHTTPClient() *http.Client {
	return &http.Client{
		CheckRedirect: CheckRedirect,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           NewSafeDialContext(10 * time.Second),
			MaxIdleConns:          64,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
		},
	}
}
