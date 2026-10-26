import { Capacitor } from '@capacitor/core'
import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig, OAuthProvider } from '@/app/config'

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'invalid_code'
  | 'user_exists'
  | 'weak_password'
  | 'rate_limited'
  | 'invalid_phone'
  | 'phone_unavailable'
  | 'network'
  | 'session_expired'
  | 'unknown'

export class AppAuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string = code,
  ) {
    super(message)
    this.name = 'AppAuthError'
  }
}

export function mapAuthError(error: AuthError | Error): AppAuthError {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const message = error.message
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return new AppAuthError('invalid_credentials', message)
  }
  if (code === 'email_not_confirmed') return new AppAuthError('email_not_confirmed', message)
  if (code === 'otp_expired' || code === 'otp_disabled' || /token has expired or is invalid/i.test(message)) {
    return new AppAuthError('invalid_code', message)
  }
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(message)) {
    return new AppAuthError('user_exists', message)
  }
  if (code === 'sms_send_failed' || code === 'phone_provider_disabled' || /sms provider|unsupported phone provider/i.test(message)) {
    return new AppAuthError('phone_unavailable', message)
  }
  if (code === 'validation_failed' && /phone/i.test(message)) return new AppAuthError('invalid_phone', message)
  if (code === 'weak_password' || /password should be/i.test(message)) return new AppAuthError('weak_password', message)
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || code === 'over_sms_send_rate_limit' || /rate limit/i.test(message)) {
    return new AppAuthError('rate_limited', message)
  }
  if (code === 'session_expired' || code === 'refresh_token_not_found' || /refresh token/i.test(message)) {
    return new AppAuthError('session_expired', message)
  }
  if (/fetch|network/i.test(message)) return new AppAuthError('network', message)
  return new AppAuthError('unknown', message)
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'PASSWORD_RECOVERY' | 'USER_UPDATED' | 'OTHER'

export class AuthService {
  constructor(
    private readonly client: SupabaseClient,
    private readonly config: AppConfig,
  ) {}

  private redirectUrl(path: string): string {
    return Capacitor.isNativePlatform() ? this.config.nativeAuthRedirect : `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`
  }

  async getSession(): Promise<Session | null> {
    const { data, error } = await this.client.auth.getSession()
    if (error) throw mapAuthError(error)
    return data.session
  }

  onChange(listener: (event: AuthEvent, session: Session | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      const known: AuthEvent[] = ['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'PASSWORD_RECOVERY', 'USER_UPDATED']
      listener(known.includes(event as AuthEvent) ? (event as AuthEvent) : 'OTHER', session)
    })
    return () => data.subscription.unsubscribe()
  }

  /**
   * Returns true if a session was created immediately (email confirmation disabled).
   * The nickname is chosen later, at the "game profile" step.
   */
  async signUp(email: string, password: string): Promise<boolean> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: this.redirectUrl('/auth/callback') },
    })
    if (error) throw mapAuthError(error)
    return data.session !== null
  }

  /**
   * Confirms the account with the one-time code from the sign-up email.
   * The email template must include {{ .Token }} (the link keeps working too).
   */
  async verifyEmailCode(email: string, code: string): Promise<void> {
    const { error } = await this.client.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) throw mapAuthError(error)
  }

  async resendConfirmation(email: string): Promise<void> {
    const { error } = await this.client.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: this.redirectUrl('/auth/callback') },
    })
    if (error) throw mapAuthError(error)
  }

  /**
   * Sends a one-time SMS code; an unknown number gets a new account (nickname comes at the setup step).
   * Needs an SMS provider (or test numbers) configured in Supabase Auth → Phone.
   * @param phone E.164, e.g. +79991234567
   */
  async requestPhoneCode(phone: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ phone, options: { shouldCreateUser: true, channel: 'sms' } })
    if (error) throw mapAuthError(error)
  }

  async verifyPhoneCode(phone: string, code: string): Promise<void> {
    const { error } = await this.client.auth.verifyOtp({ phone, token: code, type: 'sms' })
    if (error) throw mapAuthError(error)
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password })
    if (error) throw mapAuthError(error)
  }

  async signInWithOAuth(provider: OAuthProvider): Promise<void> {
    const { error } = await this.client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: this.redirectUrl('/auth/callback') },
    })
    if (error) throw mapAuthError(error)
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: this.redirectUrl('/auth/update-password'),
    })
    if (error) throw mapAuthError(error)
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password })
    if (error) throw mapAuthError(error)
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut()
    if (error) throw mapAuthError(error)
  }

  /** Completes PKCE OAuth / recovery flows delivered via native deep link. */
  async handleDeepLink(url: string): Promise<boolean> {
    if (!url.startsWith(this.config.nativeAuthRedirect)) return false
    const code = new URL(url).searchParams.get('code')
    if (!code) return false
    const { error } = await this.client.auth.exchangeCodeForSession(code)
    if (error) throw mapAuthError(error)
    return true
  }

  /** Mobile WebViews pause timers in background; refresh explicitly on resume. */
  setForeground(active: boolean): void {
    if (active) void this.client.auth.startAutoRefresh()
    else void this.client.auth.stopAutoRefresh()
  }
}
