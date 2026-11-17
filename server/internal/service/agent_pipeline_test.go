package service

import (
	"context"
	"testing"

	"archcanvas/internal/agent"
	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/internal/service/tools"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// TestDerivePhysicalRuleBased_SliceReallocPreservesForeignKeys 验证 [P0-DATA-03] 修复：
// 当关系列表中同时存在 M:N 中间表扩容与后续 1:N / 1:1 关联时，后续实体的外键列与索引绝不因切片扩容悬空而丢失。
func TestDerivePhysicalRuleBased_SliceReallocPreservesForeignKeys(t *testing.T) {
	cd := &domain.ConceptualDesign{
		Summary: "电商多对多与一对多混合模型",
		Concepts: []domain.BusinessConcept{
			{
				ID:          "01900000-0000-7000-8000-000000000001",
				Name:        "User",
				DisplayName: "用户",
				Attributes: []domain.ConceptAttribute{
					{Name: "username", DisplayName: "账号", Category: domain.AttrString, IsBusinessKey: true},
				},
			},
			{
				ID:          "01900000-0000-7000-8000-000000000002",
				Name:        "Role",
				DisplayName: "角色",
				Attributes: []domain.ConceptAttribute{
					{Name: "roleName", DisplayName: "角色名", Category: domain.AttrString, Required: true},
				},
			},
			{
				ID:          "01900000-0000-7000-8000-000000000003",
				Name:        "OrderItem",
				DisplayName: "订单明细",
				Attributes: []domain.ConceptAttribute{
					{Name: "totalAmount", DisplayName: "金额", Category: domain.AttrNumber, Required: true},
				},
			},
		},
		Relations: []domain.ConceptRelation{
			// 先执行 M:N，触发中间表 user_roles 生成
			{SourceConcept: "User", TargetConcept: "Role", Cardinality: domain.CardManyToMany, Name: "拥有"},
			// 后执行 1:N，验证 OrderItem 依然成功注入 user_id 外键与 idx_order_items_user_id 索引
			{SourceConcept: "User", TargetConcept: "OrderItem", Cardinality: domain.CardOneToMany, Name: "下单"},
		},
	}

	er := derivePhysicalRuleBased(DerivePhysicalInput{
		Dialect:          "mysql",
		ConceptualDesign: cd,
	})

	if len(er.Entities) != 4 {
		t.Fatalf("expected 4 entities (users, roles, order_items, user_roles), got %d", len(er.Entities))
	}

	var orderItems *domain.Entity
	for i := range er.Entities {
		if er.Entities[i].Name == "order_items" {
			orderItems = &er.Entities[i]
			break
		}
	}
	if orderItems == nil {
		t.Fatalf("expected plural snake_case table 'order_items', got entities: %+v", er.Entities)
	}

	hasUserID := false
	hasTotalAmountSnake := false
	for _, a := range orderItems.Attributes {
		if a.Name == "user_id" {
			hasUserID = true
		}
		if a.Name == "total_amount" && a.DBType == "DECIMAL(10,2)" {
			hasTotalAmountSnake = true
		}
	}
	if !hasUserID {
		t.Fatalf("CRITICAL regression: user_id FK was lost after M:N slice append! Attributes: %+v", orderItems.Attributes)
	}
	if !hasTotalAmountSnake {
		t.Fatalf("expected snake_case total_amount DECIMAL(10,2), got: %+v", orderItems.Attributes)
	}

	hasFKIndex := false
	for _, idx := range orderItems.Indexes {
		if len(idx.Columns) == 1 && idx.Columns[0] == "user_id" {
			hasFKIndex = true
			break
		}
	}
	if !hasFKIndex {
		t.Fatalf("expected FK index on order_items.user_id, got indexes: %+v", orderItems.Indexes)
	}
}

// TestMergeConceptualDesign_OperationDeleteAndDelta 验证 [P0-DATA-02] 概念增量合并与 OpDelete 语义。
func TestMergeConceptualDesign_OperationDeleteAndDelta(t *testing.T) {
	existing := &domain.ConceptualDesign{
		Summary: "初始概念模型",
		Concepts: []domain.BusinessConcept{
			{ID: "c1", Name: "User", DisplayName: "用户", Position: &domain.Position{X: 100, Y: 200}},
			{ID: "c2", Name: "Order", DisplayName: "订单"},
			{ID: "c3", Name: "Coupon", DisplayName: "优惠券"},
		},
		Relations: []domain.ConceptRelation{
			{ID: "r1", SourceConcept: "User", TargetConcept: "Order", Cardinality: domain.CardOneToMany},
			{ID: "r2", SourceConcept: "Order", TargetConcept: "Coupon", Cardinality: domain.CardOneToOne},
		},
	}

	// 增量操作：删除 Coupon，新增 Invoice，未重复列出 User 与 Order
	incoming := domain.ConceptualDesign{
		Summary: "移除优惠券并新增发票",
		Concepts: []domain.BusinessConcept{
			{Name: "Coupon", Operation: domain.OpDelete},
			{Name: "Invoice", DisplayName: "发票", Operation: domain.OpCreate},
		},
		Relations: []domain.ConceptRelation{
			{SourceConcept: "Order", TargetConcept: "Invoice", Cardinality: domain.CardOneToOne},
		},
	}

	merged := mergeConceptualDesign(existing, incoming)
	names := make(map[string]bool)
	for _, c := range merged.Concepts {
		names[c.Name] = true
	}

	if names["Coupon"] {
		t.Fatalf("expected Coupon with OpDelete to be removed, got concepts: %+v", merged.Concepts)
	}
	if !names["User"] || !names["Order"] || !names["Invoice"] {
		t.Fatalf("expected User, Order preserved and Invoice added, got concepts: %+v", merged.Concepts)
	}
	if len(merged.Relations) != 2 {
		t.Fatalf("expected User->Order preserved, Order->Coupon pruned, Order->Invoice added (2 total), got: %+v", merged.Relations)
	}
}

// TestChat_PreservesConceptualOnClarificationAndForwardsDialect 验证 Stage 2 Divergence #1 修复：
// Chat 统一复用多阶段管线后，在触发澄清时保护已有概念模型不丢失，且正确向下游物理推导传递 req.Dialect（不硬编码覆盖为 mysql）。
func TestChat_PreservesConceptualOnClarificationAndForwardsDialect(t *testing.T) {
	projSvc, _ := setupFileBackedProjectService(t)
	ctx := context.Background()

	proj, err := projSvc.CreateProject(ctx, "Chat 统一管线测试", "")
	if err != nil {
		t.Fatalf("CreateProject failed: %v", err)
	}

	initialConcept := domain.ConceptualDesign{
		Summary: "已有核心概念",
		Concepts: []domain.BusinessConcept{
			{ID: "c_user", Name: "User", DisplayName: "用户"},
			{ID: "c_order", Name: "Order", DisplayName: "订单"},
		},
	}
	if err := projSvc.SaveConceptualDesign(ctx, proj.ID, initialConcept); err != nil {
		t.Fatalf("SaveConceptualDesign failed: %v", err)
	}

	// 第 1 次 Chat：模型返回澄清且未携带新概念 -> 既有概念模型必须完好保留
	clarifyMock := NewMockChatModel(
		[]*schema.Message{
			makeRequirementToolMsg(tools.ProposeRequirementArgs{
				Summary:           "需要进一步确认退款策略",
				NeedClarification: true,
				Questions:         []string{"是否支持部分退款？"},
			}),
		},
	)
	clarifySvc := NewAgentService(&agent.ModelManager{
		CurrentProvider: "mock",
		CurrentName:     "m",
		Cache:           map[string]model.ToolCallingChatModel{"mock:m": clarifyMock},
	}, projSvc)

	ch1, err := clarifySvc.Chat(ctx, dto.ChatReq{
		ProjectID: proj.ID,
		Input:     "增加退款模块但规则待定",
	})
	if err != nil {
		t.Fatalf("Chat (clarify) failed: %v", err)
	}
	for range ch1 {
	}

	afterClarify, err := projSvc.GetConceptualDesign(ctx, proj.ID)
	if err != nil || afterClarify == nil || len(afterClarify.Concepts) != 2 {
		t.Fatalf("expected existing 2 concepts preserved after Chat clarification, got: %+v (err=%v)", afterClarify, err)
	}

	// 第 2 次 Chat：传入 Dialect="postgres"，物理推导回退确定性引擎，验证生成 TIMESTAMPTZ 与 BIGINT（而非硬编码 mysql 的 DATETIME / BIGINT UNSIGNED）
	pgMock := NewMockChatModel(
		[]*schema.Message{
			makeRequirementToolMsg(tools.ProposeRequirementArgs{
				Summary: "新增退款单概念",
				Concepts: []domain.BusinessConcept{
					{Name: "Refund", DisplayName: "退款单", Operation: domain.OpCreate, Attributes: []domain.ConceptAttribute{
						{Name: "amount", DisplayName: "退款金额", Category: domain.AttrNumber, Required: true},
					}},
				},
				NeedClarification: false,
			}),
		},
		// 后续物理阶段让 mock 返回空文本，触发带 Dialect 的确定性推导引擎以便精确断言方言透传
		[]*schema.Message{schema.AssistantMessage("fallback", nil)},
		[]*schema.Message{schema.AssistantMessage("fallback", nil)},
		[]*schema.Message{schema.AssistantMessage("fallback", nil)},
	)
	pgSvc := NewAgentService(&agent.ModelManager{
		CurrentProvider: "mock",
		CurrentName:     "m",
		Cache:           map[string]model.ToolCallingChatModel{"mock:m": pgMock},
	}, projSvc)

	ch2, err := pgSvc.Chat(ctx, dto.ChatReq{
		ProjectID: proj.ID,
		Input:     "确认支持全额与部分退款，新增退款单实体",
		Dialect:   "postgres",
	})
	if err != nil {
		t.Fatalf("Chat (postgres) failed: %v", err)
	}
	var gotResult *domain.ERDesign
	for evt := range ch2 {
		if evt.Type == EventResult {
			if d, ok := evt.Data.(*domain.ERDesign); ok {
				gotResult = d
			}
		}
	}
	if gotResult == nil {
		t.Fatal("expected ERDesign result from Chat")
	}

	var refundsEnt *domain.Entity
	for i := range gotResult.Entities {
		if gotResult.Entities[i].Name == "refunds" {
			refundsEnt = &gotResult.Entities[i]
			break
		}
	}
	if refundsEnt == nil {
		t.Fatalf("expected 'refunds' entity, got: %+v", gotResult.Entities)
	}
	var sawNumeric, sawTimestamptz bool
	for _, a := range refundsEnt.Attributes {
		if a.Name == "amount" && a.DBType == "NUMERIC(10,2)" {
			sawNumeric = true
		}
		if a.Name == "created_at" && a.DBType == "TIMESTAMPTZ" {
			sawTimestamptz = true
		}
	}
	if !sawNumeric || !sawTimestamptz {
		t.Fatalf("expected postgres dialect types (NUMERIC(10,2) & TIMESTAMPTZ) forwarded in Chat, got attributes: %+v", refundsEnt.Attributes)
	}
}
