/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
  readonly VITE_COLLAB_WS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
