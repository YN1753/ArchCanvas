package generator

import (
	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"fmt"
	"strconv"
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

// goKeywords Go 语言保留关键字表与内置预声明标识符
var goKeywords = map[string]bool{
	"break": true, "default": true, "func": true, "interface": true, "select": true,
	"case": true, "defer": true, "go": true, "map": true, "struct": true,
	"chan": true, "else": true, "goto": true, "package": true, "switch": true,
	"const": true, "fallthrough": true, "if": true, "range": true, "type": true,
	"continue": true, "for": true, "import": true, "return": true, "var": true,
	"any": true, "bool": true, "byte": true, "comparable": true, "error": true,
	"float32": true, "float64": true, "int": true, "int8": true, "int16": true,
	"int32": true, "int64": true, "len": true, "make": true, "new": true,
	"nil": true, "panic": true, "rune": true, "string": true, "true": true, "false": true,
	"uint": true, "uint8": true, "uint16": true, "uint32": true, "uint64": true,
}

func isASCIIUpper(r rune) bool {
	return r >= 'A' && r <= 'Z'
}

func isASCIILower(r rune) bool {
	return r >= 'a' && r <= 'z'
}

func sanitizeSingleLineComment(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}

func sanitizeStructTagValue(s string) string {
	s = strings.ReplaceAll(s, "`", "")
	s = strings.ReplaceAll(s, `"`, "")
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}

func sanitizeColumnIdentifier(raw string) string {
	s := sanitizeStructTagValue(raw)
	s = strings.ReplaceAll(s, ";", "")
	if s == "" {
		return "col"
	}
	return s
}

// SafeFileStem 生成安全的 Go 源码文件名前缀（仅含 [a-z0-9_]，规避 ../ 目录穿越与 base.go 覆盖冲突）。
func SafeFileStem(raw string, fallbackIdx int) string {
	var b strings.Builder
	prevUnderscore := false
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevUnderscore = false
		} else if !prevUnderscore && b.Len() > 0 {
			b.WriteRune('_')
			prevUnderscore = true
		}
	}
	stem := strings.Trim(b.String(), "_")
	if stem == "" {
		stem = fmt.Sprintf("entity_%d", fallbackIdx)
	}
	if stem == "base" {
		stem = "base_entity"
	}
	if strings.HasSuffix(stem, "_test") {
		stem = stem + "_model"
	}
	return stem
}

// SafeRouteSegment 生成安全的 Gin 路由组路径段（剔除 / : * 等通配路由敏感字符）。
func SafeRouteSegment(raw string, fallback string) string {
	var b strings.Builder
	prevSep := false
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
			prevSep = false
		} else if !prevSep && b.Len() > 0 {
			b.WriteRune('_')
			prevSep = true
		}
	}
	seg := strings.Trim(b.String(), "_-")
	if seg == "" {
		return fallback
	}
	return seg
}

// SafeDBName 从模块名中提取合法的数据库库名（如 github.com/org/my-app -> my_app）。
func SafeDBName(moduleName string) string {
	clean := SafeModuleName(moduleName)
	if idx := strings.LastIndex(clean, "/"); idx >= 0 {
		clean = clean[idx+1:]
	}
	var b strings.Builder
	for _, r := range strings.ToLower(clean) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	res := strings.Trim(b.String(), "_")
	for strings.Contains(res, "__") {
		res = strings.ReplaceAll(res, "__", "_")
	}
	if res == "" || (res[0] >= '0' && res[0] <= '9') {
		return "app_" + res
	}
	return res
}

// SafePort 解析安全端口，返回监听地址（如 ":8080"）与纯数字端口号（如 "8080"）。
func SafePort(raw string) (listenAddr string, portNum string) {
	trimmed := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), ":"))
	if p, err := strconv.Atoi(trimmed); err == nil && p >= 1 && p <= 65535 {
		num := strconv.Itoa(p)
		return ":" + num, num
	}
	return ":8080", "8080"
}

// SafeFieldName 将属性名转换为合法的 Go 结构体导出字段名（强制首字符为 ASCII A-Z，兼容中文列名导出）。
func SafeFieldName(raw string) string {
	pascal := ToPascalCase(raw)
	if pascal == "" {
		return "Field"
	}
	r := []rune(pascal)
	if !isASCIIUpper(r[0]) {
		return "Field" + pascal
	}
	return pascal
}

