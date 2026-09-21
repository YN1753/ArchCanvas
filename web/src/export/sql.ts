import type { Entity, ERDesign } from '../types/dsl'

/**
 * 将单个实体表转化为标准 SQL DDL (CREATE TABLE 语句)
 */
export function entityToSQL(entity: Entity): string {
  const lines: string[] = []
  const primaryKeys: string[] = []

  for (const attr of entity.attributes) {
    let line = `  \`${attr.name}\` ${attr.db_type || 'VARCHAR(255)'}`

    if (attr.is_primary_key) {
      line += ' NOT NULL'
      if (attr.db_type.toUpperCase().includes('INT')) {
        line += ' AUTO_INCREMENT'
      }
      primaryKeys.push(`\`${attr.name}\``)
    } else if (!attr.is_nullable) {
      line += ' NOT NULL'
    } else {
      line += ' NULL'
    }

    if (attr.is_unique && !attr.is_primary_key) {
      line += ' UNIQUE'
    }

    if (attr.description) {
      line += ` COMMENT '${attr.description.replace(/'/g, "\\'")}'`
    }

    lines.push(line)
  }

  if (primaryKeys.length > 0) {
    lines.push(`  PRIMARY KEY (${primaryKeys.join(', ')})`)
  }

  return `CREATE TABLE \`${entity.name}\` (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
}

/**
 * 将整个 ER 设计转换为完整 SQL 脚本
 */
export function designToSQL(design: ERDesign): string {
  if (design.entities.length === 0) {
    return '-- 画布暂无实体数据表'
  }

  const chunks: string[] = [
    '-- =============================================',
    '-- ArchCanvas 自动生成的 SQL DDL 结构脚本',
    `-- 导出时间: ${new Date().toLocaleString()}`,
    `-- 实体总数: ${design.entities.length} | 关联总数: ${design.relations.length}`,
    '-- =============================================\n',
  ]

  for (const entity of design.entities) {
    chunks.push(entityToSQL(entity))
    chunks.push('')
  }

  return chunks.join('\n')
}
