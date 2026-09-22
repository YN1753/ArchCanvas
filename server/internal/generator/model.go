package generator

import (
	"archcanvas/internal/domain"
	"archcanvas/request"
	"fmt"
	"strings"
	"unicode"
)

var initialisms = map[string]bool{
	"ACL":   true,
	"API":   true,
	"ASCII": true,
	"CPU":   true,
	"CSS":   true,
	"DNS":   true,
	"EOF":   true,
	"GUID":  true,
	"HTML":  true,
	"HTTP":  true,
	"HTTPS": true,
	"ID":    true,
	"IP":    true,
	"JSON":  true,
	"LHS":   true,
	"QPS":   true,
	"RAM":   true,
	"RHS":   true,
	"RPC":   true,
	"SLA":   true,
	"SMTP":  true,
	"SQL":   true,
	"SSH":   true,
	"TCP":   true,
	"TLS":   true,
	"TTL":   true,
	"UDP":   true,
	"UI":    true,
	"UID":   true,
	"UUID":  true,
	"URI":   true,
	"URL":   true,
	"UTF8":  true,
	"VM":    true,
	"XML":   true,
	"XSRF":  true,
	"XSS":   true,
}

// ProjectContext 传递给代码生成模板的根上下文
type ProjectContext struct {
	ModuleName       string
	Port             string
	DBDriver         string
	EnableRedis      bool
	EnableDocker     bool
	EnableSoftDelete bool
	Entities         []EntityData
}

// EntityData 实体模板视图模型
type EntityData struct {
	ID           string
	TableName    string
	StructName   string
	VarName      string
	PluralName   string
	Attributes   []AttributeData
	PrimaryKey   AttributeData
	Associations []AssociationData
}

// AttributeData 字段模板视图模型
type AttributeData struct {
	Name         string
	FieldName    string
	DBType       string
	GoType       string
	IsPrimaryKey bool
	IsNullable   bool
	IsUnique     bool
	Description  string
	GormTag      string
	JsonTag      string
}

// AssociationData GORM 关系关联视图模型
type AssociationData struct {
	Type      string // HasMany | BelongsTo
	FieldName string // 如 Orders, User
	FieldType string // 如 []Order, *User
	GormTag   string
	JsonTag   string
}

// GeneratedFile 单个生成的文件元信息
type GeneratedFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Size    int    `json:"size"`
}

// BuildProjectContext 将前端入参与领域设计转换为模板上下文
func BuildProjectContext(req request.GenerateRequest, design *domain.ERDesign) ProjectContext {
	port := req.Port
	if port == "" {
		port = ":8080"
	} else if !strings.HasPrefix(port, ":") {
		port = ":" + port
	}

	driver := strings.ToLower(req.DBDriver)
	if driver != "postgres" && driver != "sqlite" {
		driver = "mysql"
	}

	entityMap := make(map[string]EntityData)
	var entities []EntityData

	for _, ent := range design.Entities {
		eData := buildEntityData(ent)
		entityMap[ent.ID] = eData
		if ent.Name != "" {
			entityMap[strings.ToLower(ent.Name)] = eData
		}
	}

	// 匹配与推导关联关系 (1:N 映射)
	for _, rel := range design.Relations {
		sourceEnt, okSource := entityMap[rel.SourceEntityID]
		if !okSource {
			sourceEnt, okSource = entityMap[strings.ToLower(rel.SourceEntityID)]
		}
		targetEnt, okTarget := entityMap[rel.TargetEntityID]
		if !okTarget {
			targetEnt, okTarget = entityMap[strings.ToLower(rel.TargetEntityID)]
		}
		if !okSource || !okTarget {
			continue
		}

		// Source (如 User) 拥有多个 Target (如 Orders)
		// 寻找 target 中匹配 source 的外键字段（如 user_id）
		fkFieldName := sourceEnt.StructName + "ID"
		pkFieldName := sourceEnt.PrimaryKey.FieldName
		if pkFieldName == "" {
			pkFieldName = "ID"
		}

		// 为 Source 增加 HasMany
		sourceEnt.Associations = append(sourceEnt.Associations, AssociationData{
			Type:      "HasMany",
			FieldName: ToPascalCase(targetEnt.TableName),
			FieldType: "[]" + targetEnt.StructName,
			GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(targetEnt.TableName)),
		})

		// 为 Target 增加 BelongsTo
		targetEnt.Associations = append(targetEnt.Associations, AssociationData{
			Type:      "BelongsTo",
			FieldName: sourceEnt.StructName,
			FieldType: "*" + sourceEnt.StructName,
			GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(sourceEnt.StructName)),
		})

		entityMap[rel.SourceEntityID] = sourceEnt
		entityMap[rel.TargetEntityID] = targetEnt
		if sourceEnt.TableName != "" {
			entityMap[strings.ToLower(sourceEnt.TableName)] = sourceEnt
		}
		if targetEnt.TableName != "" {
			entityMap[strings.ToLower(targetEnt.TableName)] = targetEnt
		}
	}

	for _, ent := range design.Entities {
		if eData, ok := entityMap[ent.ID]; ok {
			entities = append(entities, eData)
		}
	}

	return ProjectContext{
		ModuleName:       req.ModuleName,
		Port:             port,
		DBDriver:         driver,
		EnableRedis:      req.EnableRedis,
		EnableDocker:     req.EnableDocker,
		EnableSoftDelete: req.EnableSoftDelete,
		Entities:         entities,
	}
}

