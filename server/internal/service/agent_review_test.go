package service

import (
	"context"
	"strings"
	"testing"

	"archcanvas/internal/domain"
)

func TestPerformStaticSchemaReview_PerfectSchema(t *testing.T) {
	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_users",
				Name:    "users",
				Comment: "系统用户表",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_1",
						Name:         "id",
						DBType:       "BIGINT",
						IsPrimaryKey: true,
					},
					{
						ID:     "attr_2",
						Name:   "username",
						DBType: "VARCHAR(64)",
					},
				},
				Indexes: []domain.IndexDefinition{
					{
						Name:     "idx_users_username",
						Columns:  []string{"username"},
						IsUnique: true,
					},
				},
			},
			{
				ID:      "ent_orders",
				Name:    "orders",
				Comment: "业务订单主表",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_3",
						Name:         "id",
						DBType:       "BIGINT",
						IsPrimaryKey: true,
					},
					{
						ID:     "attr_4",
						Name:   "user_id",
						DBType: "BIGINT",
					},
					{
						ID:     "attr_5",
						Name:   "total_amount",
						DBType: "DECIMAL(12,2)",
					},
				},
				Indexes: []domain.IndexDefinition{
					{
						Name:    "idx_orders_user_id",
						Columns: []string{"user_id"},
					},
				},
			},
		},
		Relations: []domain.Relation{
			{
				ID:             "rel_user_orders",
				SourceEntityID: "ent_users",
				TargetEntityID: "ent_orders",
				RelationTypeID: "one_to_many",
			},
		},
	}

	report := performStaticSchemaReview(design, "mysql")

	if report.Score != 100 {
		t.Fatalf("规范的物理模型预期得分 100，实际为 %d", report.Score)
	}
	if len(report.Issues) != 0 {
		t.Fatalf("规范模型预期 0 问题，实际产生 %d 项: %+v", len(report.Issues), report.Issues)
	}
	if !strings.Contains(report.Summary, "非常规范") {
		t.Fatalf("摘要应包含规范评语，实际为: %s", report.Summary)
	}
}

func TestPerformStaticSchemaReview_MissingPrimaryKey(t *testing.T) {
	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_logs",
				Name:    "access_logs",
				Comment: "访问日志表",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_1",
						Name:         "log_content",
						DBType:       "VARCHAR(255)",
						IsPrimaryKey: false,
					},
				},
			},
		},
	}

	report := performStaticSchemaReview(design, "mysql")

	// 满分 100 - 20 (Critical) = 80
	if report.Score != 80 {
		t.Fatalf("缺少主键扣除 20 分后预期 80，实际为 %d", report.Score)
	}
	if len(report.Issues) != 1 {
		t.Fatalf("预期 1 项缺陷，实际为 %d", len(report.Issues))
	}
	issue := report.Issues[0]
	if issue.Severity != domain.SeverityCritical {
		t.Fatalf("缺少主键严重等级应为 Critical，实际为 %s", issue.Severity)
	}
	if issue.Category != domain.CategoryTypeSafety {
		t.Fatalf("类别应为 TypeSafety，实际为 %s", issue.Category)
	}
	if !strings.Contains(issue.Title, "缺失主键定义") {
		t.Fatalf("标题应提示缺失主键，实际为: %s", issue.Title)
	}
}

func TestPerformStaticSchemaReview_UnindexedForeignKey(t *testing.T) {
	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_items",
				Name:    "order_items",
				Comment: "订单明细表",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_1",
						Name:         "id",
						DBType:       "BIGINT",
						IsPrimaryKey: true,
					},
					{
						ID:     "attr_2",
						Name:   "order_id",
						DBType: "BIGINT",
					},
				},
				// 没有任何索引，或索引建在其他字段上
				Indexes: []domain.IndexDefinition{
					{
						Name:    "idx_other",
						Columns: []string{"id"},
					},
				},
			},
		},
	}

	report := performStaticSchemaReview(design, "mysql")

	// 满分 100 - 8 (Warning) = 92
	if report.Score != 92 {
		t.Fatalf("外键缺失索引扣除 8 分后预期 92，实际为 %d", report.Score)
	}
	if len(report.Issues) != 1 {
		t.Fatalf("预期 1 项缺陷，实际为 %d", len(report.Issues))
	}
	issue := report.Issues[0]
	if issue.Severity != domain.SeverityWarning {
		t.Fatalf("外键缺失索引等级应为 Warning，实际为 %s", issue.Severity)
	}
	if issue.ColumnName != "order_id" {
		t.Fatalf("缺陷字段名应为 order_id，实际为 %s", issue.ColumnName)
	}
}

