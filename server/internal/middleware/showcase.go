package middleware

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"archcanvas/internal/config"
	"archcanvas/pkg/id"
	"archcanvas/pkg/reqctx"
	"archcanvas/pkg/response"

	"github.com/gin-gonic/gin"
)

const (
	HeaderXVisitorID  string = "X-Visitor-ID"
	VisitorCookieName string = "archcanvas_vid"
	GlobalQuotaScope  string = "__global__"
	OfficialVisitorID string = reqctx.OfficialVisitorID
)

// ShowcaseQuotaStore 抽象演示配额存储接口，使 middleware 层彻底零依赖 GORM 与持久化模型。
type ShowcaseQuotaStore interface {
	GetDailyUsage(ctx context.Context, dayKey, ipScope string) (ipUsed int, globalUsed int, err error)
	TryConsumeDailyQuota(ctx context.Context, dayKey, ipScope string, ipDailyLimit, globalDailyLimit int, now time.Time) (ipRem int, globalRem int, ipExhausted bool, globalExhausted bool, err error)
	RefundDailyQuota(ctx context.Context, dayKey, ipScope string) error
	DeleteQuotasBefore(ctx context.Context, cutoffDay string) error
}

var (
	showcaseLoc     = time.FixedZone("CST", 8*3600)
	trustedCIDROnce sync.Once
	trustedCIDRs    []*net.IPNet
)

func initTrustedProxyCIDRs() {
	trustedCIDROnce.Do(func() {
		rawCIDRs := []string{
			// 本机回环与内网反向代理（如 cloudflared、Nginx、Caddy、Docker 网桥）
			"127.0.0.0/8",
			"10.0.0.0/8",
			"172.16.0.0/12",
			"192.168.0.0/16",
			"::1/128",
			"fc00::/7",
			// Cloudflare 官方边缘节点 IPv4 网段
			"173.245.48.0/20",
			"103.21.244.0/22",
			"103.22.200.0/22",
			"103.31.4.0/22",
			"141.101.64.0/18",
			"108.162.192.0/18",
			"190.93.240.0/20",
			"188.114.96.0/20",
			"197.234.240.0/22",
			"198.41.128.0/17",
			"162.158.0.0/15",
			"104.16.0.0/13",
			"104.24.0.0/14",
			"172.64.0.0/13",
			"131.0.72.0/22",
			// Cloudflare 官方边缘节点 IPv6 网段
			"2400:cb00::/32",
			"2606:4700::/32",
			"2803:f800::/32",
			"2405:b500::/32",
			"2405:8100::/32",
			"2a06:98c0::/29",
			"2c0f:f248::/32",
		}
		for _, cidr := range rawCIDRs {
			if _, ipNet, err := net.ParseCIDR(cidr); err == nil {
				trustedCIDRs = append(trustedCIDRs, ipNet)
			}
		}
	})
}

func isTrustedProxyPeer(ip net.IP) bool {
	if ip == nil {
		return false
	}
	initTrustedProxyCIDRs()
	for _, cidr := range trustedCIDRs {
		if cidr.Contains(ip) {
			return true
		}
	}
	return false
}

// NormalizeQuotaIP 将 IPv4 规整为点分十进制，将 IPv6 规整至 /64 子网前缀，防止攻击者利用 /64 地址池轮换绕过单 IP 限额。
func NormalizeQuotaIP(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "unknown"
	}
	if host, _, err := net.SplitHostPort(trimmed); err == nil {
		trimmed = host
	}
	ip := net.ParseIP(trimmed)
	if ip == nil {
		return "unknown"
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.String()
	}
	masked := ip.Mask(net.CIDRMask(64, 128))
	return masked.String() + "/64"
}

// ExtractShowcaseClientIP 提取真实访客 IP（仅当直接连接对端属于受信任反向代理时才采信转发头）。
func ExtractShowcaseClientIP(r *http.Request) string {
	if r == nil {
		return "unknown"
	}
	peerHost := strings.TrimSpace(r.RemoteAddr)
	if h, _, err := net.SplitHostPort(peerHost); err == nil {
		peerHost = h
	}
	peerIP := net.ParseIP(peerHost)

	if isTrustedProxyPeer(peerIP) {
		for _, header := range []string{"CF-Connecting-IP", "True-Client-IP", "X-Real-IP"} {
			if val := strings.TrimSpace(r.Header.Get(header)); val != "" {
				if norm := NormalizeQuotaIP(val); norm != "unknown" {
					return norm
				}
			}
		}
		if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
			for _, part := range strings.Split(xff, ",") {
				if norm := NormalizeQuotaIP(part); norm != "unknown" {
					return norm
				}
			}
		}
	}

	if peerIP != nil {
		return NormalizeQuotaIP(peerIP.String())
	}
	return "unknown"
}

