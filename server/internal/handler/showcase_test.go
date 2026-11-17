package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"archcanvas/internal/config"
	"archcanvas/internal/database"
	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/internal/generator"
	"archcanvas/internal/handler"
	"archcanvas/internal/middleware"
	"archcanvas/internal/model"
	"archcanvas/internal/repository"
	"archcanvas/internal/router"
	"archcanvas/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func setupShowcaseRouter(t *testing.T, ipLimit, globalLimit int) (*gin.Engine, *service.ProjectService, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.ReleaseMode)

	dbPath := filepath.Join(t.TempDir(), "showcase_test.db")
	db, err := database.InitSQLite(config.Database{Path: dbPath})
	if err != nil {
		t.Fatalf("InitSQLite failed: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})

	scCfg := config.ShowcaseConfig{
		Enabled:               true,
		IPDailyLimit:          ipLimit,
		GlobalDailyLimit:      globalLimit,
		VisitorTTLHours:       24,
		MaxProjectsPerVisitor: 5,
	}
	scCfg.NormalizeDefaults()

	projRepo := repository.NewProjectRepository(db)
	erRepo := repository.NewERDesignRepository(db)
	msgRepo := repository.NewMessageRepository(db)

	quotaMgr := middleware.NewShowcaseQuotaManager(db, scCfg)
	projSvc := service.NewProjectService(projRepo, erRepo, msgRepo, nil)
	projSvc.SetShowcaseConfig(scCfg)
	if err := projSvc.SeedOfficialShowcaseProjects(context.Background()); err != nil {
		t.Fatalf("SeedOfficialShowcaseProjects failed: %v", err)
	}

	agentSvc := service.NewAgentService(nil, projSvc)
	genSvc, err := generator.NewGeneratorService(projSvc)
	if err != nil {
		t.Fatalf("NewGeneratorService failed: %v", err)
	}

	total := handler.NewTotalHandler(
		handler.NewAgentHandler(agentSvc),
		handler.NewProjectHandler(projSvc).WithQuotaManager(quotaMgr),
		handler.NewGeneratorHandler(genSvc),
		handler.NewHealthHandler(db),
	)
	return router.InitRouterWithShowcase(total, quotaMgr), projSvc, db
}

func doRawShowcase[T any](
	t *testing.T,
	r http.Handler,
	method, path string,
	body any,
	remoteAddr string,
	headers map[string]string,
) (*httptest.ResponseRecorder, apiEnvelope[T]) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body failed: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var env apiEnvelope[T]
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	return w, env
}

