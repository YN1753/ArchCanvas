package generator

import (
	"fmt"
	"strings"

	"archcanvas/internal/dialect"
	"archcanvas/internal/domain"
)

var validGoScalarTypes = map[string]bool{
	"string": true, "bool": true,
	"int": true, "int8": true, "int16": true, "int32": true, "int64": true,
	"uint": true, "uint8": true, "uint16": true, "uint32": true, "uint64": true,
	"float32": true, "float64": true,
	"time.Time": true, "[]byte": true,
}

var goTypeAliases = map[string]string{
	"boolean":         "bool",
	"number":          "float64",
	"decimal":         "float64",
	"decimal.decimal": "float64",
	"numeric":         "float64",
	"float":           "float64",
	"double":          "float64",
	"integer":         "int",
	"mediumint":       "int",
	"serial":          "int",
	"bigint":          "int64",
	"bigserial":       "int64",
	"long":            "int64",
	"short":           "int16",
	"smallint":        "int16",
	"smallserial":     "int16",
	"tinyint":         "int8",
	"datetime":        "time.Time",
	"timestamp":       "time.Time",
	"timestamptz":     "time.Time",
	"date":            "time.Time",
	"time":            "time.Time",
	"uuid":            "string",
	"uuid.uuid":       "string",
	"varchar":         "string",
	"text":            "string",
	"char":            "string",
	"enum":            "string",
	"json":            "string",
	"json.rawmessage": "string",
	"bytes":           "[]byte",
	"blob":            "[]byte",
	"binary":          "[]byte",
	"bytea":           "[]byte",
}

func isSupportedPKGoType(goType string) bool {
	switch goType {
	case "uint", "uint8", "uint16", "uint32", "uint64",
		"int", "int8", "int16", "int32", "int64",
		"string":
		return true
	default:
		return false
	}
}

func inferGoTypeFromDBType(dbType string) string {
	upperDB := strings.ToUpper(strings.TrimSpace(dbType))
	isUnsigned := strings.Contains(upperDB, "UNSIGNED")
	switch {
	case strings.Contains(upperDB, "TINYINT(1)"), strings.Contains(upperDB, "BOOL"):
		return "bool"
	case strings.Contains(upperDB, "BIGINT"), strings.Contains(upperDB, "BIGSERIAL"):
		if isUnsigned {
			return "uint64"
		}
		return "int64"
	case strings.Contains(upperDB, "TINYINT"):
		if isUnsigned {
			return "uint8"
		}
		return "int8"
	case strings.Contains(upperDB, "SMALLINT"), strings.Contains(upperDB, "SMALLSERIAL"):
		if isUnsigned {
			return "uint16"
		}
		return "int16"
	case (strings.Contains(upperDB, "INT") && !strings.Contains(upperDB, "POINT") && !strings.Contains(upperDB, "INTERVAL")) || strings.Contains(upperDB, "SERIAL"):
		if isUnsigned {
			return "uint"
		}
		return "int"
	case strings.Contains(upperDB, "TIME"), strings.Contains(upperDB, "DATE"):
		return "time.Time"
	case strings.Contains(upperDB, "DECIMAL"), strings.Contains(upperDB, "NUMERIC"), strings.Contains(upperDB, "FLOAT"), strings.Contains(upperDB, "DOUBLE"), strings.Contains(upperDB, "REAL"):
		return "float64"
	case strings.Contains(upperDB, "BLOB"), strings.Contains(upperDB, "BINARY"), strings.Contains(upperDB, "BYTEA"):
		return "[]byte"
	default:
		return "string"
	}
}

// normalizeGoType validates Go scalar types against whitelist and maps common aliases or DB types safely.
func normalizeGoType(codeType, dbType string, isNullable bool) string {
	raw := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(codeType), "*"))
	if raw == "" {
		raw = inferGoTypeFromDBType(dbType)
	} else if !validGoScalarTypes[raw] {
		if mapped, ok := goTypeAliases[strings.ToLower(raw)]; ok {
			raw = mapped
		} else {
			raw = inferGoTypeFromDBType(dbType)
		}
	}

	if isNullable && !strings.HasPrefix(raw, "*") && !strings.HasPrefix(raw, "[]") {
		return "*" + raw
	}
	return raw
}

func normalizeGormDBType(dbType string, driver string) string {
	clean := sanitizeStructTagValue(dbType)
	clean = strings.ReplaceAll(clean, ";", "")
	lower := strings.ToLower(clean)
	if lower == "" {
		return ""
	}
	spec := dialect.Get(driver)
	if spec.NormalizeGormType != nil {
		return spec.NormalizeGormType(lower)
	}
	return lower
}

func buildGormTag(attr domain.Attribute, colName string, isNullable bool, idxInfos []colIndexInfo, driver string) string {
	var gormTags []string
	if attr.IsPrimaryKey {
		gormTags = append(gormTags, "primaryKey")
	}
	gormTags = append(gormTags, fmt.Sprintf("column:%s", colName))

	if normType := normalizeGormDBType(attr.DBType, driver); normType != "" {
		gormTags = append(gormTags, fmt.Sprintf("type:%s", normType))
	}
	if !isNullable && !attr.IsPrimaryKey {
		gormTags = append(gormTags, "not null")
	}

	hasUniqueIndex := false
	for _, info := range idxInfos {
		if info.tag != "" {
			gormTags = append(gormTags, info.tag)
		}
		if info.isUnique {
			hasUniqueIndex = true
		}
	}

	if attr.IsUnique && !hasUniqueIndex {
		gormTags = append(gormTags, "unique")
	}

	attrLower := strings.ToLower(colName)
	if attrLower == "created_at" {
		gormTags = append(gormTags, "autoCreateTime")
	} else if attrLower == "updated_at" {
		gormTags = append(gormTags, "autoUpdateTime")
	}

	comment := sanitizeSingleLineComment(attr.Comment)
	desc := sanitizeSingleLineComment(attr.Description)
	tagComment := comment
	if tagComment == "" {
		tagComment = desc
	}
	if tagComment != "" {
		cleanComment := strings.ReplaceAll(sanitizeStructTagValue(tagComment), ";", ",")
		if cleanComment != "" {
			gormTags = append(gormTags, fmt.Sprintf("comment:%s", cleanComment))
		}
	}

	return fmt.Sprintf(`gorm:"%s"`, strings.Join(gormTags, ";"))
}

func buildBindingTag(attr domain.Attribute, isNullable bool) string {
	if attr.IsPrimaryKey || isNullable {
		return ""
	}
	return `binding:"required"`
}

func buildAttributeData(attr domain.Attribute, idxInfos []colIndexInfo, driver string) FieldTemplateData {
	colName := sanitizeColumnIdentifier(attr.Name)
	fieldName := SafeFieldName(colName)
	isNullable := attr.IsNullable && !attr.IsPrimaryKey
	goType := normalizeGoType(attr.CodeType, attr.DBType, isNullable)

	comment := sanitizeSingleLineComment(attr.Comment)
	desc := sanitizeSingleLineComment(attr.Description)

	return FieldTemplateData{
		Name:         colName,
		FieldName:    fieldName,
		DBType:       attr.DBType,
		GoType:       goType,
		IsPrimaryKey: attr.IsPrimaryKey,
		IsNullable:   isNullable,
		IsUnique:     attr.IsUnique,
		Comment:      comment,
		Description:  desc,
		GormTag:      buildGormTag(attr, colName, isNullable, idxInfos, driver),
		JsonTag:      fmt.Sprintf(`json:"%s"`, colName),
		BindingTag:   buildBindingTag(attr, isNullable),
	}
}