// ShowcaseVisitorMiddleware 在演示沙盒模式下为每位匿名访客签发/识别隔离的 UUIDv7 访客身份。
func ShowcaseVisitorMiddleware(enabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !enabled {
			c.Next()
			return
		}

		vid := strings.TrimSpace(c.GetHeader(HeaderXVisitorID))
		if !id.IsValidUUID(vid) {
			if cookieVal, err := c.Cookie(VisitorCookieName); err == nil {
				vid = strings.TrimSpace(cookieVal)
			}
		}
		if !id.IsValidUUID(vid) || vid == OfficialVisitorID {
			vid = id.NewUUIDv7()
		}

		isSecure := c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
		http.SetCookie(c.Writer, &http.Cookie{
			Name:     VisitorCookieName,
			Value:    vid,
			Path:     "/",
			MaxAge:   30 * 24 * 3600,
			HttpOnly: true,
			Secure:   isSecure,
			SameSite: http.SameSiteLaxMode,
		})
		c.Header(HeaderXVisitorID, vid)

		ctx := reqctx.WithShowcaseVisitor(c.Request.Context(), vid)
		c.Request = c.Request.WithContext(ctx)

		c.Next()
	}
}

// IsShowcaseMode 判断当前请求上下文是否处于公开演示沙盒模式。
func IsShowcaseMode(ctx context.Context) bool {
	return reqctx.IsShowcaseMode(ctx)
}

// GetVisitorID 从请求上下文中获取匿名访客隔离 ID。
func GetVisitorID(ctx context.Context) string {
	return reqctx.VisitorIDFromContext(ctx)
}

// VisitorIDFromContext 从请求上下文中获取匿名访客隔离 ID。
func VisitorIDFromContext(ctx context.Context) string {
	return reqctx.VisitorIDFromContext(ctx)
}

// WithShowcaseVisitor 为内部调用或测试显式注入演示沙盒模式与访客标识。
func WithShowcaseVisitor(ctx context.Context, visitorID string) context.Context {
	return reqctx.WithShowcaseVisitor(ctx, visitorID)
}

// ShowcaseModelGuardMiddleware 在公开演示沙盒模式下锁死模型配置保存与任意 BaseURL 探测接口。
func ShowcaseModelGuardMiddleware(enabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !enabled {
			c.Next()
			return
		}

		path := c.Request.URL.Path
		if c.Request.Method == http.MethodPost && strings.HasSuffix(path, "/save") {
			response.Fail(c, http.StatusForbidden, "公开演示沙盒模式下已锁定服务端模型配置，禁止修改默认模型与密钥", nil)
			c.Abort()
			return
		}
		if c.Request.Method == http.MethodPost && (strings.HasSuffix(path, "/probe") || strings.HasSuffix(path, "/list")) {
			response.Fail(c, http.StatusForbidden, "公开演示沙盒模式下已禁用自定义模型端点探测", nil)
			c.Abort()
			return
		}
		if c.Request.Method == http.MethodGet {
			q := c.Request.URL.Query()
			if strings.TrimSpace(q.Get("base_url")) != "" || strings.TrimSpace(q.Get("api_key")) != "" {
				response.Fail(c, http.StatusForbidden, "公开演示沙盒模式下禁止传入自定义 base_url 或 api_key 进行探测", nil)
				c.Abort()
				return
			}
		}

		c.Next()
	}
}

// ShowcaseQuotaManager 负责管理公开演示模式下按自然日持久化的单 IP 与全站 AI 调用限额。
type ShowcaseQuotaManager struct {
	store ShowcaseQuotaStore
	cfg   config.ShowcaseConfig
}

func isNilQuotaStore(s ShowcaseQuotaStore) bool {
	if s == nil {
		return true
	}
	v := reflect.ValueOf(s)
	return v.Kind() == reflect.Ptr && v.IsNil()
}

func NewShowcaseQuotaManager(store ShowcaseQuotaStore, cfg config.ShowcaseConfig) *ShowcaseQuotaManager {
	cfg.NormalizeDefaults()
	if isNilQuotaStore(store) {
		store = nil
	}
	return &ShowcaseQuotaManager{
		store: store,
		cfg:   cfg,
	}
}

func (m *ShowcaseQuotaManager) Enabled() bool {
	return m != nil && m.cfg.Enabled
}

func (m *ShowcaseQuotaManager) Config() config.ShowcaseConfig {
	if m == nil {
		var c config.ShowcaseConfig
		c.NormalizeDefaults()
		return c
	}
	return m.cfg
}

