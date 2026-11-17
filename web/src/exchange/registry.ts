import { validateDesign } from '../validate/dsl'
import { jsonSchemaExporter, jsonSchemaImporter } from './jsonPlugin'
import { mermaidSchemaExporter } from './mermaidPlugin'
import { sqlSchemaExporter, sqlSchemaImporter } from './sqlPlugin'
import type {
  SchemaExporter,
  SchemaExportOptions,
  SchemaImporter,
  SchemaImportOptions,
  SchemaImportParseResult,
} from './types'

export type {
  SchemaExporter,
  SchemaExportOptions,
  SchemaImporter,
  SchemaImportOptions,
  SchemaImportParseResult,
}

const EXPORTER_REGISTRY = new Map<string, SchemaExporter>([
  [sqlSchemaExporter.id, sqlSchemaExporter],
  [jsonSchemaExporter.id, jsonSchemaExporter],
  [mermaidSchemaExporter.id, mermaidSchemaExporter],
])

const IMPORTER_REGISTRY = new Map<string, SchemaImporter>([
  [sqlSchemaImporter.id, sqlSchemaImporter],
  [jsonSchemaImporter.id, jsonSchemaImporter],
])

export function registerSchemaExporter(exporter: SchemaExporter): void {
  EXPORTER_REGISTRY.set(exporter.id, exporter)
}

export function registerSchemaImporter(importer: SchemaImporter): void {
  IMPORTER_REGISTRY.set(importer.id, importer)
}

export function getSchemaExporter(id: string): SchemaExporter | undefined {
  return EXPORTER_REGISTRY.get(id)
}

export function listSchemaExporters(): SchemaExporter[] {
  return Array.from(EXPORTER_REGISTRY.values())
}

export function getSchemaImporter(id: string): SchemaImporter | undefined {
  return IMPORTER_REGISTRY.get(id)
}

export function listSchemaImporters(): SchemaImporter[] {
  return Array.from(IMPORTER_REGISTRY.values())
}

export function executeSchemaImport(
  importer: SchemaImporter,
  raw: string,
  options?: SchemaImportOptions,
): SchemaImportParseResult {
  const result = importer.parse(raw, options)
  const report = validateDesign(result.design)
  if (report.errors.length > 0) {
    throw new Error(`校验未通过：${report.errors.slice(0, 3).join('；')}`)
  }
  return result
}
