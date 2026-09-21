/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 基地址；不设置时走同源 /api/v1。 */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
