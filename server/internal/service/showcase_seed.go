package service

import (
	"context"
	"encoding/json"
	"fmt"

	"archcanvas/internal/domain"
	"archcanvas/internal/middleware"
	"archcanvas/internal/model"
)

const (
	OfficialTemplateEcommerceID = "01960000-0000-7000-8000-000000000001"
	OfficialTemplateRBACID      = "01960000-0000-7000-8000-000000000002"
)

type officialTemplateSpec struct {
	ID          string
	Order       int
	Name        string
	Description string
	Conceptual  domain.ConceptualDesign
	Physical    domain.ERDesign
	UserPrompt  string
	AssistantMD string
}

// SeedOfficialShowcaseProjects 幂等初始化或自愈内置的 2 个只读官方样板工程，保证公开演示环境开屏即呈现完整双视图架构。
func (s *ProjectService) SeedOfficialShowcaseProjects(ctx context.Context) error {
	if s == nil || s.ProjectRepo == nil || s.ERDesignRepo == nil {
		return nil
	}

	specs := []officialTemplateSpec{
		buildEcommerceShowcaseSpec(),
		buildRBACShowcaseSpec(),
	}

	for _, spec := range specs {
		cdBytes, err := json.Marshal(spec.Conceptual)
		if err != nil {
			return fmt.Errorf("marshal conceptual template %s: %w", spec.Name, err)
		}

		proj := model.Project{
			ID:               spec.ID,
			Name:             spec.Name,
			Description:      spec.Description,
			VisitorID:        middleware.OfficialVisitorID,
			IsTemplate:       true,
			TemplateOrder:    spec.Order,
			ConceptualDesign: string(cdBytes),
		}
		if err := s.ProjectRepo.UpsertTemplateProject(ctx, proj); err != nil {
			return fmt.Errorf("upsert template project %s: %w", spec.Name, err)
		}

		if _, err := s.ERDesignRepo.SaveByProjectID(ctx, spec.ID, spec.Physical.Entities, spec.Physical.Relations); err != nil {
			return fmt.Errorf("seed physical design for %s: %w", spec.Name, err)
		}

		if s.MessageRepo != nil {
			existingMsgs, _ := s.MessageRepo.ListMessagesByProject(ctx, spec.ID)
			if len(existingMsgs) == 0 {
				if conv, err := s.MessageRepo.GetOrCreateConversation(ctx, spec.ID); err == nil && conv != nil {
					_, _ = s.MessageRepo.CreateMessage(ctx, conv.ID, "user", spec.UserPrompt)
					_, _ = s.MessageRepo.CreateMessage(ctx, conv.ID, "assistant", spec.AssistantMD)
				}
			}
		}
	}

	return nil
}

func pos(x, y float64) *domain.Position {
	return &domain.Position{X: x, Y: y}
}

