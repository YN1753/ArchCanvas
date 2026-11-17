import { toMermaid } from '../export/mermaid'
import type { SchemaExporter } from './types'

export const mermaidSchemaExporter: SchemaExporter = {
  id: 'mermaid',
  label: 'Mermaid',
  tabLabel: '导出 Mermaid',
  fileExtension: '.mmd',
  mimeType: 'text/plain;charset=utf-8',
  supportsDialect: false,
  getDescription() {
    return 'Mermaid erDiagram 源码，可直接贴入 Markdown、Notion 或 GitHub 评审。'
  },
  buildFilename(projectBaseName) {
    return `${projectBaseName}.mmd`
  },
  export(design) {
    return toMermaid(design)
  },
}
