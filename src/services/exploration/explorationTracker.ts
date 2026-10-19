import { GeolocationError, type GeoFix, type GeolocationService } from '@/services/geolocation/types'
import type { Cell } from './grid'
import { TrackFilter, type TrackFilterOptions, type TrackPoint } from './trackFilter'

export type ExplorationStatus =
  | 'off'
  | 'starting'
  /** watching, no fix yet */
  | 'searching'
  | 'tracking'
  /** fixes arrive but are too inaccurate to count */
  | 'weak_signal'
  /** no fix for a while (indoors, tunnel) */
  | 'signal_lost'
  | 'permission_denied'
  | 'disabled'

export interface ExplorationResult {
  accepted: number
  rejected: Record<string, number>
  newCells: Cell[]
  totalCells: number
}

/** Upload state: 'saved' only after the server confirmed the last batch. */
export type SyncState = 'idle' | 'syncing' | 'saved' | 'offline' | 'error'

export interface TrackerState {
  status: ExplorationStatus
  accuracyM: number | null
  /** points waiting for upload (e.g. while offline) */
  pending: number
  sync: SyncState
}

/** Keeps not-yet-uploaded points across app restarts. One store per signed-in user. */
export interface PendingPointStore {
  load(): Promise<TrackPoint[]>
  save(points: TrackPoint[]): Promise<void>
}

export interface ExplorationTracker {
  readonly state: TrackerState
  /** Asks for location permission if needed. Foreground only: call stop() when the app is backgrounded. */
  start(): Promise<void>
  /** Stops GPS and uploads what is buffered (best effort). */
  stop(): Promise<void>
  onChange(listener: (state: TrackerState) => void): () => void
  onResult(listener: (result: ExplorationResult) => void): () => void
  onUploadError(listener: (error: unknown) => void): () => void
}

export interface TrackerOptions {
  filter?: Partial<TrackFilterOptions>
  batchSize: number
  flushIntervalMs: number
  signalLostMs: number
  /** server rejects fixes older than 30 min */
  maxPointAgeMs: number
  maxBuffered: number
}

const DEFAULTS: TrackerOptions = {
  batchSize: 10,
  flushIntervalMs: 15_000,
  signalLostMs: 30_000,
  maxPointAgeMs: 25 * 60_000,
  maxBuffered: 600,
}

export class GpsExplorationTracker implements ExplorationTracker {
  private status: ExplorationStatus = 'off'
  private sync: SyncState = 'idle'
  private restored = false
  private accuracyM: number | null = null
  private buffer: TrackPoint[] = []
  private firstBufferedAt = 0
  private lastFixAt = 0
  private uploading: Promise<void> | null = null
  private unwatch: (() => void) | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private running = false
  private readonly filter: TrackFilter
  private readonly options: TrackerOptions
  private readonly changeListeners = new Set<(s: TrackerState) => void>()
  private readonly resultListeners = new Set<(r: ExplorationResult) => void>()
  private readonly errorListeners = new Set<(e: unknown) => void>()

  constructor(
    private readonly geolocation: GeolocationService,
    private readonly upload: (points: TrackPoint[]) => Promise<ExplorationResult>,
    options: Partial<TrackerOptions> = {},
    private readonly now: () => number = Date.now,
    private readonly store: PendingPointStore | null = null,
    private readonly isOffline: () => boolean = () => typeof navigator !== 'undefined' && navigator.onLine === false,
  ) {
    this.options = { ...DEFAULTS, ...options }
    this.filter = new TrackFilter(this.options.filter)
  }

  get state(): TrackerState {
    return { status: this.status, accuracyM: this.accuracyM, pending: this.buffer.length, sync: this.sync }
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.setStatus('starting')
    await this.restore()
    try {
      let permission = await this.geolocation.checkPermission()
      if (permission === 'prompt') permission = await this.geolocation.requestPermission()
      if (!this.running) return
      if (permission === 'denied') return this.halt('permission_denied')
      const unwatch = await this.geolocation.watchPosition(
        (fix) => this.onFix(fix),
        (error) => this.onError(error),
      )
      if (!this.running) return unwatch()
      this.unwatch = unwatch
    } catch (e) {
      const code = e instanceof GeolocationError ? e.code : 'unavailable'
      return this.halt(code === 'permission_denied' ? 'permission_denied' : code === 'disabled' ? 'disabled' : 'signal_lost')
    }
    this.lastFixAt = this.now()
    if (this.status === 'starting') this.setStatus('searching')
    this.ticker = setInterval(() => this.tick(), 5_000)
  }