func TestPerformStaticSchemaReview_CompoundIndexLeftmostPrefix(t *testing.T) {
	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_items",
				Name:    "order_items",
				Comment: "订单明细表",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_1",
						Name:         "id",
						DBType:       "BIGINT",
						IsPrimaryKey: true,
					},
					{
						ID:     "attr_2",
						Name:   "order_id",
						DBType: "BIGINT",
					},
					{
						ID:     "attr_3",
						Name:   "product_id",
						DBType: "BIGINT",
					},
				},
				// 复合索引以 order_id 为最左前缀，product_id 未被最左覆盖
				Indexes: []domain.IndexDefinition{
					{
						Name:    "idx_order_product",
						Columns: []string{"order_id", "product_id"},
					},
				},
			},
		},
	}

	report := performStaticSchemaReview(design, "mysql")

	// order_id 有最左前缀，无 Warning；product_id 是第二列，未被覆盖，扣 8 分
	if report.Score != 92 {
		t.Fatalf("复合索引最左前缀测试预期扣 8 分(product_id)，实际得分: %d", report.Score)
	}
	if len(report.Issues) != 1 {
		t.Fatalf("预期仅有 product_id 未覆盖缺陷，实际为 %d 项", len(report.Issues))
	}
	if report.Issues[0].ColumnName != "product_id" {
		t.Fatalf("未覆盖的外键应为 product_id，实际为: %s", report.Issues[0].ColumnName)
	}
}

func TestPerformStaticSchemaReview_NamingAndComment(t *testing.T) {
	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_1",
				Name:    "ORDER_ITEMS", // 大写违背规范，扣 2 分 (Info)
				Comment: "",            // 缺失中文注释，扣 2 分 (Info)
				Attributes: []domain.Attribute{
					{
						ID:           "attr_1",
						Name:         "id",
						DBType:       "BIGINT",
						IsPrimaryKey: true,
					},
				},
			},
		},
	}

	report := performStaticSchemaReview(design, "mysql")

	// 100 - 2 (命名规范) - 2 (缺少注释) = 96
	if report.Score != 96 {
		t.Fatalf("命名与注释扣除 4 分后预期 96，实际为 %d", report.Score)
	}
	if len(report.Issues) != 2 {
		t.Fatalf("预期 2 项 Info 问题，实际为 %d", len(report.Issues))
	}
	for _, issue := range report.Issues {
		if issue.Severity != domain.SeverityInfo {
			t.Fatalf("预期严重级别均为 Info，实际出现: %s", issue.Severity)
		}
	}
}

func TestPerformStaticSchemaReview_FinancialPrecisionAndOverflow(t *testing.T) {
	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_billing",
				Name:    "billing_records",
				Comment: "计费记录表",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_1",
						Name:         "id",
						DBType:       "BIGINT",
						IsPrimaryKey: true,
					},
					{
						ID:     "attr_2",
						Name:   "unit_price",
						DBType: "DOUBLE", // 金额字段浮点数，扣 8 分 (Warning)
					},
					{
						ID:     "attr_3",
						Name:   "desc_raw",
						DBType: "TEXT",
					},
					{
						ID:     "attr_4",
						Name:   "payload_json",
						DBType: "LONGTEXT",
					},
					{
						ID:     "attr_5",
						Name:   "attachment_blob",
						DBType: "BLOB", // >= 3 个 TEXT/BLOB，扣 8 分 (Warning)
					},
				},
			},
		},
	}

	report := performStaticSchemaReview(design, "mysql")

	// 100 - 8 (DOUBLE price) - 8 (Row overflow >= 3 TEXT/BLOB) = 84
	if report.Score != 84 {
		t.Fatalf("金额精度与行溢出扣 16 分后预期 84，实际为 %d", report.Score)
	}
	if len(report.Issues) != 2 {
		t.Fatalf("预期 2 项 Warning 问题，实际为 %d", len(report.Issues))
	}
	if !strings.Contains(report.Summary, "基本合格") {
		t.Fatalf("84 分区间摘要应包含基本合格提示，实际为: %s", report.Summary)
	}
}