// SafeStructName 将实体名转换为合法的 Go 导出结构体名称（强制首字符为 ASCII A-Z，兼容中文表名导出）。
func SafeStructName(raw string) string {
	pascal := ToPascalCase(raw)
	if pascal == "" {
		return "Model"
	}
	r := []rune(pascal)
	if !isASCIIUpper(r[0]) {
		return "Entity" + pascal
	}
	if pascal == "BaseModel" {
		return "BaseModelEntity"
	}
	return pascal
}

// SafeVarName 将实体名转换为合法的 Go 变量名 (避开 Go 关键字、中文与数字开头)
func SafeVarName(raw string) string {
	camel := ToCamelCase(raw)
	if camel == "" {
		return "item"
	}
	if goKeywords[camel] {
		return camel + "Item"
	}
	r := []rune(camel)
	if unicode.IsDigit(r[0]) {
		return "v" + camel
	}
	if !isASCIILower(r[0]) && !isASCIIUpper(r[0]) {
		return "item" + camel
	}
	return camel
}

// SafeModuleName 清洗并规范化 Go 模块名 (go.mod 中的 module name)
func SafeModuleName(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "app"
	}
	trimmed = strings.ReplaceAll(trimmed, " ", "-")
	var b strings.Builder
	for _, r := range trimmed {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == '/' {
			b.WriteRune(r)
		} else {
			b.WriteRune('-')
		}
	}
	res := strings.Trim(b.String(), "-./")
	for strings.Contains(res, "--") {
		res = strings.ReplaceAll(res, "--", "-")
	}
	for strings.Contains(res, "//") {
		res = strings.ReplaceAll(res, "//", "/")
	}
	if res == "" || strings.Contains(res, "..") {
		return "app"
	}
	return res
}

// ProjectContext 传递给代码生成模板的根上下文
type ProjectContext struct {
	ModuleName       string
	DBName           string
	Port             string
	PortNum          string
	DBDriver         string
	EnableRedis      bool
	EnableDocker     bool
	EnableSoftDelete bool
	Entities         []EntityData
}

// EntityData 实体模板视图模型
type EntityData struct {
	ID               string
	TableName        string
	TableNameLiteral string
	FileStem         string
	RoutePath        string
	StructName       string
	VarName          string
	PluralName       string
	Comment          string
	Indexes          []domain.IndexDefinition
	Attributes       []AttributeData
	PrimaryKey       AttributeData
	Associations     []AssociationData
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
	Comment      string
	Description  string
	GormTag      string
	JsonTag      string
}

