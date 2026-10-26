import { errorCode, errorMessage } from '../shared'

export type ApiErrorCode =
  | 'offline'
  | 'network'
  /** request aborted by the caller (superseded viewport load); never retried or shown */
  | 'cancelled'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'server'
  | 'invalid_response'
  | 'not_configured'
  // domain errors raised by SQL functions
  | 'quest_not_completed'
  | 'quest_not_found'
  | 'already_in_clan'
  | 'not_in_clan'
  | 'clan_taken'
  | 'clan_not_found'
  | 'clan_full'
  | 'invalid_clan'
  | 'not_clan_owner'
  | 'invalid_avatar'
  | 'recognition_unavailable'
  | 'invalid_embedding'
  | 'invalid_location'
  | 'username_taken'
  | 'invalid_profile'
  | 'building_locked'
  | 'invalid_photo'
  | 'invalid_memory'
  | 'invalid_event'
  | 'too_many_events'
  | 'event_not_found'
  | 'event_started'
  | 'event_full'
  | 'event_creator'
  | 'profile_hidden'
  | 'task_not_found'
  | 'task_not_completed'

const DOMAIN_CODES = new Set<ApiErrorCode>([
  'quest_not_completed',
  'quest_not_found',
  'already_in_clan',
  'not_in_clan',
  'clan_taken',
  'clan_not_found',
  'clan_full',
  'invalid_clan',
  'not_clan_owner',
  'invalid_avatar',
  'recognition_unavailable',
  'invalid_embedding',
  'invalid_location',
  'username_taken',
  'invalid_profile',
  'building_locked',
  'invalid_photo',
  'invalid_memory',
  'invalid_event',
  'too_many_events',
  'event_not_found',
  'event_started',
  'event_full',
  'event_creator',
  'profile_hidden',
  'task_not_found',
  'task_not_completed',
])

function isDomainCode(value: string): value is ApiErrorCode {
  return DOMAIN_CODES.has(value as ApiErrorCode)
}

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string = code,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get retryable(): boolean {
    return this.code === 'network' || this.code === 'server' || this.code === 'offline'
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** Maps PostgREST / supabase-js / fetch errors to ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  const message = errorMessage(error)
  const code = errorCode(error)

  if ((error instanceof Error && error.name === 'AbortError') || /^AbortError\b/.test(message)) {
    return new ApiError('cancelled', message, error)
  }
  if (isOffline()) return new ApiError('offline', message, error)
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message)) {
    return new ApiError('network', message, error)
  }
  const domain = message.trim()
  if (isDomainCode(domain)) return new ApiError(domain, message, error)
  if (domain === 'not_authenticated' || code === 'PGRST301' || code === 401) {
    return new ApiError('unauthorized', message, error)
  }
  if (code === '42501') return new ApiError('forbidden', message, error)
  if (code === '23505') return new ApiError('conflict', message, error)
  if (code === '22023' || code === '23514' || code === '22P02') return new ApiError('validation', message, error)
  // PGRST116: no row; PGRST202: RPC function missing (e.g. migration not applied) — never retried
  if (code === 'PGRST116' || code === 'PGRST202') return new ApiError('not_found', message, error)
  return new ApiError('server', message, error)
}

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** Retries retryable failures with exponential backoff. Use only for idempotent calls. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2
  const base = options.baseDelayMs ?? 400
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (raw) {
      const error = toApiError(raw)
      if (!error.retryable || error.code === 'offline' || attempt >= retries) throw error
      await sleep(base * 2 ** attempt)
      attempt++
    }
  }
}
