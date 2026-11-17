package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"archcanvas/internal/config"
	"archcanvas/internal/database"
	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/internal/generator"
	"archcanvas/internal/handler"
	"archcanvas/internal/repository"
	"archcanvas/internal/router"
	"archcanvas/internal/service"

	"github.com/gin-gonic/gin"
)

type apiEnvelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
	TraceID string `json:"trace_id"`
}

func setupTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.ReleaseMode)

	dbPath := filepath.Join(t.TempDir(), "handler_test.db")
	db, err := database.InitSQLite(config.Database{Path: dbPath})
	if err != nil {
		t.Fatalf("InitSQLite failed: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})

	projRepo := repository.NewProjectRepository(db)
	erRepo := repository.NewERDesignRepository(db)
	msgRepo := repository.NewMessageRepository(db)

	projSvc := service.NewProjectService(projRepo, erRepo, msgRepo, nil)
	agentSvc := service.NewAgentService(nil, projSvc)
	genSvc, err := generator.NewGeneratorService(projSvc)
	if err != nil {
		t.Fatalf("NewGeneratorService failed: %v", err)
	}

	total := handler.NewTotalHandler(
		handler.NewAgentHandler(agentSvc),
		handler.NewProjectHandler(projSvc),
		handler.NewGeneratorHandler(genSvc),
		handler.NewHealthHandler(db),
	)
	return router.InitRouter(total)
}

func doJSON[T any](t *testing.T, r http.Handler, method, path string, body any, headers map[string]string) (int, apiEnvelope[T]) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body failed: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
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
	return w.Code, env
}

func TestProjectHandler_FullLifecycleAndSecurityGates(t *testing.T) {
	r := setupTestRouter(t)

	// 1. Healthz 正常返回 200 (status=ok, database=connected) 且响应头注入 X-Trace-ID
	healthReq := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	healthRec := httptest.NewRecorder()
	r.ServeHTTP(healthRec, healthReq)
	var healthBody handler.HealthResponse
	_ = json.Unmarshal(healthRec.Body.Bytes(), &healthBody)
	if healthRec.Code != http.StatusOK || healthBody.Database != "connected" || healthRec.Header().Get("X-Trace-ID") == "" {
		t.Fatalf("expected 200 healthz with X-Trace-ID, got status=%d body=%+v", healthRec.Code, healthBody)
	}

	// 2. 创建项目 A 与项目 B
	status, createA := doJSON[service.ProjectDetail](t, r, http.MethodPost, "/api/v1/projects/create", dto.CreateProjectReq{
		Name:        "电商核心项目",
		Description: "包含用户与订单模块",
	}, nil)
	if status != http.StatusOK || createA.Data.ID == "" || createA.TraceID == "" {
		t.Fatalf("create project A failed: status=%d env=%+v", status, createA)
	}
	projAID := createA.Data.ID

	status, createB := doJSON[service.ProjectDetail](t, r, http.MethodPost, "/api/v1/projects/create", dto.CreateProjectReq{
		Name:        "跨境分仓项目",
		Description: "测试跨项目 UUID 导入隔离",
	}, nil)
	if status != http.StatusOK || createB.Data.ID == "" {
		t.Fatalf("create project B failed: status=%d env=%+v", status, createB)
	}
	projBID := createB.Data.ID

	// 3. 保存 ER 设计（含特定属性顺序 z_field -> a_field -> m_field）并验证字段顺序保真
	status, saveA := doJSON[service.SaveERDesignResult](t, r, http.MethodPost, "/api/v1/projects/save-er-design", dto.SaveERDesignReq{
		ProjectID: projAID,
		Entities: []domain.Entity{
			{
				Name:    "users",
				Comment: "用户表",
				Attributes: []domain.Attribute{
					{Name: "id", DBType: "BIGINT", CodeType: "uint64", IsPrimaryKey: true},
					{Name: "z_nickname", DBType: "VARCHAR(64)", CodeType: "string"},
					{Name: "a_email", DBType: "VARCHAR(128)", CodeType: "string", IsUnique: true},
					{Name: "m_phone", DBType: "VARCHAR(32)", CodeType: "string"},
				},
			},
		},
		Relations: []domain.Relation{},
	}, nil)
	if status != http.StatusOK || saveA.Data.Design == nil || len(saveA.Data.Design.Entities) != 1 {
		t.Fatalf("save ER design A failed: status=%d env=%+v", status, saveA)
	}

	status, getERA := doJSON[domain.ERDesign](t, r, http.MethodGet, "/api/v1/projects/get-er-design?id="+projAID, nil, nil)
	if status != http.StatusOK {
		t.Fatalf("get ER design A failed: %d", status)
	}
	gotAttrs := getERA.Data.Entities[0].Attributes
	wantOrder := []string{"id", "z_nickname", "a_email", "m_phone"}
	for idx, wantName := range wantOrder {
		if gotAttrs[idx].Name != wantName {
			t.Fatalf("attribute sort_order lost at index %d: got %q, want %q", idx, gotAttrs[idx].Name, wantName)
		}
	}

	// 4. [P0-DATA-01] 将项目 A 的完整带 UUID 设计原样导入项目 B，不得发生全局主键冲突 500
	status, saveB := doJSON[service.SaveERDesignResult](t, r, http.MethodPost, "/api/v1/projects/save-er-design", dto.SaveERDesignReq{
		ProjectID: projBID,
		Entities:  getERA.Data.Entities,
		Relations: getERA.Data.Relations,
	}, nil)
	if status != http.StatusOK || saveB.Data.Design == nil {
		t.Fatalf("cross-project UUID import into project B failed with status=%d msg=%q", status, saveB.Message)
	}
	if saveB.Data.Design.Entities[0].ID == getERA.Data.Entities[0].ID {
		t.Fatalf("cross-project import must re-mint entity UUID to isolate projects")
	}

	// 5. 保存与读取概念模型（陈氏 ER）
	cd := domain.ConceptualDesign{
		Summary: "电商概念模型",
		Concepts: []domain.BusinessConcept{
			{
				ID:          "c_user",
				Name:        "User",
				DisplayName: "用户",
				Attributes:  []domain.ConceptAttribute{{Name: "id", Category: domain.AttrString, IsBusinessKey: true}},
			},
		},
		Relations: []domain.ConceptRelation{},
	}
	status, _ = doJSON[any](t, r, http.MethodPost, "/api/v1/projects/save-conceptual-design", dto.SaveConceptualDesignReq{
		ProjectID: projAID,
		Design:    cd,
	}, nil)
	if status != http.StatusOK {
		t.Fatalf("save conceptual design failed: %d", status)
	}
	status, gotCD := doJSON[domain.ConceptualDesign](t, r, http.MethodGet, "/api/v1/projects/get-conceptual-design?id="+projAID, nil, nil)
	if status != http.StatusOK || len(gotCD.Data.Concepts) != 1 || gotCD.Data.Concepts[0].DisplayName != "用户" {
		t.Fatalf("get conceptual design mismatch: status=%d data=%+v", status, gotCD.Data)
	}

	// 6. 重命名不传 description 时保留原描述
	status, upd := doJSON[service.ProjectDetail](t, r, http.MethodPost, "/api/v1/projects/update", map[string]any{
		"project_id": projAID,
		"name":       "电商核心项目 V2",
	}, nil)
	if status != http.StatusOK || upd.Data.Description != "包含用户与订单模块" {
		t.Fatalf("update project lost description: status=%d data=%+v", status, upd.Data)
	}

	// 7. 对话历史获取与清空 + 不存在项目精确返回 404
	status, msgs := doJSON[[]service.MessageItem](t, r, http.MethodGet, "/api/v1/projects/messages?project_id="+projAID, nil, nil)
	if status != http.StatusOK || len(msgs.Data) != 0 {
		t.Fatalf("list messages failed: status=%d", status)
	}
	status, _ = doJSON[map[string]any](t, r, http.MethodPost, "/api/v1/projects/messages/clear", dto.ClearMessagesReq{ProjectID: projAID}, nil)
	if status != http.StatusOK {
		t.Fatalf("clear messages failed: status=%d", status)
	}

	status, _ = doJSON[any](t, r, http.MethodGet, "/api/v1/projects/detail?id=non-existent-id", nil, nil)
	if status != http.StatusNotFound {
		t.Fatalf("expected 404 for missing project detail, got %d", status)
	}

	// 8. 删除项目后列表仅剩项目 B
	status, _ = doJSON[any](t, r, http.MethodPost, "/api/v1/projects/delete", dto.DeleteProjectReq{ProjectID: projAID}, nil)
	if status != http.StatusOK {
		t.Fatalf("delete project A failed: %d", status)
	}
	status, listEnv := doJSON[[]service.ProjectDetail](t, r, http.MethodGet, "/api/v1/projects/list", nil, nil)
	if status != http.StatusOK || len(listEnv.Data) != 1 || listEnv.Data[0].ID != projBID {
		t.Fatalf("expected only project B remaining, got %+v", listEnv.Data)
	}
}