func currentDayKey(now time.Time) string {
	return now.In(showcaseLoc).Format("2006-01-02")
}

// GetUsage 查询当前 IP 与全局今日已用次数。
func (m *ShowcaseQuotaManager) GetUsage(ctx context.Context, clientIP string) (ipUsed int, globalUsed int, err error) {
	if m == nil || m.store == nil {
		return 0, 0, nil
	}
	dayKey := currentDayKey(time.Now())
	ipScope := "ip:" + NormalizeQuotaIP(clientIP)
	return m.store.GetDailyUsage(ctx, dayKey, ipScope)
}

// TryConsume 原子检查并扣减 1 次当前 IP 与全局今日 AI 体验配额。
func (m *ShowcaseQuotaManager) TryConsume(ctx context.Context, clientIP string) (ipRem int, globalRem int, blockedMsg string, err error) {
	if m == nil || !m.cfg.Enabled || m.store == nil {
		return 999, 999, "", nil
	}

	now := time.Now()
	dayKey := currentDayKey(now)
	ipScope := "ip:" + NormalizeQuotaIP(clientIP)

	ipRem, globalRem, ipExhausted, globalExhausted, err := m.store.TryConsumeDailyQuota(
		ctx, dayKey, ipScope, m.cfg.IPDailyLimit, m.cfg.GlobalDailyLimit, now,
	)
	if err != nil {
		return 0, 0, "", err
	}
	if globalExhausted {
		blockedMsg = fmt.Sprintf(
			"今日全站 AI 架构师公开体验总额度（%d 次/日）已用完，明日 00:00 自动恢复。您仍可免限流体验双视图切换、SQL 逆向解析与 Go 工程代码导出！",
			m.cfg.GlobalDailyLimit,
		)
	} else if ipExhausted {
		blockedMsg = fmt.Sprintf(
			"您今日的 AI 架构师免费体验额度（%d 次/日）已达上限，明日 00:00 自动恢复。您仍可免限流体验陈氏/物理双视图、拓扑排版与 Go 脚手架导出！",
			m.cfg.IPDailyLimit,
		)
	}
	return ipRem, globalRem, blockedMsg, nil
}

// Refund 在请求因参数错误（400/403/404）未能真正进入大模型调用前退还 1 次预扣配额。
func (m *ShowcaseQuotaManager) Refund(ctx context.Context, clientIP string) {
	if m == nil || !m.cfg.Enabled || m.store == nil {
		return
	}
	dayKey := currentDayKey(time.Now())
	ipScope := "ip:" + NormalizeQuotaIP(clientIP)
	_ = m.store.RefundDailyQuota(ctx, dayKey, ipScope)
}

// CleanupExpiredQuotas 清理 3 天前的历史日配额记录，防止统计表无限增长。
func (m *ShowcaseQuotaManager) CleanupExpiredQuotas(ctx context.Context) error {
	if m == nil || m.store == nil {
		return nil
	}
	cutoffDay := currentDayKey(time.Now().Add(-72 * time.Hour))
	return m.store.DeleteQuotasBefore(ctx, cutoffDay)
}

// AgentRateLimitMiddleware 对 /api/v1/agent/* 路由组施加 Cloudflare 真实访客 IP 每日限额与全站每日总上限保护。
func (m *ShowcaseQuotaManager) AgentRateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if m == nil || !m.cfg.Enabled {
			c.Next()
			return
		}

		clientIP := ExtractShowcaseClientIP(c.Request)
		ipRem, globalRem, blockedMsg, err := m.TryConsume(c.Request.Context(), clientIP)
		if err != nil {
			LoggerFromContext(c.Request.Context()).Error("showcase_quota_check_failed", "client_ip", clientIP, "error", err)
			response.Fail(c, http.StatusInternalServerError, "校验演示体验配额失败，请稍后重试", nil)
			c.Abort()
			return
		}

		c.Header("X-RateLimit-Limit", strconv.Itoa(m.cfg.IPDailyLimit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(ipRem))
		c.Header("X-GlobalLimit-Remaining", strconv.Itoa(globalRem))

		if blockedMsg != "" {
			response.Fail(c, http.StatusTooManyRequests, blockedMsg, gin.H{
				"ip_daily_limit":     m.cfg.IPDailyLimit,
				"ip_remaining":       ipRem,
				"global_daily_limit": m.cfg.GlobalDailyLimit,
				"global_remaining":   globalRem,
			})
			c.Abort()
			return
		}

		c.Next()

		status := c.Writer.Status()
		if status == http.StatusBadRequest || status == http.StatusForbidden || status == http.StatusNotFound {
			rCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			m.Refund(rCtx, clientIP)
			cancel()
		}
	}
}
