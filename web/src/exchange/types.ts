import type { DatabaseDialect, ERDesign } from '../types/dsl'

export interface SchemaExportOptions {
  dialect?: DatabaseDialect
}

export interface SchemaExporter {
  readonly id: string
  readonly label: string
  readonly tabLabel: string
  readonly fileExtension: string
  readonly mimeType: string
  readonly supportsDialect: boolean
  getDescription(options?: SchemaExportOptions): string
  buildFilename(projectBaseName: string, options?: SchemaExportOptions): string
  export(design: ERDesign, options?: SchemaExportOptions): string
}

export interface SchemaImportOptions {
  dialect?: DatabaseDialect
}

export interface SchemaImportParseResult {
  design: ERDesign
  warnings: string[]
}

export interface SchemaImporter {
  readonly id: string
  readonly label: string
  readonly tabLabel: string
  readonly description: string
  readonly submitLabel: string
  readonly sampleButtonLabel?: string
  readonly acceptExtensions: readonly string[]
  readonly placeholder: string
  readonly supportsDialect: boolean
  readonly supportsAiEnrich: boolean
  getSample?(dialect?: DatabaseDialect): string
  parse(raw: string, options?: SchemaImportOptions): SchemaImportParseResult
}
