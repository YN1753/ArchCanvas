package dialect

import "fmt"

func init() {
	Register(Spec{
		ID:               "sqlite",
		Aliases:          []string{"sqlite3"},
		DisplayName:      "SQLite",
		GormDriverImport: "gorm.io/driver/sqlite",
		GormDriverModule: "gorm.io/driver/sqlite v1.6.0",
		OpenExpr: func(dsnExpr string) string {
			return fmt.Sprintf("sqlite.Open(%s)", dsnExpr)
		},
		DefaultDSN: func(_ string) string {
			return "data.db"
		},
		PrimaryKeySQL:        "INTEGER",
		PrimaryKeyGo:         "int64",
		ForeignKeySQL:        "INTEGER",
		ForeignKeyGo:         "int64",
		BigIntSQL:            "INTEGER",
		DateTimeSQL:          "DATETIME",
		BooleanSQL:           "INTEGER",
		DecimalSQL:           "REAL",
		JSONSQL:              "TEXT",
		StringSQL:            "VARCHAR(128)",
		PromptPrimaryKeyHint: "SQLite 主键类型为 `INTEGER` 或 `TEXT`。",
		ForbiddenTypePatterns: []ForbiddenTypeRule{
			{Pattern: "AUTO_INCREMENT", Suggestion: "SQLite 不使用 MySQL 的 `AUTO_INCREMENT`（含下划线），主键自增应使用 `INTEGER` 主键。"},
			{Pattern: "SERIAL", Suggestion: "SQLite 不支持 `SERIAL`/`BIGSERIAL` 类型，建议改用 `INTEGER`。"},
			{Pattern: "JSONB", Suggestion: "SQLite 常规建表建议使用 `TEXT` 存储 JSON 文档。"},
			{Pattern: "BYTEA", Suggestion: "SQLite 不支持 `BYTEA` 类型，二进制列建议使用 `BLOB`。"},
		},
	})
}
