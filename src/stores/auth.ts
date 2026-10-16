import type { Session } from '@supabase/supabase-js'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { services } from '@/app/providers/services'
import type { OAuthProvider } from '@/app/config'

export type AuthStatus = 'loading' | 'signed_in' | 'signed_out'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const status = ref<AuthStatus>('loading')
  /** set when the session ended without an explicit sign-out (expired / revoked) */
  const sessionExpired = ref(false)
  const recoveryMode = ref(false)
  let explicitSignOut = false
  let initPromise: Promise<void> | null = null

  const userId = computed(() => session.value?.user.id ?? null)
  const email = computed(() => session.value?.user.email ?? null)

  function init(): Promise<void> {
    initPromise ??= (async () => {
      const { auth } = services()
      auth.onChange((event, next) => {
        if (event === 'SIGNED_OUT') {
          sessionExpired.value = !explicitSignOut && session.value !== null
          explicitSignOut = false
        }
        if (event === 'PASSWORD_RECOVERY') recoveryMode.value = true
        session.value = next
        status.value = next ? 'signed_in' : 'signed_out'
      })
      try {
        session.value = await auth.getSession()
      } catch {
        session.value = null
      }
      status.value = session.value ? 'signed_in' : 'signed_out'
    })()
    return initPromise
  }

  async function signIn(emailValue: string, password: string): Promise<void> {
    await services().auth.signIn(emailValue, password)
    sessionExpired.value = false
  }

  async function signUp(emailValue: string, password: string): Promise<boolean> {
    return services().auth.signUp(emailValue, password)
  }

  async function verifyEmailCode(emailValue: string, code: string): Promise<void> {
    await services().auth.verifyEmailCode(emailValue, code)
  }

  async function resendConfirmation(emailValue: string): Promise<void> {
    await services().auth.resendConfirmation(emailValue)
  }

  async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
    await services().auth.signInWithOAuth(provider)
  }

  async function requestPasswordReset(emailValue: string): Promise<void> {
    await services().auth.requestPasswordReset(emailValue)
  }

  async function updatePassword(password: string): Promise<void> {
    await services().auth.updatePassword(password)
    recoveryMode.value = false
  }

  async function signOut(): Promise<void> {
    explicitSignOut = true
    try {
      await services().auth.signOut()
    } finally {
      session.value = null
      status.value = 'signed_out'
    }
  }

  return {
    session,
    status,
    sessionExpired,
    recoveryMode,
    userId,
    email,
    init,
    signIn,
    signUp,
    verifyEmailCode,
    resendConfirmation,
    signInWithOAuth,
    requestPasswordReset,
    updatePassword,
    signOut,
  }
})
