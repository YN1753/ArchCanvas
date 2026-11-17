package middleware

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"archcanvas/internal/config"
	"archcanvas/internal/model"
	"archcanvas/pkg/id"
	"archcanvas/pkg/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	VisitorIDKey      contextKey = "visitor_id"
	ShowcaseModeKey   contextKey = "showcase_mode"
	HeaderXVisitorID  string     = "X-Visitor-ID"
	VisitorCookieName string     = "archcanvas_vid"
	GlobalQuotaScope  string     = "__global__"
	OfficialVisitorID string     = "__official__"
)

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

// ExtractShowcaseClientIP 提取真实访客 IP：
// 仅当直接连接对端属于受信任反向代理（本机回环、内网网关或 Cloudflare 官方边缘网段）时才采信 CF-Connecting-IP / X-Forwarded-For，
// 防止外部攻击者直连源站伪造请求头绕过单 IP 每日限额。
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

// ShowcaseVisitorMiddleware 在演示沙盒模式下为每位匿名访客签发/识别隔离的 UUIDv7 访客身份（支持 Cookie 与 X-Visitor-ID 双通道）。
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

		ctx := context.WithValue(c.Request.Context(), ShowcaseModeKey, true)
		ctx = context.WithValue(ctx, VisitorIDKey, vid)
		c.Request = c.Request.WithContext(ctx)

		c.Next()
	}
}

// IsShowcaseMode 判断当前请求上下文是否处于公开演示沙盒模式。
func IsShowcaseMode(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	v, _ := ctx.Value(ShowcaseModeKey).(bool)
	return v
}

// GetVisitorID 从请求上下文中获取匿名访客隔离 ID。
func GetVisitorID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(VisitorIDKey).(string)
	return v
}

// WithShowcaseVisitor 为内部调用或测试显式注入演示沙盒模式与访客标识。
func WithShowcaseVisitor(ctx context.Context, visitorID string) context.Context {
	ctx = context.WithValue(ctx, ShowcaseModeKey, true)
	return context.WithValue(ctx, VisitorIDKey, visitorID)
}

// ShowcaseModelGuardMiddleware 在公开演示沙盒模式下锁死模型配置保存与任意 BaseURL 探测接口，彻底阻断改配置与本机端口探测 SSRF。
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
	db  *gorm.DB
	cfg config.ShowcaseConfig
}