func TestProjectHandler_OptionalTokenAuthGate(t *testing.T) {
	t.Setenv("ARCHCANVAS_AUTH_TOKEN", "top-secret-arch-token")
	r := setupTestRouter(t)

	// /healthz 探针免鉴权放行
	healthReq := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	healthRec := httptest.NewRecorder()
	r.ServeHTTP(healthRec, healthReq)
	if healthRec.Code != http.StatusOK {
		t.Fatalf("expected /healthz exempt from token auth, got %d", healthRec.Code)
	}

	// 未带令牌访问业务 API 必须返回 401
	unauthStatus, _ := doJSON[any](t, r, http.MethodGet, "/api/v1/projects/list", nil, nil)
	if unauthStatus != http.StatusUnauthorized {
		t.Fatalf("expected 401 when ARCHCANVAS_AUTH_TOKEN set and header missing, got %d", unauthStatus)
	}

	// 携带合法 Bearer 令牌返回 200
	authStatus, _ := doJSON[[]service.ProjectDetail](t, r, http.MethodGet, "/api/v1/projects/list", nil, map[string]string{
		"Authorization": "Bearer top-secret-arch-token",
	})
	if authStatus != http.StatusOK {
		t.Fatalf("expected 200 with valid Bearer token, got %d", authStatus)
	}
}

func TestHealthHandler_NilDBReturns503(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	h := handler.NewHealthHandler(nil)
	r.GET("/healthz", h.Check)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when db is nil, got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "disconnected") {
		t.Fatalf("expected disconnected status in body, got %s", w.Body.String())
	}
}
