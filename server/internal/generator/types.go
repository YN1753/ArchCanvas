package generator

import (
	"context"

	"archcanvas/internal/domain"
)

// ERDesignReader defines the minimal consumer interface required by GeneratorService to load a project's ER schema.
type ERDesignReader interface {
	GetERDesign(ctx context.Context, projectID string) (*domain.ERDesign, error)
}

// ProjectTemplateData holds root template view-model metadata for generating a full Go backend scaffold.
type ProjectTemplateData struct {
	ModuleName       string
	DBName           string
	Port             string
	PortNum          string
	DBDriver         string
	GormDriverImport string
	GormDriverModule string
	GormOpenExpr     string
	DefaultDSN       string
	EnableRedis      bool
	EnableDocker     bool
	EnableSoftDelete bool
	Entities         []EntityTemplateData
}

// ProjectContext aliases ProjectTemplateData for backward compatibility.
type ProjectContext = ProjectTemplateData

// EntityTemplateData holds per-entity template view-model metadata.
type EntityTemplateData struct {
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
	Attributes       []FieldTemplateData
	PrimaryKey       FieldTemplateData
	Associations     []AssocFieldData
}

// EntityData aliases EntityTemplateData for backward compatibility.
type EntityData = EntityTemplateData

// FieldTemplateData holds per-column template view-model metadata.
type FieldTemplateData struct {
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
	BindingTag   string
}

// AttributeData aliases FieldTemplateData for backward compatibility.
type AttributeData = FieldTemplateData

// AssocFieldData holds GORM association field view-model metadata.
type AssocFieldData struct {
	Type      string
	FieldName string
	FieldType string
	GormTag   string
	JsonTag   string
}

// AssociationData aliases AssocFieldData for backward compatibility.
type AssociationData = AssocFieldData

// EntityRenderContext is passed to entity-scoped templates (model, repo, service, handler).
type EntityRenderContext struct {
	ModuleName string
	Entity     EntityTemplateData
	HasTime    bool
}

// GeneratedFile describes a single rendered file in the generated project tree.
type GeneratedFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Size    int    `json:"size"`
}

type colIndexInfo struct {
	tag      string
	isUnique bool
}
