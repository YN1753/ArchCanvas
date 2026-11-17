package validator

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"archcanvas/internal/domain"
)

// ValidationError 表示客户端请求参数或领域规则校验失败（映射为 HTTP 400）。
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string {
	return e.Message
}

func NewValidationError(format string, args ...any) error {
	return &ValidationError{Message: fmt.Sprintf(format, args...)}
}

func IsValidationError(err error) bool {
	var target *ValidationError
	return errors.As(err, &target)
}

var (
	providerNameRe = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,32}$`)
	sqlIdentRe     = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]{0,127}$`)
)

// ValidateProviderName 校验模型提供商标识，防止配置键注入或路径污染。
func ValidateProviderName(provider string) error {
	trimmed := strings.TrimSpace(provider)
	if trimmed == "" {
		return NewValidationError("provider 不能为空")
	}
	if !providerNameRe.MatchString(trimmed) {
		return NewValidationError("provider %q 格式非法，仅允许字母、数字、下划线与连字符（长度 1~32）", provider)
	}
	return nil
}

// ValidateSingleLine 校验单行文本输入，拒绝换行控制字符并限制最大字符数。
func ValidateSingleLine(fieldName, val string, maxRunes int) error {
	if strings.ContainsAny(val, "\r\n\x00") {
		return NewValidationError("%s 包含非法的换行或控制字符", fieldName)
	}
	if maxRunes > 0 && utf8.RuneCountInString(val) > maxRunes {
		return NewValidationError("%s 长度超出上限（最大 %d 字符）", fieldName, maxRunes)
	}
	return nil
}

// ValidateRequiredText 校验去空白后非空且符合长度上限。
func ValidateRequiredText(fieldName, val string, maxRunes int) (string, error) {
	trimmed := strings.TrimSpace(val)
	if trimmed == "" {
		return "", NewValidationError("%s 不能为空", fieldName)
	}
	if maxRunes > 0 && utf8.RuneCountInString(trimmed) > maxRunes {
		return "", NewValidationError("%s 长度超出上限（最大 %d 字符）", fieldName, maxRunes)
	}
	return trimmed, nil
}

// ValidateSQLIdentifier 校验严格 ASCII SQL 标识符。
func ValidateSQLIdentifier(ident string) error {
	if !sqlIdentRe.MatchString(ident) {
		return NewValidationError("标识符 %q 非法，仅允许字母或下划线开头并由字母、数字、下划线组成", ident)
	}
	return nil
}

// ValidateERDesignInput 校验保存物理 ER 设计时的实体、字段与关联完整性。
func ValidateERDesignInput(entities []domain.Entity, relations []domain.Relation) error {
	if len(entities) > 500 {
		return NewValidationError("单项目数据表数量超出上限（最大 500 张）")
	}

	seenEntityNames := make(map[string]struct{}, len(entities))
	for i, ent := range entities {
		entName := strings.TrimSpace(ent.Name)
		if entName == "" {
			return NewValidationError("第 %d 张数据表名称不能为空", i+1)
		}
		if err := ValidateSingleLine("数据表名称", entName, 128); err != nil {
			return err
		}
		if strings.ContainsAny(entName, `/\..`) && (strings.Contains(entName, "..") || strings.ContainsAny(entName, `/\`)) {
			return NewValidationError("数据表名称 %q 包含非法路径字符", entName)
		}

		lowerEnt := strings.ToLower(entName)
		if _, dup := seenEntityNames[lowerEnt]; dup {
			return NewValidationError("存在重复的数据表名称: %q", entName)
		}
		seenEntityNames[lowerEnt] = struct{}{}

		if ent.Position != nil {
			if math.IsNaN(ent.Position.X) || math.IsInf(ent.Position.X, 0) ||
				math.IsNaN(ent.Position.Y) || math.IsInf(ent.Position.Y, 0) {
				return NewValidationError("数据表 %q 坐标包含非法的 NaN 或 Infinity 数值", entName)
			}
		}

		if len(ent.Attributes) > 500 {
			return NewValidationError("数据表 %q 字段数量超出上限（最大 500 列）", entName)
		}

		seenAttrNames := make(map[string]struct{}, len(ent.Attributes))
		for j, attr := range ent.Attributes {
			attrName := strings.TrimSpace(attr.Name)
			if attrName == "" {
				return NewValidationError("数据表 %q 的第 %d 个字段名称不能为空", entName, j+1)
			}
			if err := ValidateSingleLine("字段名称", attrName, 128); err != nil {
				return err
			}
			lowerAttr := strings.ToLower(attrName)
			if _, dup := seenAttrNames[lowerAttr]; dup {
				return NewValidationError("数据表 %q 中存在重复的字段名称: %q", entName, attrName)
			}
			seenAttrNames[lowerAttr] = struct{}{}
		}
	}

	if len(relations) > 2000 {
		return NewValidationError("单项目关联关系数量超出上限（最大 2000 条）")
	}
	for i, rel := range relations {
		if strings.TrimSpace(rel.SourceEntityID) == "" || strings.TrimSpace(rel.TargetEntityID) == "" {
			return NewValidationError("第 %d 条关联关系的源实体或目标实体不能为空", i+1)
		}
	}

	return nil
}