// AssociationData GORM 关系关联视图模型
type AssociationData struct {
	Type      string
	FieldName string
	FieldType string
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
func BuildProjectContext(req dto.GenerateRequest, design *domain.ERDesign) ProjectContext {
	portAddr, portNum := SafePort(req.Port)

	driver := strings.ToLower(strings.TrimSpace(req.DBDriver))
	if driver != "postgres" && driver != "sqlite" {
		driver = "mysql"
	}

	modName := SafeModuleName(req.ModuleName)
	dbName := SafeDBName(modName)

	entityMap := make(map[string]EntityData, len(design.Entities)*2)
	usedStructNames := make(map[string]bool, len(design.Entities))
	usedVarNames := make(map[string]bool, len(design.Entities))
	usedFileStems := make(map[string]bool, len(design.Entities))
	usedRoutePaths := make(map[string]bool, len(design.Entities))

	for idx, ent := range design.Entities {
		eData := buildEntityData(ent, driver, idx+1)

		// 全局消歧：防止不同表（如 user 与 users，或多个中文表）生成重名的结构体、变量、文件名或路由组
		baseStruct := eData.StructName
		for n := 2; usedStructNames[strings.ToLower(eData.StructName)]; n++ {
			eData.StructName = fmt.Sprintf("%s%d", baseStruct, n)
		}
		usedStructNames[strings.ToLower(eData.StructName)] = true

		baseVar := eData.VarName
		for n := 2; usedVarNames[strings.ToLower(eData.VarName)]; n++ {
			eData.VarName = fmt.Sprintf("%s%d", baseVar, n)
		}
		usedVarNames[strings.ToLower(eData.VarName)] = true

		baseStem := eData.FileStem
		for n := 2; usedFileStems[eData.FileStem]; n++ {
			eData.FileStem = fmt.Sprintf("%s_%d", baseStem, n)
		}
		usedFileStems[eData.FileStem] = true

		baseRoute := eData.RoutePath
		for n := 2; usedRoutePaths[eData.RoutePath]; n++ {
			eData.RoutePath = fmt.Sprintf("%s_%d", baseRoute, n)
		}
		usedRoutePaths[eData.RoutePath] = true

		entityMap[ent.ID] = eData
		if ent.Name != "" {
			entityMap[strings.ToLower(strings.TrimSpace(ent.Name))] = eData
		}
	}

	// 匹配与推导关联关系（严格校验物理外键字段存在性，避免生成 GORM AutoMigrate 启动崩溃的悬空 foreignKey 标签）
	for _, rel := range design.Relations {
		sourceEnt, okSource := entityMap[rel.SourceEntityID]
		if !okSource {
			sourceEnt, okSource = entityMap[strings.ToLower(strings.TrimSpace(rel.SourceEntityID))]
		}
		targetEnt, okTarget := entityMap[rel.TargetEntityID]
		if !okTarget {
			targetEnt, okTarget = entityMap[strings.ToLower(strings.TrimSpace(rel.TargetEntityID))]
		}
		if !okSource || !okTarget {
			continue
		}

		// 0. 同实体自引用（仅当实体中确实存在 parent_id / pid 等自引用外键列时才注入自关联）
		if sourceEnt.ID == targetEnt.ID {
			fkFieldName := ""
			for _, a := range sourceEnt.Attributes {
				aLower := strings.ToLower(a.Name)
				if aLower == "parent_id" || aLower == "pid" {
					fkFieldName = a.FieldName
					break
				}
			}
			if fkFieldName == "" {
				for _, a := range sourceEnt.Attributes {
					if !a.IsPrimaryKey && strings.HasSuffix(strings.ToLower(a.Name), "_id") {
						fkFieldName = a.FieldName
						break
					}
				}
			}
			if fkFieldName == "" {
				continue
			}

			pkFieldName := sourceEnt.PrimaryKey.FieldName
			if pkFieldName == "" {
				pkFieldName = "ID"
			}

			addAssociationSafe(&sourceEnt, AssociationData{
				Type:      "HasMany",
				FieldName: "Children",
				FieldType: "[]" + sourceEnt.StructName,
				GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
				JsonTag:   `json:"children,omitempty"`,
			})

			addAssociationSafe(&sourceEnt, AssociationData{
				Type:      "BelongsTo",
				FieldName: "Parent",
				FieldType: "*" + sourceEnt.StructName,
				GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
				JsonTag:   `json:"parent,omitempty"`,
			})

			entityMap[sourceEnt.ID] = sourceEnt
			if sourceEnt.TableName != "" {
				entityMap[strings.ToLower(sourceEnt.TableName)] = sourceEnt
			}
			continue
		}

		// 1. 显式声明的多对多关联 (M:N / many_to_many)
		if isManyToMany(rel.Cardinality) || isManyToMany(rel.RelationTypeID) {
			junctionTable := SafeFileStem(sourceEnt.TableName+"_"+targetEnt.TableName, 1)
			addAssociationSafe(&sourceEnt, AssociationData{
				Type:      "ManyToMany",
				FieldName: SafeFieldName(targetEnt.TableName),
				FieldType: "[]" + targetEnt.StructName,
				GormTag:   fmt.Sprintf(`gorm:"many2many:%s;"`, junctionTable),
				JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(SafeFieldName(targetEnt.TableName))),
			})
			addAssociationSafe(&targetEnt, AssociationData{
				Type:      "ManyToMany",
				FieldName: SafeFieldName(sourceEnt.TableName),
				FieldType: "[]" + sourceEnt.StructName,
				GormTag:   fmt.Sprintf(`gorm:"many2many:%s;"`, junctionTable),
				JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(SafeFieldName(sourceEnt.TableName))),
			})

			entityMap[sourceEnt.ID] = sourceEnt
			entityMap[targetEnt.ID] = targetEnt
			if sourceEnt.TableName != "" {
				entityMap[strings.ToLower(sourceEnt.TableName)] = sourceEnt
			}
			if targetEnt.TableName != "" {
				entityMap[strings.ToLower(targetEnt.TableName)] = targetEnt
			}
			continue
		}

		// 2. 常规 1:N / 1:1 关联推导：寻找 targetEnt 上实际存在的外键字段
		fkFieldName := ""
		srcTableLower := strings.ToLower(sourceEnt.TableName)
		srcSingLower := strings.ToLower(ToSingular(sourceEnt.TableName))
		var genericFKCandidates []string

		for _, a := range targetEnt.Attributes {
			if a.IsPrimaryKey {
				continue
			}
			aLower := strings.ToLower(a.Name)
			if aLower == srcTableLower+"_id" || aLower == srcSingLower+"_id" {
				fkFieldName = a.FieldName
				break
			}
			if strings.HasSuffix(aLower, "_id") {
				genericFKCandidates = append(genericFKCandidates, a.FieldName)
			}
		}
		// 若使用了语义化别名外键（如 users -> articles.author_id）且该表仅有唯一一个 _id 外键列，智能绑定该列
		if fkFieldName == "" && len(genericFKCandidates) == 1 {
			fkFieldName = genericFKCandidates[0]
		}
		if fkFieldName == "" {
			continue
		}

		pkFieldName := sourceEnt.PrimaryKey.FieldName
		if pkFieldName == "" {
			pkFieldName = "ID"
		}

		hasManyName := SafeFieldName(targetEnt.TableName)
		addAssociationSafe(&sourceEnt, AssociationData{
			Type:      "HasMany",
			FieldName: hasManyName,
			FieldType: "[]" + targetEnt.StructName,
			GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(hasManyName)),
		})

		belongsToName := sourceEnt.StructName
		addAssociationSafe(&targetEnt, AssociationData{
			Type:      "BelongsTo",
			FieldName: belongsToName,
			FieldType: "*" + sourceEnt.StructName,
			GormTag:   fmt.Sprintf(`gorm:"foreignKey:%s;references:%s"`, fkFieldName, pkFieldName),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(belongsToName)),
		})

		entityMap[sourceEnt.ID] = sourceEnt
		entityMap[targetEnt.ID] = targetEnt
		if sourceEnt.TableName != "" {
			entityMap[strings.ToLower(sourceEnt.TableName)] = sourceEnt
		}
		if targetEnt.TableName != "" {
			entityMap[strings.ToLower(targetEnt.TableName)] = targetEnt
		}
	}

	// 3. 自动识别技术中间表拓扑结构，为两端主模型补全 many2many 关联
	applyJunctionTableManyToMany(design, entityMap)

	entities := make([]EntityData, 0, len(design.Entities))
	for _, ent := range design.Entities {
		if eData, ok := entityMap[ent.ID]; ok {
			entities = append(entities, eData)
		} else if eData, ok := entityMap[strings.ToLower(strings.TrimSpace(ent.Name))]; ok {
			entities = append(entities, eData)
		}
	}

	return ProjectContext{
		ModuleName:       modName,
		DBName:           dbName,
		Port:             portAddr,
		PortNum:          portNum,
		DBDriver:         driver,
		EnableRedis:      req.EnableRedis,
		EnableDocker:     req.EnableDocker,
		EnableSoftDelete: req.EnableSoftDelete,
		Entities:         entities,
	}
}

