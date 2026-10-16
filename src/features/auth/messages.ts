import { AppAuthError, type AuthErrorCode } from '@/services/auth/authService'

const TEXT: Record<AuthErrorCode, string> = {
  invalid_credentials: 'Неверная почта или пароль.',
  email_not_confirmed: 'Почта ещё не подтверждена.',
  invalid_code: 'Код неверный или устарел. Запросите новый.',
  user_exists: 'Аккаунт с этой почтой уже существует.',
  weak_password: 'Пароль слишком простой. Используйте не меньше 8 символов.',
  rate_limited: 'Слишком много попыток. Повторите позже.',
  network: 'Нет связи с сервером. Проверьте интернет.',
  session_expired: 'Сессия истекла. Войдите снова.',
  unknown: 'Что-то пошло не так. Попробуйте ещё раз.',
}

export function authErrorText(error: unknown): string {
  return error instanceof AppAuthError ? TEXT[error.code] : TEXT.unknown
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const USERNAME_RE = /^[A-Za-z0-9_А-Яа-яЁё]{3,24}$/
export const MIN_PASSWORD = 8
/** Supabase one-time codes are 6 digits by default (configurable up to 10) */
export const OTP_RE = /^\d{6,10}$/
export const RESEND_COOLDOWN_S = 60
