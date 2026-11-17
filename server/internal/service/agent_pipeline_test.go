package service

import (
	"testing"

	"archcanvas/internal/domain"
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
