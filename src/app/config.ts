export const OAUTH_PROVIDERS = ['google', 'apple', 'github'] as const
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]

export interface AppConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  /** Yandex Maps JavaScript API 3.0 key; public, restricted by HTTP Referer in the developer console */
  yandexMapsApiKey: string
  /** URL of the recognition model manifest (see ADR-001); null = recognition unavailable */
  recognitionManifestUrl: string | null
  oauthProviders: OAuthProvider[]
  /** dev-only mock platform services; always false in production builds */
  useMocks: boolean
  /** deep link used for OAuth / password reset on iOS and Android */
  nativeAuthRedirect: string
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; missing: string[] }

export const NATIVE_AUTH_REDIRECT = 'app.metka.game://auth/callback'

interface EnvLike {
  DEV: boolean
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  VITE_YANDEX_MAPS_API_KEY?: string
  VITE_RECOGNITION_MODEL_URL?: string
  VITE_AUTH_OAUTH_PROVIDERS?: string
  VITE_USE_MOCKS?: string
}

function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value)
}

export function readConfig(env: EnvLike): ConfigResult {
  const url = env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  const missing: string[] = []
  if (!/^https?:\/\//.test(url) || url.includes('YOUR-PROJECT')) missing.push('VITE_SUPABASE_URL')
  if (!key || key.startsWith('your-')) missing.push('VITE_SUPABASE_ANON_KEY')
  const mapsKey = env.VITE_YANDEX_MAPS_API_KEY?.trim() ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(mapsKey)) missing.push('VITE_YANDEX_MAPS_API_KEY')
  if (missing.length > 0) return { ok: false, missing }

  return {
    ok: true,
    config: {
      supabaseUrl: url,
      supabaseAnonKey: key,
      yandexMapsApiKey: mapsKey,
      recognitionManifestUrl: env.VITE_RECOGNITION_MODEL_URL?.trim() || null,
      oauthProviders: (env.VITE_AUTH_OAUTH_PROVIDERS ?? '')
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(isOAuthProvider),
      useMocks: env.DEV && env.VITE_USE_MOCKS === 'true',
      nativeAuthRedirect: NATIVE_AUTH_REDIRECT,
    },
  }
}