func NewShowcaseQuotaManager(db *gorm.DB, cfg config.ShowcaseConfig) *ShowcaseQuotaManager {
	cfg.NormalizeDefaults()
	return &ShowcaseQuotaManager{
		db:  db,
		cfg: cfg,
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
	if m == nil || m.db == nil {
		return 0, 0, nil
	}
	dayKey := currentDayKey(time.Now())
	ipScope := "ip:" + NormalizeQuotaIP(clientIP)

	var rows []model.ShowcaseQuota
	if err := m.db.WithContext(ctx).
		Where("day_key = ? AND scope_key IN ?", dayKey, []string{GlobalQuotaScope, ipScope}).
		Find(&rows).Error; err != nil {
		return 0, 0, err
	}
	for _, row := range rows {
		if row.ScopeKey == GlobalQuotaScope {
			globalUsed = row.UsedCount
		} else if row.ScopeKey == ipScope {
			ipUsed = row.UsedCount
		}
	}
	return ipUsed, globalUsed, nil
}

// TryConsume 原子检查并扣减 1 次当前 IP 与全局今日 AI 体验配额。
func (m *ShowcaseQuotaManager) TryConsume(ctx context.Context, clientIP string) (ipRem int, globalRem int, blockedMsg string, err error) {
	if m == nil || !m.cfg.Enabled || m.db == nil {
		return 999, 999, "", nil
	}

	now := time.Now()
	dayKey := currentDayKey(now)
	ipScope := "ip:" + NormalizeQuotaIP(clientIP)

	txErr := m.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []model.ShowcaseQuota
		if err := tx.Where("day_key = ? AND scope_key IN ?", dayKey, []string{GlobalQuotaScope, ipScope}).
			Find(&rows).Error; err != nil {
			return err
		}

		var ipUsed, globalUsed int
		for _, row := range rows {
			if row.ScopeKey == GlobalQuotaScope {
				globalUsed = row.UsedCount
			} else if row.ScopeKey == ipScope {
				ipUsed = row.UsedCount
			}
		}

		if globalUsed >= m.cfg.GlobalDailyLimit {
			ipRem = max(0, m.cfg.IPDailyLimit-ipUsed)
			globalRem = 0
			blockedMsg = fmt.Sprintf(
				"今日全站 AI 架构师公开体验总额度（%d 次/日）已用完，明日 00:00 自动恢复。您仍可免限流体验双视图切换、SQL 逆向解析与 Go 工程代码导出！",
				m.cfg.GlobalDailyLimit,
			)
			return nil
		}
		if ipUsed >= m.cfg.IPDailyLimit {
			ipRem = 0
			globalRem = max(0, m.cfg.GlobalDailyLimit-globalUsed)
			blockedMsg = fmt.Sprintf(
				"您今日的 AI 架构师免费体验额度（%d 次/日）已达上限，明日 00:00 自动恢复。您仍可免限流体验陈氏/物理双视图、拓扑排版与 Go 脚手架导出！",
				m.cfg.IPDailyLimit,
			)
			return nil
		}

		for _, scope := range []string{GlobalQuotaScope, ipScope} {
			upsert := model.ShowcaseQuota{
				DayKey:    dayKey,
				ScopeKey:  scope,
				UsedCount: 1,
				UpdatedAt: now,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "day_key"}, {Name: "scope_key"}},
				DoUpdates: clause.Assignments(map[string]any{
					"used_count": gorm.Expr("used_count + 1"),
					"updated_at": now,
				}),
			}).Create(&upsert).Error; err != nil {
				return err
			}
		}

		ipRem = max(0, m.cfg.IPDailyLimit-(ipUsed+1))
		globalRem = max(0, m.cfg.GlobalDailyLimit-(globalUsed+1))
		return nil
	})

	return ipRem, globalRem, blockedMsg, txErr
}

// Refund 在请求因参数错误（400/403/404）未能真正进入大模型调用前退还 1 次预扣配额。
func (m *ShowcaseQuotaManager) Refund(ctx context.Context, clientIP string) {
	if m == nil || !m.cfg.Enabled || m.db == nil {
		return
	}
	dayKey := currentDayKey(time.Now())
	ipScope := "ip:" + NormalizeQuotaIP(clientIP)
	_ = m.db.WithContext(ctx).
		Model(&model.ShowcaseQuota{}).
		Where("day_key = ? AND scope_key IN ? AND used_count > 0", dayKey, []string{GlobalQuotaScope, ipScope}).
		UpdateColumn("used_count", gorm.Expr("used_count - 1")).Error
}

// CleanupExpiredQuotas 清理 3 天前的历史日配额记录，防止统计表无限增长。
func (m *ShowcaseQuotaManager) CleanupExpiredQuotas(ctx context.Context) error {
	if m == nil || m.db == nil {
		return nil
	}
	cutoffDay := currentDayKey(time.Now().Add(-72 * time.Hour))
	return m.db.WithContext(ctx).Where("day_key < ?", cutoffDay).Delete(&model.ShowcaseQuota{}).Error
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

		// 若请求因前置参数校验或只读模板拦截（400/403/404）未实际消耗大模型算力，自动退还本次预扣额度
		status := c.Writer.Status()
		if status == http.StatusBadRequest || status == http.StatusForbidden || status == http.StatusNotFound {
			rCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			m.Refund(rCtx, clientIP)
			cancel()
		}
	}
}
