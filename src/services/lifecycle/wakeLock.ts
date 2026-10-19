/**
 * Keeps the screen on while exploring. In a browser GPS stops as soon as the screen turns off, so
 * this is the only way a web player can walk without the route being cut. Best effort: when the
 * platform does not support it (or refuses), exploring still works and the UI says so.
 */
export interface ScreenWakeLock {
  readonly supported: boolean
  /** true when the screen is being kept on */
  readonly active: boolean
  /** Starts keeping the screen on (re-acquired automatically when the page becomes visible again). */
  keepOn(): Promise<boolean>
  release(): Promise<void>
  onChange(listener: (active: boolean) => void): () => void
}

interface Sentinel {
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}
interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>
}

/** Screen Wake Lock API (Chrome/Android WebView, Safari/iOS 16.4+). */
export class BrowserScreenWakeLock implements ScreenWakeLock {
  private sentinel: Sentinel | null = null
  private wanted = false
  private readonly listeners = new Set<(active: boolean) => void>()

  constructor(
    private readonly api: WakeLockApi | null = typeof navigator !== 'undefined' && 'wakeLock' in navigator
      ? (navigator as Navigator & { wakeLock: WakeLockApi }).wakeLock
      : null,
    private readonly doc: Document | null = typeof document !== 'undefined' ? document : null,
  ) {
    // the browser drops the lock whenever the page is hidden; take it again on return
    this.doc?.addEventListener('visibilitychange', () => {
      if (this.wanted && this.doc?.visibilityState === 'visible' && !this.sentinel) void this.request()
    })
  }

  get supported(): boolean {
    return this.api !== null
  }

  get active(): boolean {
    return this.sentinel !== null
  }

  async keepOn(): Promise<boolean> {
    this.wanted = true
    if (this.sentinel) return true
    return this.request()
  }

  async release(): Promise<void> {
    this.wanted = false
    const s = this.sentinel
    this.sentinel = null
    if (s) {
      await s.release().catch(() => undefined)
      this.emit()
    }
  }

  onChange(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async request(): Promise<boolean> {
    if (!this.api || this.doc?.visibilityState === 'hidden') return false
    try {
      const sentinel = await this.api.request('screen')
      if (!this.wanted) {
        await sentinel.release().catch(() => undefined)
        return false
      }
      this.sentinel = sentinel
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) {
          this.sentinel = null
          this.emit()
        }
      })
      this.emit()
      return true
    } catch {
      return false // e.g. battery saver, not allowed in this context
    }
  }

  private emit(): void {
    for (const l of this.listeners) l(this.active)
  }
}
