import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from '@/app/config'

/** Native key-value storage: survives WebView storage eviction on iOS. */
const preferencesStorage = {
  async getItem(key: string): Promise<string | null> {
    return (await Preferences.get({ key })).value
  },
  async setItem(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value })
  },
  async removeItem(key: string): Promise<void> {
    await Preferences.remove({ key })
  },
}

export function createSupabaseClient(config: AppConfig): SupabaseClient {
  const native = Capacitor.isNativePlatform()
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: native ? preferencesStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !native,
      flowType: 'pkce',
    },
  })
}