func addAssociationSafe(ent *EntityData, assoc AssociationData) {
	usedNames := map[string]bool{
		"id":        true,
		"createdat": true,
		"updatedat": true,
		"deletedat": true,
		"basemodel": true,
		"tablename": true,
	}

	for _, a := range ent.Attributes {
		usedNames[strings.ToLower(a.FieldName)] = true
	}

	for _, existing := range ent.Associations {
		if existing.Type == assoc.Type &&
			existing.FieldType == assoc.FieldType &&
			existing.GormTag == assoc.GormTag {
			return
		}
		usedNames[strings.ToLower(existing.FieldName)] = true
	}

	baseName := SafeFieldName(assoc.FieldName)
	if baseName == "" {
		baseName = "Relation"
	}
	fieldName := baseName
	counter := 2
	for usedNames[strings.ToLower(fieldName)] {
		fieldName = fmt.Sprintf("%s%d", baseName, counter)
		counter++
	}

	assoc.FieldName = fieldName
	assoc.JsonTag = fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(fieldName))
	ent.Associations = append(ent.Associations, assoc)
}

func isManyToMany(card string) bool {
	cardLower := strings.ToLower(strings.TrimSpace(card))
	return cardLower == "many_to_many" ||
		cardLower == "many-to-many" ||
		cardLower == "m:n" ||
		cardLower == "n:m" ||
		cardLower == "n:n" ||
		cardLower == "m:m"
}

type junctionTriplet struct {
	EntityA       EntityData
	JunctionTable EntityData
	EntityB       EntityData
}

