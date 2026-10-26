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
  /** privacy policy page shown on the sign-in screen; null = plain text without a link */
  privacyPolicyUrl: string | null
  /** dev-only mock platform services; always false in production builds */
  useMocks: boolean
  /** deep link used for OAuth / password reset on iOS and Android */
  nativeAuthRedirect: string
  /**
   * Test sign-in by phone: no SMS is sent and this code is always the right one (unknown numbers are
   * registered). Anyone who knows a number can enter its account — not for a public release.
   * null = real SMS codes through Supabase.
   */
  phoneFixedCode: string | null
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
  VITE_PRIVACY_POLICY_URL?: string
  VITE_USE_MOCKS?: string
  /** fixed phone code (4–8 digits); unset = 1111, "off" = real SMS */
  VITE_PHONE_FIXED_CODE?: string
}

function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value)
}

/** the test-mode phone code: 1111 unless set; "off" (or anything but 4–8 digits) turns it off */
export const DEFAULT_PHONE_FIXED_CODE = '1111'
function phoneFixedCode(value: string | undefined): string | null {
  if (value === undefined) return DEFAULT_PHONE_FIXED_CODE
  const code = value.trim()
  return /^\d{4,8}$/.test(code) ? code : null
}

function httpsUrl(value: string | undefined): string | null {
  const url = value?.trim() ?? ''
  return /^https:\/\/\S+$/.test(url) ? url : null
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
      privacyPolicyUrl: httpsUrl(env.VITE_PRIVACY_POLICY_URL),
      useMocks: env.DEV && env.VITE_USE_MOCKS === 'true',
      nativeAuthRedirect: NATIVE_AUTH_REDIRECT,
      phoneFixedCode: phoneFixedCode(env.VITE_PHONE_FIXED_CODE),
    },
  }
}