func buildEcommerceShowcaseSpec() officialTemplateSpec {
	const (
		uID  = "01960001-0000-7000-8000-000000000101"
		cID  = "01960001-0000-7000-8000-000000000102"
		pID  = "01960001-0000-7000-8000-000000000103"
		tID  = "01960001-0000-7000-8000-000000000104"
		ptID = "01960001-0000-7000-8000-000000000105"
		oID  = "01960001-0000-7000-8000-000000000106"
		oiID = "01960001-0000-7000-8000-000000000107"
		pay  = "01960001-0000-7000-8000-000000000108"
	)

	isJunctionTrue := true
	isJunctionFalse := false

	conceptual := domain.ConceptualDesign{
		Summary: "面向高并发在线零售场景的核心交易与履约域模型，完整覆盖多级商品类目树、SPU/SKU 价格库存、营销多对多标签、订单快照留痕及幂等支付流水。",
		Concepts: []domain.BusinessConcept{
			{
				ID:          "concept_user",
				Name:        "User",
				DisplayName: "买家用户",
				Description: "商城注册会员与收货主体",
				Attributes: []domain.ConceptAttribute{
					{ID: "cu_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "cu_2", Name: "nickname", DisplayName: "昵称", Category: domain.AttrString, Required: true},
					{ID: "cu_3", Name: "phone", DisplayName: "手机号", Category: domain.AttrString, Required: true, IsUnique: true},
					{ID: "cu_4", Name: "member_level", DisplayName: "会员等级", Category: domain.AttrEnum, Required: true},
				},
			},
			{
				ID:          "concept_category",
				Name:        "Category",
				DisplayName: "商品类目",
				Description: "支持无限级树形折叠的商品目录分类",
				Attributes: []domain.ConceptAttribute{
					{ID: "cc_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "cc_2", Name: "name", DisplayName: "类目名称", Category: domain.AttrString, Required: true},
					{ID: "cc_3", Name: "sort_weight", DisplayName: "排序权重", Category: domain.AttrNumber, Required: true},
				},
			},
			{
				ID:          "concept_product",
				Name:        "Product",
				DisplayName: "商城商品",
				Description: "在售可交易标准商品单元",
				Attributes: []domain.ConceptAttribute{
					{ID: "cp_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "cp_2", Name: "sku_code", DisplayName: "商品编码", Category: domain.AttrString, Required: true, IsUnique: true},
					{ID: "cp_3", Name: "title", DisplayName: "商品标题", Category: domain.AttrString, Required: true},
					{ID: "cp_4", Name: "sale_price", DisplayName: "销售单价", Category: domain.AttrNumber, Required: true},
					{ID: "cp_5", Name: "stock_qty", DisplayName: "可用库存", Category: domain.AttrNumber, Required: true},
				},
			},
			{
				ID:          "concept_tag",
				Name:        "Tag",
				DisplayName: "营销标签",
				Description: "活动会场与检索导购标签",
				Attributes: []domain.ConceptAttribute{
					{ID: "ct_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "ct_2", Name: "tag_name", DisplayName: "标签名", Category: domain.AttrString, Required: true, IsUnique: true},
				},
			},
			{
				ID:          "concept_order",
				Name:        "Order",
				DisplayName: "交易订单",
				Description: "买家下单履约主单据",
				Attributes: []domain.ConceptAttribute{
					{ID: "co_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "co_2", Name: "order_no", DisplayName: "订单号", Category: domain.AttrString, Required: true, IsUnique: true},
					{ID: "co_3", Name: "payable_amount", DisplayName: "实付金额", Category: domain.AttrNumber, Required: true},
					{ID: "co_4", Name: "order_status", DisplayName: "履约状态", Category: domain.AttrEnum, Required: true},
				},
			},
			{
				ID:          "concept_order_item",
				Name:        "OrderItem",
				DisplayName: "订单明细",
				Description: "承载下单瞬时价格与购买数量的关联业务实体",
				Attributes: []domain.ConceptAttribute{
					{ID: "coi_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "coi_2", Name: "unit_price", DisplayName: "成交单价", Category: domain.AttrNumber, Required: true},
					{ID: "coi_3", Name: "quantity", DisplayName: "购买数量", Category: domain.AttrNumber, Required: true},
				},
			},
			{
				ID:          "concept_payment",
				Name:        "Payment",
				DisplayName: "支付流水",
				Description: "三方收银台交易凭证与回调幂等记录",
				Attributes: []domain.ConceptAttribute{
					{ID: "cpay_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "cpay_2", Name: "out_trade_no", DisplayName: "支付单号", Category: domain.AttrString, Required: true, IsUnique: true},
					{ID: "cpay_3", Name: "channel", DisplayName: "支付渠道", Category: domain.AttrEnum, Required: true},
					{ID: "cpay_4", Name: "paid_at", DisplayName: "支付时间", Category: domain.AttrDateTime},
				},
			},
		},
		Relations: []domain.ConceptRelation{
			{ID: "crel_cat_self", Name: "父子类目", SourceConcept: "Category", TargetConcept: "Category", Cardinality: domain.CardOneToMany},
			{ID: "crel_cat_prod", Name: "归属类目", SourceConcept: "Category", TargetConcept: "Product", Cardinality: domain.CardOneToMany},
			{ID: "crel_prod_tag", Name: "打标签", SourceConcept: "Product", TargetConcept: "Tag", Cardinality: domain.CardManyToMany},
			{ID: "crel_user_ord", Name: "发起下单", SourceConcept: "User", TargetConcept: "Order", Cardinality: domain.CardOneToMany},
			{ID: "crel_ord_item", Name: "包含明细", SourceConcept: "Order", TargetConcept: "OrderItem", Cardinality: domain.CardOneToMany},
			{ID: "crel_prod_item", Name: "选购商品", SourceConcept: "Product", TargetConcept: "OrderItem", Cardinality: domain.CardOneToMany},
			{ID: "crel_ord_pay", Name: "支付结算", SourceConcept: "Order", TargetConcept: "Payment", Cardinality: domain.CardOneToOne},
		},
	}

	physical := domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:       uID,
				Name:     "users",
				Comment:  "买家用户",
				Position: pos(80, 60),
				Attributes: []domain.Attribute{
					{ID: "01960001-0001-7000-8000-000000000001", Name: "id", Comment: "用户主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "用户主键"},
					{ID: "01960001-0001-7000-8000-000000000002", Name: "nickname", Comment: "用户昵称", DBType: "VARCHAR(64)", CodeType: "string", Description: "用户昵称"},
					{ID: "01960001-0001-7000-8000-000000000003", Name: "phone", Comment: "绑定手机号", DBType: "VARCHAR(20)", CodeType: "string", IsUnique: true, Description: "绑定手机号"},
					{ID: "01960001-0001-7000-8000-000000000004", Name: "member_level", Comment: "会员等级", DBType: "VARCHAR(16)", CodeType: "string", Description: "会员等级"},
					{ID: "01960001-0001-7000-8000-000000000005", Name: "created_at", Comment: "注册时间", DBType: "DATETIME", CodeType: "time.Time", Description: "注册时间"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_users_phone", Columns: []string{"phone"}, IsUnique: true, Comment: "手机号唯一索引"},
				},
			},
			{
				ID:       cID,
				Name:     "categories",
				Comment:  "商品类目",
				Position: pos(80, 380),
				Attributes: []domain.Attribute{
					{ID: "01960001-0002-7000-8000-000000000001", Name: "id", Comment: "类目主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "类目主键"},
					{ID: "01960001-0002-7000-8000-000000000002", Name: "parent_id", Comment: "父级类目ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsNullable: true, Description: "父级类目ID"},
					{ID: "01960001-0002-7000-8000-000000000003", Name: "name", Comment: "类目名称", DBType: "VARCHAR(64)", CodeType: "string", Description: "类目名称"},
					{ID: "01960001-0002-7000-8000-000000000004", Name: "sort_weight", Comment: "排序权重", DBType: "INT", CodeType: "int", Description: "排序权重"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "idx_categories_parent_id", Columns: []string{"parent_id"}, Comment: "子类目树查询索引"},
				},
			},
			{
				ID:       pID,
				Name:     "products",
				Comment:  "商城商品",
				Position: pos(440, 380),
				Attributes: []domain.Attribute{
					{ID: "01960001-0003-7000-8000-000000000001", Name: "id", Comment: "商品主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "商品主键"},
					{ID: "01960001-0003-7000-8000-000000000002", Name: "category_id", Comment: "所属类目ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "所属类目ID"},
					{ID: "01960001-0003-7000-8000-000000000003", Name: "sku_code", Comment: "商品编码", DBType: "VARCHAR(64)", CodeType: "string", IsUnique: true, Description: "商品编码"},
					{ID: "01960001-0003-7000-8000-000000000004", Name: "title", Comment: "商品标题", DBType: "VARCHAR(128)", CodeType: "string", Description: "商品标题"},
					{ID: "01960001-0003-7000-8000-000000000005", Name: "sale_price", Comment: "销售单价", DBType: "DECIMAL(12,2)", CodeType: "float64", Description: "销售单价"},
					{ID: "01960001-0003-7000-8000-000000000006", Name: "stock_qty", Comment: "可用库存", DBType: "INT", CodeType: "int", Description: "可用库存"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "idx_products_category_id", Columns: []string{"category_id"}, Comment: "类目商品列表索引"},
					{Name: "uk_products_sku_code", Columns: []string{"sku_code"}, IsUnique: true, Comment: "SKU编码唯一索引"},
				},
			},
			{
				ID:       oID,
				Name:     "orders",
				Comment:  "交易订单",
				Position: pos(440, 60),
				Attributes: []domain.Attribute{
					{ID: "01960001-0004-7000-8000-000000000001", Name: "id", Comment: "订单主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "订单主键"},
					{ID: "01960001-0004-7000-8000-000000000002", Name: "order_no", Comment: "业务订单号", DBType: "VARCHAR(64)", CodeType: "string", IsUnique: true, Description: "业务订单号"},
					{ID: "01960001-0004-7000-8000-000000000003", Name: "user_id", Comment: "下单买家ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "下单买家ID"},
					{ID: "01960001-0004-7000-8000-000000000004", Name: "payable_amount", Comment: "应付总金额", DBType: "DECIMAL(12,2)", CodeType: "float64", Description: "应付总金额"},
					{ID: "01960001-0004-7000-8000-000000000005", Name: "order_status", Comment: "订单履约状态", DBType: "VARCHAR(24)", CodeType: "string", Description: "订单履约状态"},
					{ID: "01960001-0004-7000-8000-000000000006", Name: "created_at", Comment: "下单时间", DBType: "DATETIME", CodeType: "time.Time", Description: "下单时间"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_orders_order_no", Columns: []string{"order_no"}, IsUnique: true, Comment: "订单号唯一索引"},
					{Name: "idx_orders_user_status", Columns: []string{"user_id", "order_status"}, Comment: "买家订单状态联合检索索引"},
				},
			},
			{
				ID:              oiID,
				Name:            "order_items",
				Comment:         "订单明细",
				Position:        pos(820, 210),
				IsJunctionTable: &isJunctionFalse,
				Attributes: []domain.Attribute{
					{ID: "01960001-0005-7000-8000-000000000001", Name: "id", Comment: "明细主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "明细主键"},
					{ID: "01960001-0005-7000-8000-000000000002", Name: "order_id", Comment: "所属订单ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "所属订单ID"},
					{ID: "01960001-0005-7000-8000-000000000003", Name: "product_id", Comment: "关联商品ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "关联商品ID"},
					{ID: "01960001-0005-7000-8000-000000000004", Name: "product_title", Comment: "商品名称快照", DBType: "VARCHAR(128)", CodeType: "string", Description: "商品名称快照"},
					{ID: "01960001-0005-7000-8000-000000000005", Name: "unit_price", Comment: "成交单价快照", DBType: "DECIMAL(12,2)", CodeType: "float64", Description: "成交单价快照"},
					{ID: "01960001-0005-7000-8000-000000000006", Name: "quantity", Comment: "购买数量", DBType: "INT", CodeType: "int", Description: "购买数量"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "idx_order_items_order_id", Columns: []string{"order_id"}, Comment: "订单查明细索引"},
					{Name: "idx_order_items_product_id", Columns: []string{"product_id"}, Comment: "商品销量统计索引"},
				},
			},
			{
				ID:       pay,
				Name:     "payments",
				Comment:  "支付流水",
				Position: pos(820, 20),
				Attributes: []domain.Attribute{
					{ID: "01960001-0006-7000-8000-000000000001", Name: "id", Comment: "支付主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "支付主键"},
					{ID: "01960001-0006-7000-8000-000000000002", Name: "order_id", Comment: "关联订单ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsUnique: true, Description: "关联订单ID"},
					{ID: "01960001-0006-7000-8000-000000000003", Name: "out_trade_no", Comment: "外部支付单号", DBType: "VARCHAR(64)", CodeType: "string", IsUnique: true, Description: "外部支付单号"},
					{ID: "01960001-0006-7000-8000-000000000004", Name: "channel", Comment: "支付渠道", DBType: "VARCHAR(24)", CodeType: "string", Description: "支付渠道"},
					{ID: "01960001-0006-7000-8000-000000000005", Name: "paid_at", Comment: "支付完成时间", DBType: "DATETIME", CodeType: "time.Time", IsNullable: true, Description: "支付完成时间"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_payments_order_id", Columns: []string{"order_id"}, IsUnique: true, Comment: "单笔订单唯一有效支付"},
					{Name: "uk_payments_out_trade_no", Columns: []string{"out_trade_no"}, IsUnique: true, Comment: "外部支付单号幂等索引"},
				},
			},
			{
				ID:              ptID,
				Name:            "product_tags",
				Comment:         "打标签",
				Position:        pos(820, 480),
				IsJunctionTable: &isJunctionTrue,
				Attributes: []domain.Attribute{
					{ID: "01960001-0007-7000-8000-000000000001", Name: "id", Comment: "映射主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "映射主键"},
					{ID: "01960001-0007-7000-8000-000000000002", Name: "product_id", Comment: "商品ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "商品ID"},
					{ID: "01960001-0007-7000-8000-000000000003", Name: "tag_id", Comment: "标签ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "标签ID"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_product_tags_pair", Columns: []string{"product_id", "tag_id"}, IsUnique: true, Comment: "商品标签联合唯一索引"},
				},
			},
			{
				ID:       tID,
				Name:     "tags",
				Comment:  "营销标签",
				Position: pos(1160, 480),
				Attributes: []domain.Attribute{
					{ID: "01960001-0008-7000-8000-000000000001", Name: "id", Comment: "标签主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "标签主键"},
					{ID: "01960001-0008-7000-8000-000000000002", Name: "tag_name", Comment: "标签名称", DBType: "VARCHAR(32)", CodeType: "string", IsUnique: true, Description: "标签名称"},
				},
			},
		},
		Relations: []domain.Relation{
			{ID: "01960001-0099-7000-8000-000000000001", SourceEntityID: cID, TargetEntityID: cID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960001-0099-7000-8000-000000000002", SourceEntityID: cID, TargetEntityID: pID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960001-0099-7000-8000-000000000003", SourceEntityID: uID, TargetEntityID: oID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960001-0099-7000-8000-000000000004", SourceEntityID: oID, TargetEntityID: oiID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960001-0099-7000-8000-000000000005", SourceEntityID: pID, TargetEntityID: oiID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960001-0099-7000-8000-000000000006", SourceEntityID: oID, TargetEntityID: pay, Cardinality: "one_to_one", RelationTypeID: "one_to_one"},
			{ID: "01960001-0099-7000-8000-000000000007", SourceEntityID: pID, TargetEntityID: ptID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960001-0099-7000-8000-000000000008", SourceEntityID: tID, TargetEntityID: ptID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
		},
	}

	assistantJSON, _ := json.Marshal(map[string]any{
		"stage":   "physical_derived",
		"summary": "已完成电商交易履约系统的概念建模与物理表工程化推导：1) 类目采用 parent_id 自引用树；2) 商品与营销标签通过纯技术联结表 product_tags 实现多对多并在陈氏视图中自动升华为菱形联系；3) 订单明细 order_items 承载成交单价快照与数量，作为独立关联实体完整保留。",
		"entities": []string{
			"users", "categories", "products", "tags", "product_tags", "orders", "order_items", "payments",
		},
	})

	return officialTemplateSpec{
		ID:          OfficialTemplateEcommerceID,
		Order:       1,
		Name:        "电商交易履约系统",
		Description: "官方精选样板 · 涵盖买家、多级类目自环树、商品标签 M:N 菱形折叠、交易主单、价格快照关联实体与幂等支付流水",
		Conceptual:  conceptual,
		Physical:    physical,
		UserPrompt:  "设计一套标准在线电商交易履约系统，支持多级商品类目树、商品与营销标签多对多关联、买家下单（保留历史成交价快照）以及三方支付流水幂等对账。",
		AssistantMD: string(assistantJSON),
	}
}

func buildRBACShowcaseSpec() officialTemplateSpec {
	const (
		tenID  = "01960002-0000-7000-8000-000000000201"
		deptID = "01960002-0000-7000-8000-000000000202"
		memID  = "01960002-0000-7000-8000-000000000203"
		roleID = "01960002-0000-7000-8000-000000000204"
		permID = "01960002-0000-7000-8000-000000000205"
		mrID   = "01960002-0000-7000-8000-000000000206"
		rpID   = "01960002-0000-7000-8000-000000000207"
		logID  = "01960002-0000-7000-8000-000000000208"
	)

	isJunctionTrue := true

	conceptual := domain.ConceptualDesign{
		Summary: "企业级 SaaS 多租户组织架构与 RBAC 细粒度访问控制模型，采用租户级逻辑隔离 + 树形组织部门 + 成员/角色/权限双多对多矩阵及全链路安全审计日志。",
		Concepts: []domain.BusinessConcept{
			{
				ID:          "concept_tenant",
				Name:        "Tenant",
				DisplayName: "企业租户",
				Description: "SaaS 独立签约企业空间与配额主体",
				Attributes: []domain.ConceptAttribute{
					{ID: "rt_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "rt_2", Name: "tenant_code", DisplayName: "租户编码", Category: domain.AttrString, Required: true, IsUnique: true},
					{ID: "rt_3", Name: "company_name", DisplayName: "企业名称", Category: domain.AttrString, Required: true},
					{ID: "rt_4", Name: "plan_tier", DisplayName: "订阅套餐", Category: domain.AttrEnum, Required: true},
				},
			},
			{
				ID:          "concept_department",
				Name:        "Department",
				DisplayName: "组织部门",
				Description: "企业内部多层级组织架构单元",
				Attributes: []domain.ConceptAttribute{
					{ID: "rd_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "rd_2", Name: "dept_name", DisplayName: "部门名称", Category: domain.AttrString, Required: true},
				},
			},
			{
				ID:          "concept_member",
				Name:        "Member",
				DisplayName: "企业成员",
				Description: "归属租户与部门的员工账号主体",
				Attributes: []domain.ConceptAttribute{
					{ID: "rm_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "rm_2", Name: "email", DisplayName: "企业邮箱", Category: domain.AttrString, Required: true, IsUnique: true},
					{ID: "rm_3", Name: "display_name", DisplayName: "姓名", Category: domain.AttrString, Required: true},
					{ID: "rm_4", Name: "status", DisplayName: "在职状态", Category: domain.AttrEnum, Required: true},
				},
			},
			{
				ID:          "concept_role",
				Name:        "Role",
				DisplayName: "业务角色",
				Description: "租户内可配置岗位职责角色",
				Attributes: []domain.ConceptAttribute{
					{ID: "rr_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "rr_2", Name: "role_key", DisplayName: "角色标识", Category: domain.AttrString, Required: true},
					{ID: "rr_3", Name: "role_name", DisplayName: "角色名称", Category: domain.AttrString, Required: true},
				},
			},
			{
				ID:          "concept_permission",
				Name:        "Permission",
				DisplayName: "资源权限",
				Description: "菜单路由与 API 操作细粒度权限点",
				Attributes: []domain.ConceptAttribute{
					{ID: "rp_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "rp_2", Name: "perm_code", DisplayName: "权限编码", Category: domain.AttrString, Required: true, IsUnique: true},
					{ID: "rp_3", Name: "resource_type", DisplayName: "资源类型", Category: domain.AttrEnum, Required: true},
				},
			},
			{
				ID:          "concept_audit_log",
				Name:        "AuditLog",
				DisplayName: "审计日志",
				Description: "高敏权限变更与关键管理动作不可篡改留痕",
				Attributes: []domain.ConceptAttribute{
					{ID: "ral_1", Name: "id", DisplayName: "编号", Category: domain.AttrNumber, IsBusinessKey: true, Required: true, IsUnique: true},
					{ID: "ral_2", Name: "action", DisplayName: "操作动作", Category: domain.AttrString, Required: true},
					{ID: "ral_3", Name: "client_ip", DisplayName: "来源IP", Category: domain.AttrString, Required: true},
				},
			},
		},
		Relations: []domain.ConceptRelation{
			{ID: "rrel_ten_dept", Name: "下辖部门", SourceConcept: "Tenant", TargetConcept: "Department", Cardinality: domain.CardOneToMany},
			{ID: "rrel_dept_self", Name: "上下级部门", SourceConcept: "Department", TargetConcept: "Department", Cardinality: domain.CardOneToMany},
			{ID: "rrel_ten_mem", Name: "所属租户", SourceConcept: "Tenant", TargetConcept: "Member", Cardinality: domain.CardOneToMany},
			{ID: "rrel_dept_mem", Name: "所属部门", SourceConcept: "Department", TargetConcept: "Member", Cardinality: domain.CardOneToMany},
			{ID: "rrel_mem_role", Name: "授予角色", SourceConcept: "Member", TargetConcept: "Role", Cardinality: domain.CardManyToMany},
			{ID: "rrel_role_perm", Name: "分配权限", SourceConcept: "Role", TargetConcept: "Permission", Cardinality: domain.CardManyToMany},
			{ID: "rrel_mem_log", Name: "触发审计", SourceConcept: "Member", TargetConcept: "AuditLog", Cardinality: domain.CardOneToMany},
		},
	}

	physical := domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:       tenID,
				Name:     "tenants",
				Comment:  "企业租户",
				Position: pos(80, 60),
				Attributes: []domain.Attribute{
					{ID: "01960002-0001-7000-8000-000000000001", Name: "id", Comment: "租户主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "租户主键"},
					{ID: "01960002-0001-7000-8000-000000000002", Name: "tenant_code", Comment: "租户唯一编码", DBType: "VARCHAR(32)", CodeType: "string", IsUnique: true, Description: "租户唯一编码"},
					{ID: "01960002-0001-7000-8000-000000000003", Name: "company_name", Comment: "企业全称", DBType: "VARCHAR(128)", CodeType: "string", Description: "企业全称"},
					{ID: "01960002-0001-7000-8000-000000000004", Name: "plan_tier", Comment: "订阅版本", DBType: "VARCHAR(24)", CodeType: "string", Description: "订阅版本"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_tenants_code", Columns: []string{"tenant_code"}, IsUnique: true, Comment: "租户编码唯一索引"},
				},
			},
			{
				ID:       deptID,
				Name:     "departments",
				Comment:  "组织部门",
				Position: pos(80, 380),
				Attributes: []domain.Attribute{
					{ID: "01960002-0002-7000-8000-000000000001", Name: "id", Comment: "部门主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "部门主键"},
					{ID: "01960002-0002-7000-8000-000000000002", Name: "tenant_id", Comment: "所属租户ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "所属租户ID"},
					{ID: "01960002-0002-7000-8000-000000000003", Name: "parent_id", Comment: "上级部门ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsNullable: true, Description: "上级部门ID"},
					{ID: "01960002-0002-7000-8000-000000000004", Name: "dept_name", Comment: "部门名称", DBType: "VARCHAR(64)", CodeType: "string", Description: "部门名称"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "idx_departments_tenant_parent", Columns: []string{"tenant_id", "parent_id"}, Comment: "租户组织树索引"},
				},
			},
			{
				ID:       memID,
				Name:     "members",
				Comment:  "企业成员",
				Position: pos(450, 180),
				Attributes: []domain.Attribute{
					{ID: "01960002-0003-7000-8000-000000000001", Name: "id", Comment: "成员主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "成员主键"},
					{ID: "01960002-0003-7000-8000-000000000002", Name: "tenant_id", Comment: "所属租户ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "所属租户ID"},
					{ID: "01960002-0003-7000-8000-000000000003", Name: "department_id", Comment: "所属部门ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "所属部门ID"},
					{ID: "01960002-0003-7000-8000-000000000004", Name: "email", Comment: "登录邮箱", DBType: "VARCHAR(128)", CodeType: "string", IsUnique: true, Description: "登录邮箱"},
					{ID: "01960002-0003-7000-8000-000000000005", Name: "display_name", Comment: "成员姓名", DBType: "VARCHAR(64)", CodeType: "string", Description: "成员姓名"},
					{ID: "01960002-0003-7000-8000-000000000006", Name: "status", Comment: "账号状态", DBType: "VARCHAR(16)", CodeType: "string", Description: "账号状态"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_members_tenant_email", Columns: []string{"tenant_id", "email"}, IsUnique: true, Comment: "租户内邮箱唯一索引"},
					{Name: "idx_members_dept_id", Columns: []string{"department_id"}, Comment: "部门成员列表索引"},
				},
			},
			{
				ID:              mrID,
				Name:            "member_roles",
				Comment:         "授予角色",
				Position:        pos(820, 80),
				IsJunctionTable: &isJunctionTrue,
				Attributes: []domain.Attribute{
					{ID: "01960002-0004-7000-8000-000000000001", Name: "id", Comment: "主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "主键"},
					{ID: "01960002-0004-7000-8000-000000000002", Name: "member_id", Comment: "成员ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "成员ID"},
					{ID: "01960002-0004-7000-8000-000000000003", Name: "role_id", Comment: "角色ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "角色ID"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_member_roles_pair", Columns: []string{"member_id", "role_id"}, IsUnique: true, Comment: "成员角色联合唯一索引"},
				},
			},
			{
				ID:       roleID,
				Name:     "roles",
				Comment:  "业务角色",
				Position: pos(1160, 80),
				Attributes: []domain.Attribute{
					{ID: "01960002-0005-7000-8000-000000000001", Name: "id", Comment: "角色主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "角色主键"},
					{ID: "01960002-0005-7000-8000-000000000002", Name: "tenant_id", Comment: "所属租户ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "所属租户ID"},
					{ID: "01960002-0005-7000-8000-000000000003", Name: "role_key", Comment: "角色编码", DBType: "VARCHAR(64)", CodeType: "string", Description: "角色编码"},
					{ID: "01960002-0005-7000-8000-000000000004", Name: "role_name", Comment: "角色名称", DBType: "VARCHAR(64)", CodeType: "string", Description: "角色名称"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_roles_tenant_key", Columns: []string{"tenant_id", "role_key"}, IsUnique: true, Comment: "租户内角色编码唯一索引"},
				},
			},
			{
				ID:              rpID,
				Name:            "role_permissions",
				Comment:         "分配权限",
				Position:        pos(1160, 340),
				IsJunctionTable: &isJunctionTrue,
				Attributes: []domain.Attribute{
					{ID: "01960002-0006-7000-8000-000000000001", Name: "id", Comment: "主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "主键"},
					{ID: "01960002-0006-7000-8000-000000000002", Name: "role_id", Comment: "角色ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "角色ID"},
					{ID: "01960002-0006-7000-8000-000000000003", Name: "permission_id", Comment: "权限ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "权限ID"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_role_permissions_pair", Columns: []string{"role_id", "permission_id"}, IsUnique: true, Comment: "角色权限联合唯一索引"},
				},
			},
			{
				ID:       permID,
				Name:     "permissions",
				Comment:  "资源权限",
				Position: pos(1160, 560),
				Attributes: []domain.Attribute{
					{ID: "01960002-0007-7000-8000-000000000001", Name: "id", Comment: "权限主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "权限主键"},
					{ID: "01960002-0007-7000-8000-000000000002", Name: "perm_code", Comment: "权限标识符", DBType: "VARCHAR(96)", CodeType: "string", IsUnique: true, Description: "权限标识符"},
					{ID: "01960002-0007-7000-8000-000000000003", Name: "resource_type", Comment: "资源类型", DBType: "VARCHAR(24)", CodeType: "string", Description: "资源类型"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "uk_permissions_code", Columns: []string{"perm_code"}, IsUnique: true, Comment: "权限标识符唯一索引"},
				},
			},
			{
				ID:       logID,
				Name:     "audit_logs",
				Comment:  "审计日志",
				Position: pos(820, 400),
				Attributes: []domain.Attribute{
					{ID: "01960002-0008-7000-8000-000000000001", Name: "id", Comment: "日志主键", DBType: "BIGINT UNSIGNED", CodeType: "uint64", IsPrimaryKey: true, Description: "日志主键"},
					{ID: "01960002-0008-7000-8000-000000000002", Name: "tenant_id", Comment: "租户ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "租户ID"},
					{ID: "01960002-0008-7000-8000-000000000003", Name: "member_id", Comment: "操作人ID", DBType: "BIGINT UNSIGNED", CodeType: "uint64", Description: "操作人ID"},
					{ID: "01960002-0008-7000-8000-000000000004", Name: "action", Comment: "操作事件编码", DBType: "VARCHAR(64)", CodeType: "string", Description: "操作事件编码"},
					{ID: "01960002-0008-7000-8000-000000000005", Name: "client_ip", Comment: "操作来源IP", DBType: "VARCHAR(45)", CodeType: "string", Description: "操作来源IP"},
					{ID: "01960002-0008-7000-8000-000000000006", Name: "created_at", Comment: "发生时间", DBType: "DATETIME", CodeType: "time.Time", Description: "发生时间"},
				},
				Indexes: []domain.IndexDefinition{
					{Name: "idx_audit_logs_tenant_time", Columns: []string{"tenant_id", "created_at"}, Comment: "租户审计时间线查询索引"},
				},
			},
		},
		Relations: []domain.Relation{
			{ID: "01960002-0099-7000-8000-000000000001", SourceEntityID: tenID, TargetEntityID: deptID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960002-0099-7000-8000-000000000002", SourceEntityID: deptID, TargetEntityID: deptID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960002-0099-7000-8000-000000000003", SourceEntityID: tenID, TargetEntityID: memID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960002-0099-7000-8000-000000000004", SourceEntityID: deptID, TargetEntityID: memID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960002-0099-7000-8000-000000000005", SourceEntityID: memID, TargetEntityID: mrID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960002-0099-7000-8000-000000000006", SourceEntityID: roleID, TargetEntityID: mrID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960002-0099-7000-8000-000000000007", SourceEntityID: roleID, TargetEntityID: rpID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960002-0099-7000-8000-000000000008", SourceEntityID: permID, TargetEntityID: rpID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
			{ID: "01960002-0099-7000-8000-000000000009", SourceEntityID: memID, TargetEntityID: logID, Cardinality: "one_to_many", RelationTypeID: "one_to_many"},
		},
	}

	assistantJSON, _ := json.Marshal(map[string]any{
		"stage":   "physical_derived",
		"summary": "已构建多租户企业级 RBAC 权限架构模型：1) 以 tenants 租户为中心配合联合唯一索引实现逻辑隔离；2) departments 支持无限层级树；3) member_roles 与 role_permissions 两张纯中间表在陈氏概念视图中自动升华为「授予角色」与「分配权限」双 M:N 菱形节点。",
		"entities": []string{
			"tenants", "departments", "members", "roles", "permissions", "member_roles", "role_permissions", "audit_logs",
		},
	})

	return officialTemplateSpec{
		ID:          OfficialTemplateRBACID,
		Order:       2,
		Name:        "多租户 RBAC 权限架构",
		Description: "官方精选样板 · 企业级 SaaS 租户隔离、树形组织部门、成员-角色-权限双 M:N 矩阵与安全审计日志",
		Conceptual:  conceptual,
		Physical:    physical,
		UserPrompt:  "搭建一套 SaaS 多租户 RBAC 权限系统，包含企业租户、树形层级部门、企业成员、角色、细粒度资源权限以及安全操作审计日志。",
		AssistantMD: string(assistantJSON),
	}
}
