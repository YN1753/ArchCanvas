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
						ID:       "attr_o2",
						Name:     "order_no",
						Comment:  "订单流水号",
						DBType:   "VARCHAR(64)",
						CodeType: "string",
						IsUnique: true,
					},
					{
						ID:       "attr_o3",
						Name:     "user_id",
						Comment:  "用户ID外键",
						DBType:   "BIGINT UNSIGNED",
						CodeType: "uint64",
					},
					{
						ID:       "attr_o4",
						Name:     "created_at",
						Comment:  "下单时间",
						DBType:   "DATETIME",
						CodeType: "time.Time",
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

func TestGenerateDuplicateAndSelfReferencingRelations(t *testing.T) {
	svc, err := NewGeneratorService(nil)
	if err != nil {
		t.Fatalf("failed to initialize GeneratorService: %v", err)
	}

	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_user",
				Name:    "users",
				Comment: "用户",
				Attributes: []domain.Attribute{
					{Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					{Name: "name", DBType: "VARCHAR(64)", CodeType: "string"},
				},
			},
			{
				ID:      "ent_order",
				Name:    "orders",
				Comment: "订单",
				Attributes: []domain.Attribute{
					{Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					// 故意定义一个与关联同名的 attribute: User
					{Name: "user", DBType: "VARCHAR(64)", CodeType: "string", Comment: "买家快照"},
					{Name: "user_id", DBType: "BIGINT", CodeType: "uint64"},
				},
			},
			{
				ID:      "ent_category",
				Name:    "categories",
				Comment: "无限级分类",
				Attributes: []domain.Attribute{
					{Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					{Name: "name", DBType: "VARCHAR(64)", CodeType: "string"},
					{Name: "parent_id", DBType: "BIGINT", CodeType: "uint64"},
				},
			},
		},
		Relations: []domain.Relation{
			// 1. 重复关系定义（模拟脏数据或重复传递同一关系）
			{
				ID:             "rel_user_orders_1",
				SourceEntityID: "ent_user",
				TargetEntityID: "ent_order",
				RelationTypeID: "one_to_many",
			},
			{
				ID:             "rel_user_orders_2",
				SourceEntityID: "ent_user",
				TargetEntityID: "ent_order",
				RelationTypeID: "one_to_many",
			},
			// 2. 自引用树形关系（Category -> Category）
			{
				ID:             "rel_category_tree",
				SourceEntityID: "ent_category",
				TargetEntityID: "ent_category",
				RelationTypeID: "one_to_many",
			},
		},
	}

	req := request.GenerateRequest{
		ProjectID:  "proj_tree",
		ModuleName: "example.com/treeapp",
		Port:       "8080",
		DBDriver:   "mysql",
	}

	files, err := svc.GenerateFileTreeFromDesign(design, req)
	if err != nil {
		t.Fatalf("GenerateFileTreeFromDesign returned error: %v", err)
	}

	fset := token.NewFileSet()
	fileMap := make(map[string]string)
	for _, f := range files {
		fileMap[f.Path] = f.Content
		if strings.HasSuffix(f.Path, ".go") {
			_, parseErr := parser.ParseFile(fset, f.Path, f.Content, parser.AllErrors)
			if parseErr != nil {
				t.Fatalf("file %s failed AST parsing (potential duplicate fields): %v\nContent:\n%s", f.Path, parseErr, f.Content)
			}
		}
	}

	// 验证 Orders 结构体消歧：已有名为 User 的字段，关联字段不应重名
	orderModel := fileMap["internal/model/orders.go"]
	if !strings.Contains(orderModel, "User") || !strings.Contains(orderModel, "`gorm:\"column:user;") {
		t.Errorf("orders.go should retain attribute User, got:\n%s", orderModel)
	}
	// 关联字段应当自动重命名消歧为 User2，绝不能重名产生 duplicate field
	if !strings.Contains(orderModel, "User2") || !strings.Contains(orderModel, "*User") {
		t.Errorf("orders.go should disambiguate association field to User2, got:\n%s", orderModel)
	}

	// 验证自引用分类模型包含 Children 和 Parent
	catModel := fileMap["internal/model/categories.go"]
	if !strings.Contains(catModel, "Children") || !strings.Contains(catModel, "[]Category") {
		t.Errorf("categories.go should have Children []Category for self-reference, got:\n%s", catModel)
	}
	if !strings.Contains(catModel, "Parent") || !strings.Contains(catModel, "*Category") {
		t.Errorf("categories.go should have Parent *Category for self-reference, got:\n%s", catModel)
	}
}

func TestGenerateManyToManyAssociations(t *testing.T) {
	svc, err := NewGeneratorService(nil)
	if err != nil {
		t.Fatalf("failed to initialize GeneratorService: %v", err)
	}

	trueVal := true

	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:      "ent_article",
				Name:    "articles",
				Comment: "文章表",
				Attributes: []domain.Attribute{
					{Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					{Name: "title", DBType: "VARCHAR(255)", CodeType: "string"},
				},
			},
			{
				ID:      "ent_tag",
				Name:    "tags",
				Comment: "标签表",
				Attributes: []domain.Attribute{
					{Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					{Name: "name", DBType: "VARCHAR(64)", CodeType: "string"},
				},
			},
			{
				ID:              "ent_article_tag",
				Name:            "article_tags",
				Comment:         "文章与标签技术中间表",
				IsJunctionTable: &trueVal,
				Attributes: []domain.Attribute{
					{Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					{Name: "article_id", DBType: "BIGINT", CodeType: "uint64"},
					{Name: "tag_id", DBType: "BIGINT", CodeType: "uint64"},
				},
			},
			{
				ID:      "ent_user",
				Name:    "users",
				Comment: "用户表",
				Attributes: []domain.Attribute{
					{Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					{Name: "username", DBType: "VARCHAR(64)", CodeType: "string"},
				},
			},
			{
				ID:      "ent_role",
				Name:    "roles",
				Comment: "角色表",
				Attributes: []domain.Attribute{
					{Name: "id", IsPrimaryKey: true, DBType: "BIGINT", CodeType: "uint64"},
					{Name: "role_name", DBType: "VARCHAR(64)", CodeType: "string"},
				},
			},
		},
		Relations: []domain.Relation{
			// 1. 中间表 article_tags 拓扑连接
			{
				ID:             "rel_art_to_tag",
				SourceEntityID: "ent_article",
				TargetEntityID: "ent_article_tag",
				Cardinality:    "1:N",
			},
			{
				ID:             "rel_tag_to_art",
				SourceEntityID: "ent_tag",
				TargetEntityID: "ent_article_tag",
				Cardinality:    "1:N",
			},
			// 2. 直接多对多关系 (users <-> roles)
			{
				ID:             "rel_user_role",
				SourceEntityID: "ent_user",
				TargetEntityID: "ent_role",
				Cardinality:    "many_to_many",
			},
		},
	}

	req := request.GenerateRequest{
		ProjectID:  "proj_m2m",
		ModuleName: "example.com/m2mapp",
		Port:       "8080",
		DBDriver:   "mysql",
	}

	files, err := svc.GenerateFileTreeFromDesign(design, req)
	if err != nil {
		t.Fatalf("GenerateFileTreeFromDesign returned error: %v", err)
	}

	fset := token.NewFileSet()
	fileMap := make(map[string]string)
	for _, f := range files {
		fileMap[f.Path] = f.Content
		if strings.HasSuffix(f.Path, ".go") {
			_, parseErr := parser.ParseFile(fset, f.Path, f.Content, parser.AllErrors)
			if parseErr != nil {
				t.Fatalf("file %s failed AST parsing: %v\nContent:\n%s", f.Path, parseErr, f.Content)
			}
		}
	}

	// 1. 验证中间表 article_tags 自动为 articles 注入 Tags []Tag gorm:"many2many:article_tags;"
	articleModel := fileMap["internal/model/articles.go"]
	if !strings.Contains(articleModel, "Tags") || !strings.Contains(articleModel, "[]Tag") || !strings.Contains(articleModel, "`gorm:\"many2many:article_tags;\"") {
		t.Errorf("articles.go should have many2many Tags []Tag, got:\n%s", articleModel)
	}

	// 2. 验证中间表 article_tags 自动为 tags 注入 Articles []Article gorm:"many2many:article_tags;"
	tagModel := fileMap["internal/model/tags.go"]
	if !strings.Contains(tagModel, "Articles") || !strings.Contains(tagModel, "[]Article") || !strings.Contains(tagModel, "`gorm:\"many2many:article_tags;\"") {
		t.Errorf("tags.go should have many2many Articles []Article, got:\n%s", tagModel)
	}

	// 3. 验证显式多对多关联为 users 和 roles 分别注入 many2many:users_roles
	userModel := fileMap["internal/model/users.go"]
	if !strings.Contains(userModel, "Roles") || !strings.Contains(userModel, "[]Role") || !strings.Contains(userModel, "`gorm:\"many2many:users_roles;\"") {
		t.Errorf("users.go should have many2many Roles []Role, got:\n%s", userModel)
	}

	roleModel := fileMap["internal/model/roles.go"]
	if !strings.Contains(roleModel, "Users") || !strings.Contains(roleModel, "[]User") || !strings.Contains(roleModel, "`gorm:\"many2many:users_roles;\"") {
		t.Errorf("roles.go should have many2many Users []User, got:\n%s", roleModel)
	}
}

func TestGenerateIntegerPrimaryKeyVariants(t *testing.T) {
	svc, err := NewGeneratorService(nil)
	if err != nil {
		t.Fatalf("failed to initialize GeneratorService: %v", err)
	}

	design := &domain.ERDesign{
		Entities: []domain.Entity{
			{
				ID:   "ent_device",
				Name: "devices",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_d1",
						Name:         "device_id",
						DBType:       "INT UNSIGNED",
						CodeType:     "uint32",
						IsPrimaryKey: true,
					},
					{
						ID:       "attr_d2",
						Name:     "sn",
						DBType:   "VARCHAR(64)",
						CodeType: "string",
					},
				},
			},
			{
				ID:   "ent_log",
				Name: "system_logs",
				Attributes: []domain.Attribute{
					{
						ID:           "attr_l1",
						Name:         "log_id",
						DBType:       "INT",
						CodeType:     "int32",
						IsPrimaryKey: true,
					},
					{
						ID:       "attr_l2",
						Name:     "content",
						DBType:   "TEXT",
						CodeType: "string",
					},
				},
			},
		},
	}

	req := request.GenerateRequest{
		ProjectID:  "proj_pk_variants",
		ModuleName: "example.com/pkapp",
		Port:       "8080",
		DBDriver:   "mysql",
	}

	files, err := svc.GenerateFileTreeFromDesign(design, req)
	if err != nil {
		t.Fatalf("GenerateFileTreeFromDesign returned error: %v", err)
	}

	fset := token.NewFileSet()
	fileMap := make(map[string]string)
	for _, f := range files {
		fileMap[f.Path] = f.Content
		if strings.HasSuffix(f.Path, ".go") {
			_, parseErr := parser.ParseFile(fset, f.Path, f.Content, parser.AllErrors)
			if parseErr != nil {
				t.Fatalf("file %s failed AST parsing: %v\nContent:\n%s", f.Path, parseErr, f.Content)
			}
		}
	}

	// 验证 devices (uint32 主键) 的 handler 中有 uint32 转换
	deviceHandler, ok := fileMap["internal/handler/devices_handler.go"]
	if !ok {
		t.Fatal("missing internal/handler/devices_handler.go")
	}
	if !strings.Contains(deviceHandler, "strconv.ParseUint") {
		t.Errorf("devices_handler.go should use strconv.ParseUint for uint32, got:\n%s", deviceHandler)
	}
	if !strings.Contains(deviceHandler, "uint32(id)") {
		t.Errorf("devices_handler.go should cast to uint32(id), got:\n%s", deviceHandler)
	}

	// 验证 system_logs (int32 主键) 的 handler 中有 int32 转换
	logHandler, ok := fileMap["internal/handler/system_logs_handler.go"]
	if !ok {
		t.Fatal("missing internal/handler/system_logs_handler.go")
	}
	if !strings.Contains(logHandler, "strconv.ParseInt") {
		t.Errorf("system_logs_handler.go should use strconv.ParseInt for int32, got:\n%s", logHandler)
	}
	if !strings.Contains(logHandler, "int32(id)") {
		t.Errorf("system_logs_handler.go should cast to int32(id), got:\n%s", logHandler)
	}
}
