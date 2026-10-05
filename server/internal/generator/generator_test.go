package generator

import (
	"go/parser"
	"go/token"
	"strings"
	"testing"

	"archcanvas/internal/domain"
	"archcanvas/request"
)

func TestGenerateFileTreeFromDesign(t *testing.T) {
	svc, err := NewGeneratorService(nil)
	if err != nil {
		t.Fatalf("failed to initialize GeneratorService: %v", err)
	}

	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_user",
				Name:    "users",
				Comment: "系统核心用户表",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_1",
						Name:         "id",
						Comment:      "用户主键ID",
						DBType:       "BIGINT UNSIGNED",
						CodeType:     "uint64",
						IsPrimaryKey: true,
						IsNullable:   false,
					},
					{
						ID:           "attr_2",
						Name:         "tenant_id",
						Comment:      "租户标识",
						DBType:       "BIGINT",
						CodeType:     "int64",
						IsPrimaryKey: false,
						IsNullable:   false,
					},
					{
						ID:           "attr_3",
						Name:         "username",
						Comment:      "登录账号",
						DBType:       "VARCHAR(64)",
						CodeType:     "string",
						IsPrimaryKey: false,
						IsNullable:   false,
						IsUnique:     true,
					},
					{
						ID:           "attr_4",
						Name:         "status",
						Comment:      "状态: 1-启用, 2-禁用",
						DBType:       "TINYINT",
						CodeType:     "int8",
						IsPrimaryKey: false,
						IsNullable:   false,
					},
					{
						ID:           "attr_5",
						Name:         "created_at",
						Comment:      "创建时间",
						DBType:       "DATETIME",
						CodeType:     "time.Time",
						IsPrimaryKey: false,
						IsNullable:   false,
					},
					{
						ID:           "attr_6",
						Name:         "updated_at",
						Comment:      "更新时间",
						DBType:       "DATETIME",
						CodeType:     "time.Time",
						IsPrimaryKey: false,
						IsNullable:   false,
					},
				},
				Indexes: []domain.IndexDefinition{
					{
						Name:     "uk_users_username",
						Columns:  []string{"username"},
						IsUnique: true,
						Comment:  "用户登录名唯一索引",
					},
					{
						Name:     "idx_tenant_status",
						Columns:  []string{"tenant_id", "status"},
						IsUnique: false,
						Comment:  "租户与状态联合查询索引",
					},
				},
			},
			{
				ID:      "ent_order",
				Name:    "orders",
				Comment: "业务订单表",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_o1",
						Name:         "id",
						Comment:      "订单主键",
						DBType:       "BIGINT UNSIGNED",
						CodeType:     "uint64",
						IsPrimaryKey: true,
					},
					{
						ID:           "attr_o2",
						Name:         "order_no",
						Comment:      "订单流水号",
						DBType:       "VARCHAR(64)",
						CodeType:     "string",
						IsUnique:     true,
					},
					{
						ID:           "attr_o3",
						Name:         "user_id",
						Comment:      "用户ID外键",
						DBType:       "BIGINT UNSIGNED",
						CodeType:     "uint64",
					},
					{
						ID:           "attr_o4",
						Name:         "created_at",
						Comment:      "下单时间",
						DBType:       "DATETIME",
						CodeType:     "time.Time",
					},
				},
				Indexes: []domain.IndexDefinition{
					{
						Name:     "uk_orders_no",
						Columns:  []string{"order_no"},
						IsUnique: true,
					},
					{
						Name:     "idx_orders_user",
						Columns:  []string{"user_id"},
						IsUnique: false,
					},
					{
						Name:     "idx_orders_created",
						Columns:  []string{"created_at"},
						IsUnique: false,
						Comment:  "创建时间维度排序索引",
					},
				},
			},
		},
		Relations: []domain.Relation{
			{
				ID:             "rel_user_orders",
				SourceEntityID: "ent_user",
				TargetEntityID: "ent_order",
				RelationTypeID: "one_to_many",
			},
		},
	}

	req := request.GenerateRequest{
		ProjectID:        "proj_123",
		ModuleName:       "example.com/myapp",
		Port:             "8080",
		DBDriver:         "mysql",
		EnableRedis:      true,
		EnableDocker:     true,
		EnableSoftDelete: true,
	}

	files, err := svc.GenerateFileTreeFromDesign(design, req)
	if err != nil {
		t.Fatalf("GenerateFileTreeFromDesign returned error: %v", err)
	}

	if len(files) == 0 {
		t.Fatal("expected generated files, got 0")
	}

	// 验证所有生成的 Go 文件均为合法 Go 语法，能被 Go AST parser 成功解析
	fset := token.NewFileSet()
	fileMap := make(map[string]string)
	for _, f := range files {
		fileMap[f.Path] = f.Content
		if strings.HasSuffix(f.Path, ".go") {
			_, parseErr := parser.ParseFile(fset, f.Path, f.Content, parser.AllErrors)
			if parseErr != nil {
				t.Fatalf("file %s failed Go AST parsing: %v\nContent:\n%s", f.Path, parseErr, f.Content)
			}
		}
	}

	// 1. 验证 users 模型的表级与字段级注释、复合索引以及 BaseModel 去重
	userModel, ok := fileMap["internal/model/users.go"]
	if !ok {
		t.Fatal("missing internal/model/users.go")
	}

	// 校验表级注释
	if !strings.Contains(userModel, "// User 系统核心用户表") {
		t.Errorf("expected struct doc comment with table comment, got:\n%s", userModel)
	}

	// 校验单列唯一索引
	if !strings.Contains(userModel, "uniqueIndex:uk_users_username") {
		t.Errorf("expected uniqueIndex:uk_users_username tag, got:\n%s", userModel)
	}

	// 校验复合索引 priority 标签
	if !strings.Contains(userModel, "index:idx_tenant_status,priority:1") {
		t.Errorf("expected tenant_id to have index:idx_tenant_status,priority:1, got:\n%s", userModel)
	}
	if !strings.Contains(userModel, "index:idx_tenant_status,priority:2") {
		t.Errorf("expected status to have index:idx_tenant_status,priority:2, got:\n%s", userModel)
	}

	// 校验字段中文注释 comment 标签
	if !strings.Contains(userModel, "comment:登录账号") {
		t.Errorf("expected username comment:登录账号, got:\n%s", userModel)
	}
	if !strings.Contains(userModel, "comment:状态: 1-启用, 2-禁用") {
		t.Errorf("expected status comment tag, got:\n%s", userModel)
	}

	// 校验未索引的 created_at / updated_at 已被 BaseModel 去重（User 结构体内不应再重复声明 CreatedAt/UpdatedAt 字段）
	lines := strings.Split(userModel, "\n")
	hasCreatedAtInUser := false
	hasUpdatedAtInUser := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "CreatedAt ") {
			hasCreatedAtInUser = true
		}
		if strings.HasPrefix(trimmed, "UpdatedAt ") {
			hasUpdatedAtInUser = true
		}
	}
	if hasCreatedAtInUser {
		t.Errorf("users.go should NOT duplicate CreatedAt field because BaseModel already provides it")
	}
	if hasUpdatedAtInUser {
		t.Errorf("users.go should NOT duplicate UpdatedAt field because BaseModel already provides it")
	}

	// 2. 验证 orders 模型的显式索引 created_at 保留逻辑
	orderModel, ok := fileMap["internal/model/orders.go"]
	if !ok {
		t.Fatal("missing internal/model/orders.go")
	}
	if !strings.Contains(orderModel, "index:idx_orders_created") {
		t.Errorf("orders.go should retain CreatedAt because it is explicitly indexed, got:\n%s", orderModel)
	}
	if !strings.Contains(orderModel, "autoCreateTime") {
		t.Errorf("retained CreatedAt in orders.go should have autoCreateTime tag, got:\n%s", orderModel)
	}

	// 3. 验证 BaseModel 软删除
	baseModel, ok := fileMap["internal/model/base.go"]
	if !ok {
		t.Fatal("missing internal/model/base.go")
	}
	if !strings.Contains(baseModel, "DeletedAt gorm.DeletedAt") {
		t.Errorf("expected DeletedAt in base.go when EnableSoftDelete is true, got:\n%s", baseModel)
	}
}