func findReferencedEntityForAttr(attrName string, candidates map[string]EntityData) (EntityData, bool) {
	nameLower := strings.ToLower(strings.TrimSpace(attrName))
	if !strings.HasSuffix(nameLower, "_id") {
		return EntityData{}, false
	}
	prefix := strings.TrimSuffix(nameLower, "_id")
	for _, ent := range candidates {
		entTableLower := strings.ToLower(ent.TableName)
		entSingularLower := strings.ToLower(ToSingular(ent.TableName))
		if prefix == entTableLower || prefix == entSingularLower {
			return ent, true
		}
	}
	return EntityData{}, false
}

var junctionAuditFields = map[string]bool{
	"id": true, "created_at": true, "updated_at": true, "deleted_at": true,
	"create_time": true, "update_time": true, "created_by": true, "sort_order": true,
}

// detectJunctionTables 严格检测真正的多对多技术中间表（修复原先 || fewAttributes 将普通 <=7 列业务表全部误判为 many2many 的缺陷）。
func detectJunctionTables(design *domain.ERDesign, entityMap map[string]EntityData) []junctionTriplet {
	var triplets []junctionTriplet
	processed := make(map[string]bool)

	relationsByEntity := make(map[string][]string)
	for _, rel := range design.Relations {
		if strings.TrimSpace(rel.SourceEntityID) == "" || strings.TrimSpace(rel.TargetEntityID) == "" {
			continue
		}
		if rel.SourceEntityID == rel.TargetEntityID {
			continue
		}
		relationsByEntity[rel.SourceEntityID] = append(relationsByEntity[rel.SourceEntityID], rel.TargetEntityID)
		relationsByEntity[rel.TargetEntityID] = append(relationsByEntity[rel.TargetEntityID], rel.SourceEntityID)
	}

	for _, ent := range design.Entities {
		// 尊重用户显式配置 IsJunctionTable == false
		if ent.IsJunctionTable != nil && !*ent.IsJunctionTable {
			continue
		}

		entData, ok := entityMap[ent.ID]
		if !ok {
			continue
		}

		connectedMap := make(map[string]EntityData)
		fkAttrNames := make(map[string]bool)

		for _, attr := range ent.Attributes {
			if refEnt, matched := findReferencedEntityForAttr(attr.Name, entityMap); matched {
				if refEnt.ID != ent.ID {
					connectedMap[refEnt.ID] = refEnt
					fkAttrNames[strings.ToLower(strings.TrimSpace(attr.Name))] = true
				}
			}
		}

		for _, connID := range relationsByEntity[ent.ID] {
			if refEnt, matched := entityMap[connID]; matched {
				if refEnt.ID != ent.ID {
					connectedMap[refEnt.ID] = refEnt
				}
			}
		}

		if len(connectedMap) != 2 {
			continue
		}

		var connectedList []EntityData
		for _, c := range connectedMap {
			connectedList = append(connectedList, c)
		}
		entA := connectedList[0]
		entB := connectedList[1]
		if entA.ID == entB.ID {
			continue
		}

		isExplicit := ent.IsJunctionTable != nil && *ent.IsJunctionTable
		tableNameLower := strings.ToLower(ent.Name)
		nameA := strings.ToLower(entA.TableName)
		nameSingA := strings.ToLower(ToSingular(entA.TableName))
		nameB := strings.ToLower(entB.TableName)
		nameSingB := strings.ToLower(ToSingular(entB.TableName))

		nameMatches := (strings.Contains(tableNameLower, nameA) || strings.Contains(tableNameLower, nameSingA)) &&
			(strings.Contains(tableNameLower, nameB) || strings.Contains(tableNameLower, nameSingB))

		fewAttributes := len(ent.Attributes) <= 7
		bizCols := 0
		for _, attr := range ent.Attributes {
			lowerAttr := strings.ToLower(strings.TrimSpace(attr.Name))
			if attr.IsPrimaryKey || fkAttrNames[lowerAttr] || junctionAuditFields[lowerAttr] {
				continue
			}
			bizCols++
		}

		// 仅当显式指定为中间表，或者同时满足「复合关联表名 + 字段精简 + 无独立业务属性」时才识别为纯技术中间表
		if isExplicit || (nameMatches && fewAttributes && bizCols == 0) {
			key := fmt.Sprintf("%s-%s-%s", entA.ID, ent.ID, entB.ID)
			revKey := fmt.Sprintf("%s-%s-%s", entB.ID, ent.ID, entA.ID)
			if !processed[key] && !processed[revKey] {
				processed[key] = true
				processed[revKey] = true
				triplets = append(triplets, junctionTriplet{
					EntityA:       entA,
					JunctionTable: entData,
					EntityB:       entB,
				})
			}
		}
	}

	return triplets
}

