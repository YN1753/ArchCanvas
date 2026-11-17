import { parseDesignJSON } from '../validate/dsl'
import type { SchemaExporter, SchemaImporter } from './types'

export const jsonSchemaExporter: SchemaExporter = {
  id: 'json',
  label: 'JSON',
  tabLabel: '导出 JSON',
  fileExtension: '.json',
  mimeType: 'application/json;charset=utf-8',
  supportsDialect: false,
  getDescription() {
    return '标准的 ER DSL JSON 结构规范，用于版本备份或在其他 ArchCanvas 实例中导入。'
  },
  buildFilename(projectBaseName) {
    return `${projectBaseName}.json`
  },
  export(design) {
    return JSON.stringify(design, null, 2)
  },
}

export const jsonSchemaImporter: SchemaImporter = {
  id: 'json',
  label: 'JSON',
  tabLabel: '导入 JSON',
  description:
    '粘贴 ER 设计规范 JSON（可直接粘贴「导出 JSON」的内容）。导入将应用至画布并自动持久化保存到服务端。',
  submitLabel: '解析并载入',
  acceptExtensions: ['.json'],
  placeholder: '{"entities": [], "relations": []}',
  supportsDialect: false,
  supportsAiEnrich: true,
  parse(raw) {
    return {
      design: parseDesignJSON(raw),
      warnings: [],
    }
  },
}
