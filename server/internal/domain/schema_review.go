package domain

// SchemaIssueSeverity 架构隐患的严重等级
type SchemaIssueSeverity string

const (
	SeverityCritical SchemaIssueSeverity = "critical"
	SeverityWarning  SchemaIssueSeverity = "warning"
	SeverityInfo     SchemaIssueSeverity = "info"
)

// SchemaIssueCategory 架构隐患的检查类别
type SchemaIssueCategory string

const (
	CategoryIndex         SchemaIssueCategory = "index"
	CategoryNormalization SchemaIssueCategory = "normalization"
	CategoryNaming        SchemaIssueCategory = "naming"
	CategoryPerformance   SchemaIssueCategory = "performance"
	CategoryTypeSafety    SchemaIssueCategory = "type_safety"
)

// SchemaIssue 架构体检中检测出的单个具体问题
type SchemaIssue struct {
	ID          string              `json:"id"`
	Category    SchemaIssueCategory `json:"category"`
	Severity    SchemaIssueSeverity `json:"severity"`
	Title       string              `json:"title"`
	Description string              `json:"description"`
	EntityName  string              `json:"entity_name,omitempty"`
	ColumnName  string              `json:"column_name,omitempty"`
	Suggestion  string              `json:"suggestion"`
}

// SchemaReviewReport 首席数据架构师对物理数据表生成的质量体检报告
type SchemaReviewReport struct {
	Score       int           `json:"score"`        // 架构体检总分 0-100
	Summary     string        `json:"summary"`      // 总体评估与架构师评语
	PassedCount int           `json:"passed_count"` // 达标检查项数
	TotalCount  int           `json:"total_count"`  // 总检查项数
	Issues      []SchemaIssue `json:"issues"`       // 发现的风险隐患与改进建议
}