  /**
   * Stops GPS and uploads what is buffered before resolving. If an upload was already running, or
   * more than one batch is waiting, it keeps going until the buffer is empty or an upload fails
   * (failed points stay stored for the next start).
   */
  async stop(): Promise<void> {
    this.running = false
    this.release()
    this.filter.reset()
    this.setStatus('off')
    for (let i = 0; i < 4 && this.buffer.length > 0; i++) {
      const before = this.buffer.length
      await this.flush()
      if (this.sync !== 'saved' || this.buffer.length >= before) break
    }
  }

  onChange(listener: (state: TrackerState) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  onResult(listener: (result: ExplorationResult) => void): () => void {
    this.resultListeners.add(listener)
    return () => this.resultListeners.delete(listener)
  }

  onUploadError(listener: (error: unknown) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  private onFix(fix: GeoFix): void {
    if (!this.running) return
    this.lastFixAt = this.now()
    this.accuracyM = fix.accuracyM
    const verdict = this.filter.push(fix)
    if (!verdict.accepted && verdict.reason === 'inaccurate') {
      this.setStatus('weak_signal')
      return
    }
    this.setStatus('tracking')
    if (!verdict.accepted) return
    if (this.buffer.length === 0) this.firstBufferedAt = this.now()
    this.buffer.push(verdict.point)
    if (this.buffer.length > this.options.maxBuffered) this.buffer.splice(0, this.buffer.length - this.options.maxBuffered)
    this.persist()
    this.emitChange()
    if (this.buffer.length >= this.options.batchSize) void this.flush()
  }

  private onError(error: GeolocationError): void {
    if (!this.running) return
    if (error.code === 'permission_denied' || error.code === 'disabled') this.halt(error.code)
    else this.setStatus('signal_lost') // timeout / unavailable: keep watching, it may come back
  }

  private tick(): void {
    const now = this.now()
    if (this.running && now - this.lastFixAt > this.options.signalLostMs) this.setStatus('signal_lost')
    if (this.buffer.length > 0 && now - this.firstBufferedAt >= this.options.flushIntervalMs) void this.flush()
  }

  /** Uploads buffered points; on failure keeps them for the next attempt. */
  private flush(): Promise<void> {
    if (this.uploading) return this.uploading
    const cutoff = this.now() - this.options.maxPointAgeMs
    this.buffer = this.buffer.filter((p) => p.t >= cutoff)
    if (this.buffer.length === 0) return Promise.resolve()
    const batch = this.buffer.slice(0, 300)
    this.setSync('syncing')
    this.uploading = this.upload(batch)
      .then((result) => {
        // re-sending a batch after a lost response is harmless: the server rejects already
        // accepted fixes as out_of_order and cells are unique per player
        this.buffer.splice(0, batch.length)
        this.firstBufferedAt = this.now()
        this.persist()
        this.sync = 'saved'
        for (const listener of this.resultListeners) listener(result)
      })
      .catch((error: unknown) => {
        this.sync = this.isOffline() ? 'offline' : 'error'
        for (const listener of this.errorListeners) listener(error)
      })
      .finally(() => {
        this.uploading = null
        this.emitChange()
      })
    return this.uploading
  }

  /** Points left from a previous run (app killed while offline) go out with the next batch. */
  private async restore(): Promise<void> {
    if (this.restored || !this.store) return
    this.restored = true
    try {
      const saved = await this.store.load()
      const known = new Set(this.buffer.map((p) => p.t))
      const fresh = saved.filter((p) => !known.has(p.t))
      if (fresh.length === 0) return
      this.buffer = [...fresh, ...this.buffer].sort((a, b) => a.t - b.t)
      this.firstBufferedAt = this.now() - this.options.flushIntervalMs // send with the first tick
      this.emitChange()
    } catch {
      // unreadable storage must not block exploring
    }
  }

  private persist(): void {
    void this.store?.save(this.buffer).catch(() => undefined)
  }

  private setSync(sync: SyncState): void {
    if (this.sync === sync) return
    this.sync = sync
    this.emitChange()
  }

  private halt(status: ExplorationStatus): void {
    this.running = false
    this.release()
    this.setStatus(status)
  }

  private release(): void {
    this.unwatch?.()
    this.unwatch = null
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
  }

  private setStatus(status: ExplorationStatus): void {
    if (this.status === status) return
    this.status = status
    this.emitChange()
  }

  private emitChange(): void {
    const state = this.state
    for (const listener of this.changeListeners) listener(state)
  }
}
