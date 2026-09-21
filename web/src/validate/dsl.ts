import { z } from 'zod'

import type { ERDesign } from '../types/dsl'

/**
 * 前端校验是后端 `ValidateERDesign` 的镜像。
 *
 * 目的只是「即时反馈」，不是权威判定：真正决定能不能落库的始终是后端。
 * 因此这里刻意保持与后端一致的规则与措辞，避免出现前端说没问题、后端拒绝的割裂体验。
 */

export const ER_DESIGN_INVALID = 'er design is invalid'

const cardinalitySchema = z.enum(['one_to_one', 'one_to_many', 'many_to_many'])

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const attributeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  db_type: z.string().min(1),
  code_type: z.string(),
  is_primary_key: z.boolean(),
  is_nullable: z.boolean(),
  is_unique: z.boolean(),
  default_value: z.unknown().optional(),
  description: z.string(),
})

const entitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  position: positionSchema.optional(),
  attributes: z.array(attributeSchema),
})

const relationSchema = z.object({
  id: z.string().min(1),
  source_entity_id: z.string().min(1),
  target_entity_id: z.string().min(1),
  cardinality: cardinalitySchema,
})

export const erDesignSchema = z.object({
  entities: z.array(entitySchema),
  relations: z.array(relationSchema),
})

export interface ValidationReport {
  /** 阻断落库的问题 */
  errors: string[]
  /** 不阻断、但值得提醒的问题 */
  warnings: string[]
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/

export function validateDesign(design: ERDesign): ValidationReport {
  const errors: string[] = []
  const warnings: string[] = []

  const entityIDs = new Set<string>()
  const attributeIDs = new Set<string>()
  const entityNames = new Map<string, string>()
  const relationIDs = new Set<string>()
  const relationKeys = new Set<string>()

  design.entities.forEach((entity, entityIndex) => {
    if (!entity.id.trim()) {
      errors.push(`entities[${entityIndex}].id 不能为空`)
    } else if (entityIDs.has(entity.id)) {
      errors.push(`实体 ID 重复：${entity.id}`)
    } else {
      entityIDs.add(entity.id)
    }

    const name = entity.name.trim()
    if (!name) {
      errors.push(`实体（${entity.id || `#${entityIndex}`}）缺少名称`)
      return
    }
    const lowerName = name.toLowerCase()
    const previous = entityNames.get(lowerName)
    if (previous !== undefined) {
      errors.push(`实体名重复：${name}（${previous} 与 ${entity.id}）`)
    } else {
      entityNames.set(lowerName, entity.id)
    }

    if (!IDENTIFIER.test(name)) {
      warnings.push(`实体 ${name} 的命名不符合 snake_case 规范，可能影响后续代码生成`)
    }
    if (entity.attributes.length === 0) {
      warnings.push(`实体 ${name} 没有任何字段`)
    }

    const fieldNames = new Set<string>()
    let primaryKeyCount = 0

    entity.attributes.forEach((attribute, attributeIndex) => {
      if (!attribute.id.trim()) {
        errors.push(`实体 ${name} 的第 ${attributeIndex + 1} 个字段缺少 ID`)
      } else if (attributeIDs.has(attribute.id)) {
        errors.push(`字段 ID 重复：${attribute.id}`)
      } else {
        attributeIDs.add(attribute.id)
      }

      const fieldName = attribute.name.trim()
      if (!fieldName) {
        errors.push(`实体 ${name} 的第 ${attributeIndex + 1} 个字段缺少名称`)
        return
      }
      const lowerFieldName = fieldName.toLowerCase()
      if (fieldNames.has(lowerFieldName)) {
        errors.push(`实体 ${name} 存在重复字段名：${fieldName}`)
      }
      fieldNames.add(lowerFieldName)

      if (!attribute.db_type.trim()) {
        errors.push(`字段 ${name}.${fieldName} 缺少数据类型`)
      }
      if (!IDENTIFIER.test(fieldName)) {
        warnings.push(`字段 ${name}.${fieldName} 的命名不符合 snake_case 规范`)
      }
      if (attribute.is_primary_key) {
        primaryKeyCount += 1
      }
    })

    if (primaryKeyCount === 0) {
      warnings.push(`实体 ${name} 没有主键`)
    }
    if (primaryKeyCount > 1) {
      warnings.push(`实体 ${name} 有 ${primaryKeyCount} 个主键字段，复合主键需要确认`)
    }
  })

  design.relations.forEach((relation, index) => {
    if (!relation.id.trim()) {
      errors.push(`relations[${index}].id 不能为空`)
    } else if (relationIDs.has(relation.id)) {
      errors.push(`关系 ID 重复：${relation.id}`)
    } else {
      relationIDs.add(relation.id)
    }

    if (!entityIDs.has(relation.source_entity_id)) {
      errors.push(`关系的源实体不存在：${relation.source_entity_id}`)
    }
    if (!entityIDs.has(relation.target_entity_id)) {
      errors.push(`关系的目标实体不存在：${relation.target_entity_id}`)
    }

    const key = `${relation.source_entity_id}->${relation.target_entity_id}:${relation.cardinality}`
    if (relationKeys.has(key)) {
      warnings.push(`关系重复定义：${key}`)
    }
    relationKeys.add(key)

    if (relation.source_entity_id === relation.target_entity_id) {
      warnings.push(`关系 ${key} 指向自身，请确认这是自引用结构`)
    }
  })

  return { errors, warnings }
}

/** 解析导入的 JSON，并做结构校验。抛出带中文说明的错误。 */
export function parseDesignJSON(text: string): ERDesign {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`JSON 解析失败：${String(error)}`)
  }

  // 兼容 {"design": {...}} 与直接给设计本身两种形式
  const candidate =
    raw && typeof raw === 'object' && 'design' in raw
      ? (raw as { design: unknown }).design
      : raw

  const result = erDesignSchema.safeParse(candidate)
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('；')
    throw new Error(`ER 设计结构不合法：${detail}`)
  }

  return result.data as ERDesign
}
