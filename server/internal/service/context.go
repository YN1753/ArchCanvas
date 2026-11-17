package service

import (
	"encoding/json"
	"strings"

	"archcanvas/internal/domain"
	"archcanvas/internal/model"
)

// 类型别名重新导出，保持包内与测试调用简洁一致
type ConceptOperation = domain.ConceptOperation

const (
	OpCreate = domain.OpCreate
	OpModify = domain.OpModify
	OpRetain = domain.OpRetain
	OpDelete = domain.OpDelete
)

type ConceptCardinality = domain.ConceptCardinality

const (
	CardOneToOne   = domain.CardOneToOne
	CardOneToMany  = domain.CardOneToMany
	CardManyToMany = domain.CardManyToMany
)

type AttributeCategory = domain.AttributeCategory

const (
	AttrString   = domain.AttrString
	AttrNumber   = domain.AttrNumber
	AttrBoolean  = domain.AttrBoolean
	AttrDateTime = domain.AttrDateTime
	AttrEnum     = domain.AttrEnum
	AttrMedia    = domain.AttrMedia
)

// RequirementInput 需求分析算子的输入契约
type RequirementInput struct {
	ProjectID               string                   `json:"project_id"`
	Message                 string                   `json:"message"`
	HistoryMessages         []model.Message          `json:"history_messages,omitempty"`
	CurrentConceptualDesign *domain.ConceptualDesign `json:"current_conceptual_design,omitempty"`
	CurrentERDesign         *domain.ERDesign         `json:"current_er_design,omitempty"`
	Constraints             []string                 `json:"constraints,omitempty"`
	Decisions               []string                 `json:"decisions,omitempty"`
	ModelProvider           string                   `json:"model_provider,omitempty"`
	ModelName               string                   `json:"model_name,omitempty"`
}

// RequirementOutput 需求分析算子的纯净业务结构化输出契约
type RequirementOutput struct {
	Summary             string                     `json:"summary" jsonschema:"description=需求理解与概念模型设计的业务摘要"`
	Concepts            []domain.BusinessConcept   `json:"concepts" jsonschema:"description=梳理出的业务概念模型列表"`
	Relations           []domain.ConceptRelation   `json:"relations" jsonschema:"description=概念之间的关联关系"`
	Assumptions         []string                   `json:"assumptions,omitempty" jsonschema:"description=推断出的业务假设"`
	NegativeConstraints []string                   `json:"negative_constraints,omitempty" jsonschema:"description=识别出的明确业务边界与非需求"`
	NeedClarification   bool                       `json:"need_clarification" jsonschema:"description=需求是否存在重大歧义导致无法确定设计"`
	ClarificationCards  []domain.ClarificationCard `json:"clarification_cards,omitempty" jsonschema:"description=宏观广泛需求下按逻辑递进排列的澄清确认卡片组"`
	Questions           []string                   `json:"questions,omitempty" jsonschema:"description=需要用户进一步澄清确认的问题"`
}

// SchemaDesignInput 物理建模算子的输入契约
type SchemaDesignInput struct {
	Requirement     *RequirementOutput `json:"requirement"`
	CurrentERDesign *domain.ERDesign   `json:"current_er_design,omitempty"`
	ModelProvider   string             `json:"model_provider,omitempty"`
	ModelName       string             `json:"model_name,omitempty"`
}

// DerivePhysicalInput Layer 2 物理工程推导算子的输入契约
type DerivePhysicalInput struct {
	ProjectID        string                   `json:"project_id"`
	Dialect          string                   `json:"dialect"` // "mysql" | "postgres" | "sqlite"
	ConceptualDesign *domain.ConceptualDesign `json:"conceptual_design"`
	CurrentERDesign  *domain.ERDesign         `json:"current_er_design,omitempty"`
	ModelProvider    string                   `json:"model_provider,omitempty"`
	ModelName        string                   `json:"model_name,omitempty"`
}

// ReviewSchemaInput Layer 3 架构审查算子的输入契约
type ReviewSchemaInput struct {
	ProjectID       string           `json:"project_id"`
	Dialect         string           `json:"dialect"`
	CurrentERDesign *domain.ERDesign `json:"current_er_design"`
	ModelProvider   string           `json:"model_provider,omitempty"`
	ModelName       string           `json:"model_name,omitempty"`
}

const maxPromptContextChars = 48000

func truncateRunes(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes]) + "\n...(已超出上下文预算，省略尾部内容)"
}