func applyJunctionTableManyToMany(design *domain.ERDesign, entityMap map[string]EntityData) {
	triplets := detectJunctionTables(design, entityMap)
	for _, trip := range triplets {
		entA, okA := entityMap[trip.EntityA.ID]
		entB, okB := entityMap[trip.EntityB.ID]
		if !okA || !okB {
			continue
		}
		junctionTable := sanitizeStructTagValue(trip.JunctionTable.TableName)
		junctionTable = strings.ReplaceAll(junctionTable, ";", "")

		addAssociationSafe(&entA, AssociationData{
			Type:      "ManyToMany",
			FieldName: SafeFieldName(entB.TableName),
			FieldType: "[]" + entB.StructName,
			GormTag:   fmt.Sprintf(`gorm:"many2many:%s;"`, junctionTable),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(SafeFieldName(entB.TableName))),
		})

		addAssociationSafe(&entB, AssociationData{
			Type:      "ManyToMany",
			FieldName: SafeFieldName(entA.TableName),
			FieldType: "[]" + entA.StructName,
			GormTag:   fmt.Sprintf(`gorm:"many2many:%s;"`, junctionTable),
			JsonTag:   fmt.Sprintf(`json:"%s,omitempty"`, strings.ToLower(SafeFieldName(entA.TableName))),
		})

		entityMap[entA.ID] = entA
		entityMap[entB.ID] = entB
		if entA.TableName != "" {
			entityMap[strings.ToLower(entA.TableName)] = entA
		}
		if entB.TableName != "" {
			entityMap[strings.ToLower(entB.TableName)] = entB
		}
	}
}

