/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_MAP_TILES_URL?: string
  readonly VITE_RECOGNITION_MODEL_URL?: string
  readonly VITE_AUTH_OAUTH_PROVIDERS?: string
  readonly VITE_USE_MOCKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
