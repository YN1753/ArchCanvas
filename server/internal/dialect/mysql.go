package dialect

import "fmt"

func init() {
	Register(Spec{
		ID:               "mysql",
		Aliases:          []string{"mariadb"},
		DisplayName:      "MySQL",
		GormDriverImport: "gorm.io/driver/mysql",
		GormDriverModule: "gorm.io/driver/mysql v1.5.7",
		OpenExpr: func(dsnExpr string) string {
			return fmt.Sprintf("mysql.Open(%s)", dsnExpr)
		},
		DefaultDSN: func(dbName string) string {
			return fmt.Sprintf("root:123456@tcp(127.0.0.1:3306)/%s?charset=utf8mb4&parseTime=True&loc=Local", dbName)
		},
		PrimaryKeySQL:        "BIGINT UNSIGNED",
		PrimaryKeyGo:         "uint64",
		ForeignKeySQL:        "BIGINT UNSIGNED",
		ForeignKeyGo:         "uint64",
		BigIntSQL:            "BIGINT",
		DateTimeSQL:          "DATETIME",
		BooleanSQL:           "TINYINT(1)",
		DecimalSQL:           "DECIMAL(10,2)",
		JSONSQL:              "JSON",
		StringSQL:            "VARCHAR(128)",
		PromptPrimaryKeyHint: "MySQL 主键类型推荐 `BIGINT UNSIGNED` 或 `VARCHAR(36)`，code_type 为 `uint64` 或 `string`。",
		ForbiddenTypePatterns: []ForbiddenTypeRule{
			{Pattern: "SERIAL", Suggestion: "MySQL 不推荐使用 PostgreSQL 的 SERIAL/BIGSERIAL 伪类型，建议改用 `BIGINT UNSIGNED` 主键。"},
			{Pattern: "JSONB", Suggestion: "MySQL 不支持 `JSONB` 类型，建议改用原生 `JSON` 类型。"},
			{Pattern: "BYTEA", Suggestion: "MySQL 不支持 `BYTEA` 类型，建议改用 `BLOB` 或 `VARBINARY`。"},
			{Pattern: "TIMESTAMPTZ", Suggestion: "MySQL 不支持 `TIMESTAMPTZ` 关键字，建议改用 `DATETIME` 或 `TIMESTAMP`。"},
		},
	})
}
