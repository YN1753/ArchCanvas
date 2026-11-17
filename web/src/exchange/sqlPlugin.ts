import { DEFAULT_DIALECT, getDialect } from '../dialects'
import { designToSQL } from '../sql/ddlExporter'
import { parseSQLToDesign } from '../sql/ddlParser'
import type { SchemaExporter, SchemaImporter } from './types'

const SQL_IMPORT_PLACEHOLDER = [
  '-- 粘贴你的 CREATE TABLE 建表语句，例如：',
  'CREATE TABLE users (',
  '  id BIGINT PRIMARY KEY AUTO_INCREMENT,',
  '  username VARCHAR(64) NOT NULL UNIQUE',
  ');',
  '',
  'CREATE TABLE orders (',
  '  id BIGINT PRIMARY KEY AUTO_INCREMENT,',
  '  user_id BIGINT NOT NULL,',
  '  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users (id)',
  ');',
].join('\n')

export const sqlSchemaExporter: SchemaExporter = {
  id: 'sql',
  label: 'SQL DDL',
  tabLabel: '导出 SQL DDL',
  fileExtension: '.sql',
  mimeType: 'application/sql;charset=utf-8',
  supportsDialect: true,
  getDescription(options) {
    return getDialect(options?.dialect ?? DEFAULT_DIALECT).exportDescription
  },
  buildFilename(projectBaseName, options) {
    const dialect = options?.dialect ?? DEFAULT_DIALECT
    return `${projectBaseName}_${dialect}.sql`
  },
  export(design, options) {
    return designToSQL(design, options?.dialect ?? DEFAULT_DIALECT)
  },
}

export const sqlSchemaImporter: SchemaImporter = {
  id: 'sql',
  label: 'SQL DDL',
  tabLabel: '导入 SQL DDL',
  description:
    '粘贴已有 SQL 建表脚本（支持 MySQL、PostgreSQL、SQLite 的 CREATE TABLE 语法）。将自动解析表结构、主键与外键关联，并在画板中自动排版。',
  submitLabel: '逆向解析并载入画板',
  sampleButtonLabel: '填入电商示例 SQL',
  acceptExtensions: ['.sql', '.ddl'],
  placeholder: SQL_IMPORT_PLACEHOLDER,
  supportsDialect: true,
  supportsAiEnrich: true,
  getSample(dialect) {
    return getDialect(dialect ?? DEFAULT_DIALECT).sampleSQL
  },
  parse(raw) {
    const { design, warnings } = parseSQLToDesign(raw)
    return { design, warnings }
  },
}