func buildEntityData(ent domain.Entity) EntityData {
	tableName := strings.TrimSpace(ent.Name)
	if tableName == "" {
		tableName = "table"
	}
	singular := ToSingular(tableName)
	structName := ToPascalCase(singular)
	varName := ToCamelCase(singular)
	pluralName := ToPascalCase(tableName)

	var attrs []AttributeData
	var primaryKey AttributeData

	for _, attr := range ent.Attributes {
		aData := buildAttributeData(attr)
		attrs = append(attrs, aData)
		if attr.IsPrimaryKey && primaryKey.FieldName == "" {
			primaryKey = aData
		}
	}

	if primaryKey.FieldName == "" && len(attrs) > 0 {
		primaryKey = attrs[0]
	}

	return EntityData{
		ID:           ent.ID,
		TableName:    tableName,
		StructName:   structName,
		VarName:      varName,
		PluralName:   pluralName,
		Attributes:   attrs,
		PrimaryKey:   primaryKey,
		Associations: make([]AssociationData, 0),
	}
}

func buildAttributeData(attr domain.Attribute) AttributeData {
	fieldName := ToPascalCase(attr.Name)
	goType := normalizeGoType(attr.CodeType, attr.DBType, attr.IsNullable)

	var gormTags []string
	if attr.IsPrimaryKey {
		gormTags = append(gormTags, "primaryKey")
	}
	gormTags = append(gormTags, fmt.Sprintf("column:%s", attr.Name))

	dbType := strings.TrimSpace(attr.DBType)
	if dbType != "" {
		gormTags = append(gormTags, fmt.Sprintf("type:%s", strings.ToLower(dbType)))
	}
	if !attr.IsNullable && !attr.IsPrimaryKey {
		gormTags = append(gormTags, "not null")
	}
	if attr.IsUnique {
		gormTags = append(gormTags, "unique")
	}
	if attr.Description != "" {
		cleanDesc := strings.ReplaceAll(attr.Description, ";", ",")
		cleanDesc = strings.ReplaceAll(cleanDesc, `"`, "")
		gormTags = append(gormTags, fmt.Sprintf("comment:%s", cleanDesc))
	}

	gormTagStr := fmt.Sprintf(`gorm:"%s"`, strings.Join(gormTags, ";"))
	jsonTagStr := fmt.Sprintf(`json:"%s"`, attr.Name)

	return AttributeData{
		Name:         attr.Name,
		FieldName:    fieldName,
		DBType:       attr.DBType,
		GoType:       goType,
		IsPrimaryKey: attr.IsPrimaryKey,
		IsNullable:   attr.IsNullable,
		IsUnique:     attr.IsUnique,
		Description:  attr.Description,
		GormTag:      gormTagStr,
		JsonTag:      jsonTagStr,
	}
}