type colIndexInfo struct {
	tag      string
	isUnique bool
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

func buildEntityData(ent domain.Entity, driver string, seq int) EntityData {
	tableName := sanitizeSingleLineComment(ent.Name)
	if tableName == "" {
		tableName = fmt.Sprintf("table_%d", seq)
	}
	fileStem := SafeFileStem(tableName, seq)
	routePath := SafeRouteSegment(tableName, fileStem)

	singular := ToSingular(tableName)
	structName := SafeStructName(singular)
	varName := SafeVarName(singular)
	pluralName := SafeStructName(tableName)

	colIndexesMap := make(map[string][]colIndexInfo)
	for _, idx := range ent.Indexes {
		idxName := sanitizeColumnIdentifier(idx.Name)
		if idxName == "" {
			continue
		}
		numCols := len(idx.Columns)
		for colIdx, col := range idx.Columns {
			cName := strings.ToLower(strings.TrimSpace(col))
			if cName == "" {
				continue
			}
			var tag string
			if numCols > 1 {
				if idx.IsUnique {
					tag = fmt.Sprintf("uniqueIndex:%s,priority:%d", idxName, colIdx+1)
				} else {
					tag = fmt.Sprintf("index:%s,priority:%d", idxName, colIdx+1)
				}
			} else {
				if idx.IsUnique {
					tag = fmt.Sprintf("uniqueIndex:%s", idxName)
				} else {
					tag = fmt.Sprintf("index:%s", idxName)
				}
			}
			colIndexesMap[cName] = append(colIndexesMap[cName], colIndexInfo{
				tag:      tag,
				isUnique: idx.IsUnique,
			})
		}
	}

	var attrs []AttributeData
	var primaryKey AttributeData
	// 预留 BaseModel 与 TableName() 方法名，防止生成同名结构体字段引发 Go 编译错误
	usedFieldNames := map[string]bool{
		"basemodel": true,
		"tablename": true,
	}

	for _, attr := range ent.Attributes {
		attrNameLower := strings.ToLower(strings.TrimSpace(attr.Name))
		idxInfos := colIndexesMap[attrNameLower]

		if (attrNameLower == "created_at" || attrNameLower == "updated_at" || attrNameLower == "deleted_at") && len(idxInfos) == 0 {
			continue
		}

		aData := buildAttributeData(attr, idxInfos, driver)

		baseField := aData.FieldName
		for n := 2; usedFieldNames[strings.ToLower(aData.FieldName)]; n++ {
			aData.FieldName = fmt.Sprintf("%s%d", baseField, n)
		}
		usedFieldNames[strings.ToLower(aData.FieldName)] = true

		attrs = append(attrs, aData)
		if attr.IsPrimaryKey && primaryKey.FieldName == "" && isSupportedPKGoType(aData.GoType) {
			primaryKey = aData
		}
	}

	// 若未找到显式主键，优先从已有字段中寻找整型/字符串列；若仍无（如纯审计字段表或首列为 time.Time/float64），自动补齐标准 ID 主键列，杜绝编译报错
	if primaryKey.FieldName == "" {
		for _, a := range attrs {
			if isSupportedPKGoType(a.GoType) {
				primaryKey = a
				break
			}
		}
	}
	if primaryKey.FieldName == "" {
		fieldName := "ID"
		for n := 2; usedFieldNames[strings.ToLower(fieldName)]; n++ {
			fieldName = fmt.Sprintf("ID%d", n)
		}
		defaultPK := AttributeData{
			Name:         "id",
			FieldName:    fieldName,
			DBType:       "BIGINT",
			GoType:       "uint64",
			IsPrimaryKey: true,
			GormTag:      `gorm:"primaryKey;column:id"`,
			JsonTag:      `json:"id"`,
		}
		attrs = append([]AttributeData{defaultPK}, attrs...)
		primaryKey = defaultPK
	}

	return EntityData{
		ID:               ent.ID,
		TableName:        tableName,
		TableNameLiteral: strconv.Quote(tableName),
		FileStem:         fileStem,
		RoutePath:        routePath,
		StructName:       structName,
		VarName:          varName,
		PluralName:       pluralName,
		Comment:          sanitizeSingleLineComment(ent.Comment),
		Indexes:          ent.Indexes,
		Attributes:       attrs,
		PrimaryKey:       primaryKey,
		Associations:     make([]AssociationData, 0),
	}
}

func normalizeGormDBType(dbType string, driver string) string {
	clean := sanitizeStructTagValue(dbType)
	clean = strings.ReplaceAll(clean, ";", "")
	lower := strings.ToLower(clean)
	if lower == "" {
		return ""
	}
	// PostgreSQL 对 MySQL 方言专属的 unsigned / tinyint / datetime / longtext 执行 DDL 时会直接语法报错，自动精准转换
	if driver == "postgres" {
		lower = strings.TrimSpace(strings.ReplaceAll(lower, "unsigned", ""))
		switch {
		case lower == "tinyint(1)":
			return "boolean"
		case strings.HasPrefix(lower, "tinyint"):
			return "smallint"
		case strings.HasPrefix(lower, "datetime"):
			return "timestamptz"
		case lower == "longtext" || lower == "mediumtext" || lower == "tinytext":
			return "text"
		case lower == "double":
			return "double precision"
		case strings.HasSuffix(lower, "blob"):
			return "bytea"
		}
	}
	return lower
}

func buildAttributeData(attr domain.Attribute, idxInfos []colIndexInfo, driver string) AttributeData {
	colName := sanitizeColumnIdentifier(attr.Name)
	fieldName := SafeFieldName(colName)
	// 主键列强制非空值类型，杜绝生成 *uint64 / *string 破坏仓储与路由绑定
	isNullable := attr.IsNullable && !attr.IsPrimaryKey
	goType := normalizeGoType(attr.CodeType, attr.DBType, isNullable)

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

	gormTagStr := fmt.Sprintf(`gorm:"%s"`, strings.Join(gormTags, ";"))
	jsonTagStr := fmt.Sprintf(`json:"%s"`, colName)

	return AttributeData{
		Name:         colName,
		FieldName:    fieldName,
		DBType:       attr.DBType,
		GoType:       goType,
		IsPrimaryKey: attr.IsPrimaryKey,
		IsNullable:   isNullable,
		IsUnique:     attr.IsUnique,
		Comment:      comment,
		Description:  desc,
		GormTag:      gormTagStr,
		JsonTag:      jsonTagStr,
	}
}

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
	"integer":         "int64",
	"bigint":          "int64",
	"long":            "int64",
	"short":           "int16",
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

func inferGoTypeFromDBType(dbType string) string {
	upperDB := strings.ToUpper(strings.TrimSpace(dbType))
	switch {
	case strings.Contains(upperDB, "TINYINT(1)"), strings.Contains(upperDB, "BOOL"):
		return "bool"
	case strings.Contains(upperDB, "BIGINT"):
		if strings.Contains(upperDB, "UNSIGNED") {
			return "uint64"
		}
		return "int64"
	case strings.Contains(upperDB, "TINYINT"):
		return "int8"
	case strings.Contains(upperDB, "SMALLINT"):
		return "int16"
	case strings.Contains(upperDB, "INT") && !strings.Contains(upperDB, "POINT") && !strings.Contains(upperDB, "INTERVAL"):
		if strings.Contains(upperDB, "UNSIGNED") {
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

// normalizeGoType 严格执行合法 Go 类型白名单校验与别名归一化，杜绝非法 code_type 导致生成工程编译失败。
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

// ToCamelCase 将名称转为 camelCase（正确处理 ID2 -> id2 与 IDList -> idList）
func ToCamelCase(s string) string {
	pascal := ToPascalCase(s)
	if len(pascal) == 0 {
		return ""
	}
	r := []rune(pascal)
	if len(r) == 1 {
		return strings.ToLower(pascal)
	}

	idx := 0
	for idx < len(r) && unicode.IsUpper(r[idx]) {
		idx++
	}

	if idx == 0 {
		return pascal
	}
	if idx == 1 {
		r[0] = unicode.ToLower(r[0])
		return string(r)
	}
	if idx == len(r) || !unicode.IsLower(r[idx]) {
		// 如 ID -> id，或 ID2 -> id2（大写序列后紧跟数字而非新单词小写字母）
		for i := 0; i < idx; i++ {
			r[i] = unicode.ToLower(r[i])
		}
		return string(r)
	}

	// 如 IDList -> idList（保留最后一个大写字母作为下一个单词首字母）
	for i := 0; i < idx-1; i++ {
		r[i] = unicode.ToLower(r[i])
	}
	return string(r)
}

var uncountableWords = map[string]bool{
	"status": true, "campus": true, "focus": true, "virus": true, "bonus": true, "corpus": true,
	"analysis": true, "basis": true, "diagnosis": true, "thesis": true, "crisis": true, "synopsis": true,
	"news": true, "series": true, "species": true, "media": true, "data": true, "meta": true,
}

// ToSingular 英文单数化（保护 status/analysis/news/series 等词尾，精确还原 boxes/batches/categories/statuses）
func ToSingular(s string) string {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	baseWord := lower
	if idx := strings.LastIndexAny(lower, "_- "); idx >= 0 {
		baseWord = lower[idx+1:]
	}
	if uncountableWords[baseWord] {
		return trimmed
	}
	if strings.HasSuffix(baseWord, "ies") && len(baseWord) > 3 {
		prev := baseWord[len(baseWord)-4]
		if prev == 'a' || prev == 'e' || prev == 'i' || prev == 'o' || prev == 'u' {
			return trimmed[:len(trimmed)-1]
		}
		return trimmed[:len(trimmed)-3] + "y"
	}
	if strings.HasSuffix(baseWord, "xes") || strings.HasSuffix(baseWord, "zes") ||
		strings.HasSuffix(baseWord, "ches") || strings.HasSuffix(baseWord, "shes") ||
		strings.HasSuffix(baseWord, "sses") || strings.HasSuffix(baseWord, "uses") {
		if len(baseWord) > 3 {
			return trimmed[:len(trimmed)-2]
		}
	}
	if strings.HasSuffix(baseWord, "ses") && len(baseWord) > 4 {
		stem := baseWord[:len(baseWord)-2]
		if uncountableWords[stem] || strings.HasSuffix(stem, "s") {
			return trimmed[:len(trimmed)-2]
		}
		return trimmed[:len(trimmed)-1]
	}
	if strings.HasSuffix(baseWord, "s") &&
		!strings.HasSuffix(baseWord, "ss") &&
		!strings.HasSuffix(baseWord, "us") &&
		!strings.HasSuffix(baseWord, "is") &&
		len(baseWord) > 1 {
		return trimmed[:len(trimmed)-1]
	}
	return trimmed
}

func splitIntoWords(s string) []string {
	var words []string
	var current []rune

	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		if !unicode.IsLetter(c) && !unicode.IsDigit(c) {
			if len(current) > 0 {
				words = append(words, string(current))
				current = nil
			}
			continue
		}

		if unicode.IsUpper(c) {
			if len(current) > 0 {
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
