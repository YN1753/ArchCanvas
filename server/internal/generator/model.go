package generator

import (
	"fmt"
	"strconv"
	"strings"

	"archcanvas/internal/dialect"
	"archcanvas/internal/domain"
	"archcanvas/internal/dto"
	"archcanvas/pkg/naming"
)

// BuildTemplateData orchestrates conversion of an ERDesign and GenerateRequest into a complete ProjectTemplateData view-model.
func BuildTemplateData(req dto.GenerateRequest, design *domain.ERDesign) ProjectTemplateData {
	portAddr, portNum := SafePort(req.Port)
	spec := dialect.Get(req.DBDriver)
	driver := spec.ID

	modName := SafeModuleName(req.ModuleName)
	dbName := SafeDBName(modName)

	entityMap := make(map[string]EntityTemplateData, len(design.Entities)*2)
	usedStructNames := make(map[string]bool, len(design.Entities))
	usedVarNames := make(map[string]bool, len(design.Entities))
	usedFileStems := make(map[string]bool, len(design.Entities))
	usedRoutePaths := make(map[string]bool, len(design.Entities))

	for idx, ent := range design.Entities {
		eData := buildEntityData(ent, driver, idx+1)

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

	applyRelationAssociations(design, entityMap)
	applyJunctionTableManyToMany(design, entityMap)

	entities := make([]EntityTemplateData, 0, len(design.Entities))
	for _, ent := range design.Entities {
		if eData, ok := entityMap[ent.ID]; ok {
			entities = append(entities, eData)
		} else if eData, ok := entityMap[strings.ToLower(strings.TrimSpace(ent.Name))]; ok {
			entities = append(entities, eData)
		}
	}

	return ProjectTemplateData{
		ModuleName:       modName,
		DBName:           dbName,
		Port:             portAddr,
		PortNum:          portNum,
		DBDriver:         driver,
		GormDriverImport: spec.GormDriverImport,
		GormDriverModule: spec.GormDriverModule,
		GormOpenExpr:     spec.OpenExpr("cfg.DSN"),
		DefaultDSN:       spec.DefaultDSN(dbName),
		EnableRedis:      req.EnableRedis,
		EnableDocker:     req.EnableDocker,
		EnableSoftDelete: req.EnableSoftDelete,
		Entities:         entities,
	}
}

// BuildProjectContext preserves backward compatibility as an alias for BuildTemplateData.
func BuildProjectContext(req dto.GenerateRequest, design *domain.ERDesign) ProjectContext {
	return BuildTemplateData(req, design)
}

func buildEntityData(ent domain.Entity, driver string, seq int) EntityTemplateData {
	tableName := sanitizeSingleLineComment(ent.Name)
	if tableName == "" {
		tableName = fmt.Sprintf("table_%d", seq)
	}
	fileStem := SafeFileStem(tableName, seq)
	routePath := SafeRouteSegment(tableName, fileStem)

	singular := naming.Singularize(tableName)
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

	var attrs []FieldTemplateData
	var primaryKey FieldTemplateData
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
		defaultPK := FieldTemplateData{
			Name:         "id",
			FieldName:    fieldName,
			DBType:       "BIGINT",
			GoType:       "uint64",
			IsPrimaryKey: true,
			GormTag:      `gorm:"primaryKey;column:id"`,
			JsonTag:      `json:"id"`,
		}
		attrs = append([]FieldTemplateData{defaultPK}, attrs...)
		primaryKey = defaultPK
	}

	return EntityTemplateData{
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
		Associations:     make([]AssocFieldData, 0),
	}
}