func TestShowcaseMode_SeedTemplatesIsolationForkAndSweeper(t *testing.T) {
	r, projSvc, db := setupShowcaseRouter(t, 20, 100)

	// 1. 陌生面试官首次免登录访问：自动签发 X-Visitor-ID，且立即看到 2 个内置官方样板工程
	w1, list1 := doRawShowcase[[]service.ProjectDetail](t, r, http.MethodGet, "/api/v1/projects/list", nil, "104.16.1.1:443", map[string]string{
		"CF-Connecting-IP": "203.0.113.1",
	})
	if w1.Code != http.StatusOK || len(list1.Data) != 2 {
		t.Fatalf("expected 2 official templates on first visit, got code=%d count=%d", w1.Code, len(list1.Data))
	}
	visitorA := w1.Header().Get("X-Visitor-ID")
	if visitorA == "" {
		t.Fatalf("expected X-Visitor-ID response header to be minted")
	}
	if !list1.Data[0].IsTemplate || !list1.Data[1].IsTemplate {
		t.Fatalf("expected both seeded projects to be marked is_template=true")
	}

	// 2. 验证两个内置官方样板工程均包含完整陈氏概念图、物理表与对话，且均能 100% 通过 Go 脚手架代码生成！
	for _, tpl := range list1.Data {
		wDetail, detailEnv := doRawShowcase[service.ProjectDetail](t, r, http.MethodGet, "/api/v1/projects/detail?id="+tpl.ID, nil, "", map[string]string{
			"X-Visitor-ID": visitorA,
		})
		if wDetail.Code != http.StatusOK || detailEnv.Data.ConceptualDesign == nil || len(detailEnv.Data.ConceptualDesign.Concepts) < 5 {
			t.Fatalf("template %s missing conceptual design: code=%d", tpl.Name, wDetail.Code)
		}
		if detailEnv.Data.ERDesign == nil || len(detailEnv.Data.ERDesign.Entities) < 6 {
			t.Fatalf("template %s missing physical entities", tpl.Name)
		}

		wPreview, previewEnv := doRawShowcase[[]generator.GeneratedFile](t, r, http.MethodPost, "/api/v1/generator/preview", dto.GenerateRequest{
			ProjectID:  tpl.ID,
			ModuleName: "github.com/showcase/demo",
			Port:       "8080",
			DBDriver:   "mysql",
		}, "", map[string]string{"X-Visitor-ID": visitorA})
		if wPreview.Code != http.StatusOK || len(previewEnv.Data) < 10 {
			t.Fatalf("template %s scaffold preview failed: code=%d msg=%q", tpl.Name, wPreview.Code, previewEnv.Message)
		}
	}

	// 3. 路人试图删除、重命名、覆写官方样板或清空样板消息：全部被 403 严密拦截
	tplID := service.OfficialTemplateEcommerceID
	for _, op := range []struct {
		path string
		body any
	}{
		{"/api/v1/projects/delete", dto.DeleteProjectReq{ProjectID: tplID}},
		{"/api/v1/projects/update", dto.UpdateProjectReq{ProjectID: tplID, Name: "被恶意篡改"}},
		{"/api/v1/projects/save-er-design", dto.SaveERDesignReq{ProjectID: tplID, Entities: []domain.Entity{}}},
		{"/api/v1/projects/save-conceptual-design", dto.SaveConceptualDesignReq{ProjectID: tplID, Design: domain.ConceptualDesign{}}},
		{"/api/v1/projects/messages/clear", dto.ClearMessagesReq{ProjectID: tplID}},
	} {
		wOp, _ := doRawShowcase[any](t, r, http.MethodPost, op.path, op.body, "", map[string]string{"X-Visitor-ID": visitorA})
		if wOp.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden on %s for official template, got %d", op.path, wOp.Code)
		}
	}

	// 4. 访客 A 一键克隆官方样板到个人沙盒，可自由编辑；访客 B 完全不可见也不可删改访客 A 的副本
	wFork, forkEnv := doRawShowcase[service.ProjectDetail](t, r, http.MethodPost, "/api/v1/projects/fork", dto.ForkProjectReq{
		ProjectID: tplID,
	}, "", map[string]string{"X-Visitor-ID": visitorA})
	if wFork.Code != http.StatusOK || forkEnv.Data.ID == "" || forkEnv.Data.IsTemplate {
		t.Fatalf("fork template failed: code=%d env=%+v", wFork.Code, forkEnv)
	}
	forkedID := forkEnv.Data.ID
	if forkEnv.Data.ERDesign == nil || len(forkEnv.Data.ERDesign.Entities) != 8 {
		t.Fatalf("expected forked project to deep-copy all 8 entities, got %+v", forkEnv.Data.ERDesign)
	}

	// 访客 B 列出项目只能看到 2 个官方样板，读取/删除访客 A 的副本返回 404
	wB, listB := doRawShowcase[[]service.ProjectDetail](t, r, http.MethodGet, "/api/v1/projects/list", nil, "", nil)
	visitorB := wB.Header().Get("X-Visitor-ID")
	if len(listB.Data) != 2 {
		t.Fatalf("visitor B must only see 2 official templates, got %d", len(listB.Data))
	}
	wSteal, _ := doRawShowcase[any](t, r, http.MethodGet, "/api/v1/projects/detail?id="+forkedID, nil, "", map[string]string{"X-Visitor-ID": visitorB})
	if wSteal.Code != http.StatusNotFound {
		t.Fatalf("visitor B reading visitor A project must get 404, got %d", wSteal.Code)
	}
	wDelSteal, _ := doRawShowcase[any](t, r, http.MethodPost, "/api/v1/projects/delete", dto.DeleteProjectReq{ProjectID: forkedID}, "", map[string]string{"X-Visitor-ID": visitorB})
	if wDelSteal.Code != http.StatusNotFound {
		t.Fatalf("visitor B deleting visitor A project must get 404, got %d", wDelSteal.Code)
	}

	// 5. 模拟 25 小时后执行过期自动清扫：访客 A 过期临时副本被清理，2 个官方样板即使时间戳久远也永久保留！
	expiredTime := time.Now().Add(-25 * time.Hour)
	if err := db.Model(&model.Project{}).Where("id IN ?", []string{forkedID, tplID}).Update("updated_at", expiredTime).Error; err != nil {
		t.Fatalf("age updated_at failed: %v", err)
	}
	swept, err := projSvc.SweepExpiredShowcaseProjects(context.Background())
	if err != nil || swept != 1 {
		t.Fatalf("expected sweeper to clean exactly 1 expired visitor project, got swept=%d err=%v", swept, err)
	}

	_, listAfter := doRawShowcase[[]service.ProjectDetail](t, r, http.MethodGet, "/api/v1/projects/list", nil, "", map[string]string{"X-Visitor-ID": visitorA})
	if len(listAfter.Data) != 2 {
		t.Fatalf("expected 2 official templates intact after sweep, got %d", len(listAfter.Data))
	}
}