// compactConceptualForPrompt 剥离 UI 坐标与内部冗余 UUID，压缩概念模型 Token 开销。
func compactConceptualForPrompt(cd *domain.ConceptualDesign) string {
	if cd == nil || len(cd.Concepts) == 0 {
		return ""
	}
	type compactAttr struct {
		Name          string                   `json:"name"`
		DisplayName   string                   `json:"display_name,omitempty"`
		Category      domain.AttributeCategory `json:"category"`
		IsBusinessKey bool                     `json:"is_business_key,omitempty"`
		Required      bool                     `json:"required,omitempty"`
		IsUnique      bool                     `json:"is_unique,omitempty"`
	}
	type compactConcept struct {
		Name        string        `json:"name"`
		DisplayName string        `json:"display_name,omitempty"`
		Description string        `json:"description,omitempty"`
		Attributes  []compactAttr `json:"attributes,omitempty"`
	}
	type compactRel struct {
		Name          string                    `json:"name,omitempty"`
		SourceConcept string                    `json:"source_concept"`
		TargetConcept string                    `json:"target_concept"`
		Cardinality   domain.ConceptCardinality `json:"cardinality"`
	}
	out := struct {
		Summary   string           `json:"summary,omitempty"`
		Concepts  []compactConcept `json:"concepts"`
		Relations []compactRel     `json:"relations,omitempty"`
	}{
		Summary:  cd.Summary,
		Concepts: make([]compactConcept, 0, len(cd.Concepts)),
	}
	for _, c := range cd.Concepts {
		attrs := make([]compactAttr, 0, len(c.Attributes))
		for _, a := range c.Attributes {
			attrs = append(attrs, compactAttr{
				Name:          a.Name,
				DisplayName:   a.DisplayName,
				Category:      a.Category,
				IsBusinessKey: a.IsBusinessKey,
				Required:      a.Required,
				IsUnique:      a.IsUnique,
			})
		}
		out.Concepts = append(out.Concepts, compactConcept{
			Name:        c.Name,
			DisplayName: c.DisplayName,
			Description: c.Description,
			Attributes:  attrs,
		})
	}
	for _, r := range cd.Relations {
		out.Relations = append(out.Relations, compactRel{
			Name:          r.Name,
			SourceConcept: r.SourceConcept,
			TargetConcept: r.TargetConcept,
			Cardinality:   r.Cardinality,
		})
	}
	b, err := json.Marshal(out)
	if err != nil {
		return ""
	}
	return truncateRunes(string(b), maxPromptContextChars)
}

// compactERForPrompt 剥离节点坐标与属性内部 UUID，保留表名、注释、类型、约束、索引与关联拓扑。
func compactERForPrompt(er *domain.ERDesign) string {
	if er == nil || len(er.Entities) == 0 {
		return ""
	}
	type compactCol struct {
		Name         string `json:"name"`
		Comment      string `json:"comment,omitempty"`
		DBType       string `json:"db_type"`
		IsPrimaryKey bool   `json:"is_primary_key,omitempty"`
		IsNullable   bool   `json:"is_nullable,omitempty"`
		IsUnique     bool   `json:"is_unique,omitempty"`
	}
	type compactTable struct {
		Name            string                   `json:"name"`
		Comment         string                   `json:"comment,omitempty"`
		Attributes      []compactCol             `json:"attributes"`
		Indexes         []domain.IndexDefinition `json:"indexes,omitempty"`
		IsJunctionTable *bool                    `json:"is_junction_table,omitempty"`
	}
	type compactRel struct {
		Source      string `json:"source"`
		Target      string `json:"target"`
		Cardinality string `json:"cardinality"`
	}

	idToName := make(map[string]string, len(er.Entities))
	for _, e := range er.Entities {
		idToName[e.ID] = e.Name
	}

	out := struct {
		Entities  []compactTable `json:"entities"`
		Relations []compactRel   `json:"relations,omitempty"`
	}{
		Entities: make([]compactTable, 0, len(er.Entities)),
	}

	for _, e := range er.Entities {
		cols := make([]compactCol, 0, len(e.Attributes))
		for _, a := range e.Attributes {
			cols = append(cols, compactCol{
				Name:         a.Name,
				Comment:      a.Comment,
				DBType:       a.DBType,
				IsPrimaryKey: a.IsPrimaryKey,
				IsNullable:   a.IsNullable,
				IsUnique:     a.IsUnique,
			})
		}
		out.Entities = append(out.Entities, compactTable{
			Name:            e.Name,
			Comment:         e.Comment,
			Attributes:      cols,
			Indexes:         e.Indexes,
			IsJunctionTable: e.IsJunctionTable,
		})
	}
	for _, r := range er.Relations {
		src := idToName[r.SourceEntityID]
		if src == "" {
			src = r.SourceEntityID
		}
		tgt := idToName[r.TargetEntityID]
		if tgt == "" {
			tgt = r.TargetEntityID
		}
		card := strings.TrimSpace(r.Cardinality)
		if card == "" {
			card = r.RelationTypeID
		}
		out.Relations = append(out.Relations, compactRel{
			Source:      src,
			Target:      tgt,
			Cardinality: card,
		})
	}

	b, err := json.Marshal(out)
	if err != nil {
		return ""
	}
	return truncateRunes(string(b), maxPromptContextChars)
}