func normalizeGoType(codeType, dbType string, isNullable bool) string {
	raw := strings.TrimSpace(codeType)
	if raw == "" {
		upperDB := strings.ToUpper(dbType)
		switch {
		case strings.Contains(upperDB, "BIGINT"):
			raw = "uint64"
		case strings.Contains(upperDB, "INT"):
			raw = "int"
		case strings.Contains(upperDB, "BOOL"):
			raw = "bool"
		case strings.Contains(upperDB, "TIME"), strings.Contains(upperDB, "DATE"):
			raw = "time.Time"
		case strings.Contains(upperDB, "DECIMAL"), strings.Contains(upperDB, "NUMERIC"), strings.Contains(upperDB, "FLOAT"), strings.Contains(upperDB, "DOUBLE"):
			raw = "float64"
		case strings.Contains(upperDB, "BLOB"), strings.Contains(upperDB, "BINARY"):
			raw = "[]byte"
		default:
			raw = "string"
		}
	}

	if isNullable && !strings.HasPrefix(raw, "*") && raw != "[]byte" {
		return "*" + raw
	}
	return raw
}

// ToPascalCase 将 snake_case 或混合命名转为 PascalCase (遵循 Go Initialisms 规范)
func ToPascalCase(s string) string {
	words := splitIntoWords(s)
	if len(words) == 0 {
		return "Entity"
	}
	var sb strings.Builder
	for _, w := range words {
		upper := strings.ToUpper(w)
		if initialisms[upper] {
			sb.WriteString(upper)
		} else {
			r := []rune(w)
			sb.WriteRune(unicode.ToUpper(r[0]))
			sb.WriteString(strings.ToLower(string(r[1:])))
		}
	}
	return sb.String()
}

// ToCamelCase 将名称转为 camelCase
func ToCamelCase(s string) string {
	pascal := ToPascalCase(s)
	if len(pascal) == 0 {
		return ""
	}
	// 处理开头的首字母缩写，如 ID 变成 id, URL 变成 url
	r := []rune(pascal)
	if len(r) == 1 {
		return strings.ToLower(pascal)
	}

	// 查找开头连续大写的数量
	idx := 0
	for idx < len(r) && unicode.IsUpper(r[idx]) {
		idx++
	}

	if idx == 1 {
		r[0] = unicode.ToLower(r[0])
		return string(r)
	}

	if idx == len(r) {
		return strings.ToLower(pascal)
	}

	// 如 UserID 已经不会走这里，如果是 IDList -> idList
	for i := 0; i < idx-1; i++ {
		r[i] = unicode.ToLower(r[i])
	}
	return string(r)
}

// ToSingular 极简英文单数化
func ToSingular(s string) string {
	lower := strings.ToLower(s)
	if strings.HasSuffix(lower, "ies") && len(lower) > 3 {
		return s[:len(s)-3] + "y"
	}
	if strings.HasSuffix(lower, "sses") && len(lower) > 4 {
		return s[:len(s)-2]
	}
	if strings.HasSuffix(lower, "s") && !strings.HasSuffix(lower, "ss") && len(lower) > 2 {
		return s[:len(s)-1]
	}
	return s
}

func splitIntoWords(s string) []string {
	var words []string
	var current []rune

	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		if c == '_' || c == '-' || c == ' ' || c == '.' {
			if len(current) > 0 {
				words = append(words, string(current))
				current = nil
			}
			continue
		}

		if unicode.IsUpper(c) {
			if len(current) > 0 {
				// 前一个如果不是大写，或者是大写但后一个是小写（如 IDList -> ID, List）
				prevIsLower := unicode.IsLower(runes[i-1])
				nextIsLower := i+1 < len(runes) && unicode.IsLower(runes[i+1])
				if prevIsLower || nextIsLower {
					words = append(words, string(current))
					current = nil
				}
			}
		}
		current = append(current, c)
	}
	if len(current) > 0 {
		words = append(words, string(current))
	}
	return words
}