func TestPerformStaticSchemaReview_DanglingRelation(t *testing.T) {
	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_users",
				Name:    "users",
				Comment: "用户表",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_1",
						Name:         "id",
						DBType:       "BIGINT",
						IsPrimaryKey: true,
					},
				},
			},
		},
		Relations: []domain.Relation{
			{
				ID:             "rel_dangling",
				SourceEntityID: "ent_users",
				TargetEntityID: "ent_non_existent", // 不存在的实体，Critical 扣 20 分
				RelationTypeID: "one_to_many",
			},
		},
	}

	report := performStaticSchemaReview(design, "mysql")

	// 100 - 20 (Critical) = 80
	if report.Score != 80 {
		t.Fatalf("悬空关联关系扣 20 分后预期 80，实际为 %d", report.Score)
	}
	foundDangling := false
	for _, issue := range report.Issues {
		if issue.Category == domain.CategoryNormalization && issue.Severity == domain.SeverityCritical {
			foundDangling = true
			break
		}
	}
	if !foundDangling {
		t.Fatalf("未能识别出悬空关联关系 Critical 问题")
	}
}

func TestPerformStaticSchemaReview_ScoreClampedToZero(t *testing.T) {
	// 构造超过 100 分扣分的灾难模型
	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:   "ent_bad_1",
				Name: "BAD TABLE 1", // -2
				// 无主键 -20, 无注释 -2
			},
			{
				ID:   "ent_bad_2",
				Name: "BAD TABLE 2", // -2
				// 无主键 -20, 无注释 -2
			},
			{
				ID:   "ent_bad_3",
				Name: "BAD TABLE 3", // -2
				// 无主键 -20, 无注释 -2
			},
			{
				ID:   "ent_bad_4",
				Name: "BAD TABLE 4", // -2
				// 无主键 -20, 无注释 -2
			},
			{
				ID:   "ent_bad_5",
				Name: "BAD TABLE 5", // -2
				// 无主键 -20, 无注释 -2
			},
			{
				ID:   "ent_bad_6",
				Name: "BAD TABLE 6", // -2
				// 无主键 -20, 无注释 -2
			},
		},
	}

	report := performStaticSchemaReview(design, "mysql")

	if report.Score != 0 {
		t.Fatalf("扣分超过 100 时应下限截断为 0 分，实际为 %d", report.Score)
	}
	if !strings.Contains(report.Summary, "重大架构缺陷") {
		t.Fatalf("< 60 分时摘要应提示重大架构缺陷，实际为: %s", report.Summary)
	}
}

func TestReviewPhysicalSchema_ValidationAndFallback(t *testing.T) {
	svc := &AgentService{
		ModelManager: nil, // 测试本地离线/降级模式
	}

	ctx := context.Background()

	// 1. 空输入测试
	_, err := svc.ReviewPhysicalSchema(ctx, ReviewSchemaInput{
		CurrentERDesign: nil,
	}, nil)
	if err == nil {
		t.Fatalf("空实体模型预期返回错误，实际为 nil")
	}

	// 2. 正常输入降级推导测试
	var thinkingOutput strings.Builder
	report, err := svc.ReviewPhysicalSchema(ctx, ReviewSchemaInput{
		CurrentERDesign: &domain.ERDesign{
			Entities: []domain.Entity{
				{
					ID:      "ent_orders",
					Name:    "orders",
					Comment: "订单表",
					Attributes: []domain.Attribute{
						{
							ID:           "attr_1",
							Name:         "id",
							DBType:       "BIGINT",
							IsPrimaryKey: true,
						},
					},
				},
			},
		},
		Dialect: "mysql",
	}, func(chunk string) {
		thinkingOutput.WriteString(chunk)
	})

	if err != nil {
		t.Fatalf("降级模式执行体检失败: %v", err)
	}
	if report == nil || report.Score != 100 {
		t.Fatalf("正常模型在降级模式下预期得分 100，实际: %+v", report)
	}
	if !strings.Contains(thinkingOutput.String(), "正在执行全方位架构审查") {
		t.Fatalf("降级模式未触发流式推演思考过程，输出为: %s", thinkingOutput.String())
	}
}
