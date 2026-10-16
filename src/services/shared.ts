export type AppPermissionState = 'granted' | 'denied' | 'prompt'

export function normalizePermission(state: string | undefined): AppPermissionState {
  if (state === 'granted' || state === 'limited') return 'granted'
  if (state === 'denied') return 'denied'
  return 'prompt'
}

/** Extracts a `code` field from plugin/browser errors without unsafe casts. */
export function errorCode(error: unknown): string | number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string' || typeof code === 'number') return code
  }
  return undefined
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

export class AbortError extends Error {
  constructor() {
    super('aborted')
    this.name = 'AbortError'
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms} ms`)
    this.name = 'TimeoutError'
  }
}

/** Races a promise against a timeout and an optional AbortSignal. */
export function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new AbortError())
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new TimeoutError(ms))
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(new AbortError())
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error instanceof Error ? error : new Error(errorMessage(error)))
      },
    )
  })
}