func TestShowcaseMode_ModelLockdownAndCloudflareRateLimiter(t *testing.T) {
	// 测试阈值设为 单 IP 2 次 / 全站 3 次，快速精确验证双层配额门禁、防伪造 IP 与错误退费
	r, _, _ := setupShowcaseRouter(t, 2, 3)

	// 1. 敏感模型配置与任意探测接口全部返回 403 Forbidden
	wSave, _ := doRawShowcase[any](t, r, http.MethodPost, "/api/v1/models/save", dto.SaveModelReq{
		Provider: "openai",
		Model:    "gpt-4o",
		BaseURL:  "https://attacker.example/v1",
		APIKey:   "sk-hijack",
	}, "", nil)
	if wSave.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on POST /models/save in showcase mode, got %d", wSave.Code)
	}

	wProbe, _ := doRawShowcase[any](t, r, http.MethodPost, "/api/v1/models/probe", dto.GetModelsReq{
		BaseURL: "http://127.0.0.1:6379",
	}, "", nil)
	if wProbe.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on POST /models/probe SSRF attempt, got %d", wProbe.Code)
	}

	wGetProbe, _ := doRawShowcase[any](t, r, http.MethodGet, "/api/v1/models/list?base_url=http://127.0.0.1:11434", nil, "", nil)
	if wGetProbe.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on GET /models/list?base_url=... in showcase mode, got %d", wGetProbe.Code)
	}

	// 2. 先为访客克隆一个可写副本用于测试 /api/v1/agent/*
	wInit, _ := doRawShowcase[[]service.ProjectDetail](t, r, http.MethodGet, "/api/v1/projects/list", nil, "104.16.2.1:443", map[string]string{
		"CF-Connecting-IP": "198.51.100.10",
	})
	vid := wInit.Header().Get("X-Visitor-ID")
	_, forkEnv := doRawShowcase[service.ProjectDetail](t, r, http.MethodPost, "/api/v1/projects/fork", dto.ForkProjectReq{
		ProjectID: service.OfficialTemplateEcommerceID,
	}, "104.16.2.1:443", map[string]string{
		"X-Visitor-ID":     vid,
		"CF-Connecting-IP": "198.51.100.10",
	})
	writableID := forkEnv.Data.ID

	// 2.1 对只读官方模板发起 AI 修改（返回 403）必须自动退还配额，不消耗面试官体验次数！
	wReadonlyAI, _ := doRawShowcase[any](t, r, http.MethodPost, "/api/v1/agent/propose-concepts", dto.ProposeConceptsReq{
		ProjectID: service.OfficialTemplateEcommerceID,
		Input:     "加一张优惠券表",
	}, "104.16.2.1:443", map[string]string{
		"X-Visitor-ID":     vid,
		"CF-Connecting-IP": "198.51.100.10",
	})
	if wReadonlyAI.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when calling propose-concepts on official template, got %d", wReadonlyAI.Code)
	}

	_, statusBefore := doRawShowcase[dto.ShowcaseStatusResp](t, r, http.MethodGet, "/api/v1/showcase/status", nil, "104.16.2.1:443", map[string]string{
		"X-Visitor-ID":     vid,
		"CF-Connecting-IP": "198.51.100.10",
	})
	if statusBefore.Data.IPRemaining != 2 || statusBefore.Data.GlobalRemaining != 3 {
		t.Fatalf("refund failed after 403 pre-check: got %+v", statusBefore.Data)
	}

	// 2.2 访客 IP1 (198.51.100.10 经 Cloudflare 104.16.2.1 转发) 连续调用 2 次成功，第 3 次触发单 IP 429 限流
	for i := 1; i <= 2; i++ {
		wAI, _ := doRawShowcase[any](t, r, http.MethodPost, "/api/v1/agent/review-schema", dto.ReviewSchemaReq{
			ProjectID: writableID,
			Dialect:   "mysql",
		}, "104.16.2.1:443", map[string]string{
			"X-Visitor-ID":     vid,
			"CF-Connecting-IP": "198.51.100.10",
		})
		if wAI.Code != http.StatusOK {
			t.Fatalf("expected 200 on AI call #%d for IP1, got %d", i, wAI.Code)
		}
	}

	wIPBlocked, _ := doRawShowcase[any](t, r, http.MethodPost, "/api/v1/agent/review-schema", dto.ReviewSchemaReq{
		ProjectID: writableID,
	}, "104.16.2.1:443", map[string]string{
		"X-Visitor-ID":     vid,
		"CF-Connecting-IP": "198.51.100.10",
	})
	if wIPBlocked.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 TooManyRequests on #3 call from IP1, got %d", wIPBlocked.Code)
	}

	// 2.3 外部直连攻击者（非受信任代理源 IP 203.0.113.99）每次伪造不同的 CF-Connecting-IP，无法绕过单 IP 限额，且第 3 次全站调用耗尽全局配额后第 4 次触发全局 429！
	wDirect1, _ := doRawShowcase[any](t, r, http.MethodPost, "/api/v1/agent/review-schema", dto.ReviewSchemaReq{
		ProjectID: service.OfficialTemplateRBACID,
	}, "203.0.113.99:55112", map[string]string{
		"CF-Connecting-IP": fmt.Sprintf("1.2.3.%d", 1),
	})
	if wDirect1.Code != http.StatusOK {
		t.Fatalf("expected #3 global call (direct IP) to succeed, got %d", wDirect1.Code)
	}

	wGlobalBlocked, _ := doRawShowcase[any](t, r, http.MethodPost, "/api/v1/agent/review-schema", dto.ReviewSchemaReq{
		ProjectID: service.OfficialTemplateRBACID,
	}, "104.16.2.1:443", map[string]string{
		"CF-Connecting-IP": "198.51.100.88", // 全新真实 IP，但全站每日 3 次总上限已满
	})
	if wGlobalBlocked.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 when global daily limit reached, got %d", wGlobalBlocked.Code)
	}
}
