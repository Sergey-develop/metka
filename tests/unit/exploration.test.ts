import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { services } from '@/app/providers/services'
import { GpsExplorationTracker, type ExplorationResult } from '@/services/exploration/explorationTracker'
import { CELL_LAT_DEG, CELL_LNG_DEG, cellBounds, cellOf, cellsToMultiPolygon, type Cell } from '@/services/exploration/grid'
import { TrackFilter, type TrackPoint } from '@/services/exploration/trackFilter'
import { GeolocationError, type GeoFix, type GeolocationService } from '@/services/geolocation/types'
import { MockGeolocationService } from '@/mocks'
import { useExplorationStore } from '@/stores/exploration'
import { installFakeServices } from './helpers'

const LAT = 55.6534
const LNG = 37.6196
const mPerDegLng = 111_320 * Math.cos((LAT * Math.PI) / 180)
const fix = (eastM: number, tSec: number, accuracyM = 8): GeoFix => ({ lat: LAT, lng: LNG + eastM / mPerDegLng, accuracyM, timestamp: 1_000_000 + tSec * 1000 })

describe('exploration grid', () => {
  it('maps points to ~11 m cells and back', () => {
    const [lat, lng] = [LAT + 0.00003, LNG + 0.00005] // inside a cell, not on a boundary
    const [minLng, minLat, maxLng, maxLat] = cellBounds(cellOf(lat, lng))
    expect(lng).toBeGreaterThan(minLng)
    expect(lng).toBeLessThan(maxLng)
    expect(lat).toBeGreaterThan(minLat)
    expect(lat).toBeLessThan(maxLat)
    expect(CELL_LAT_DEG * 111_320).toBeCloseTo(11.1, 0)
    expect(CELL_LNG_DEG * mPerDegLng).toBeCloseTo(11.3, 0)
  })

  it('merges horizontal runs into rectangles', () => {
    const cells: Cell[] = [
      [10, 1],
      [10, 2],
      [10, 3],
      [10, 5],
      [11, 2],
      [10, 2], // duplicate
    ]
    const mp = cellsToMultiPolygon(cells)
    expect(mp.coordinates).toHaveLength(3) // [1..3], [5], row 11
    const run = mp.coordinates[0]![0]!
    expect(run[0]).toEqual([cellBounds([10, 1])[0], cellBounds([10, 1])[1]])
    expect(run[2]).toEqual([cellBounds([10, 3])[2], cellBounds([10, 3])[3]])
    expect(cellsToMultiPolygon([]).coordinates).toEqual([])
  })
})

describe('TrackFilter', () => {
  it('drops inaccurate fixes, standing jitter and outliers; passes steady walking', () => {
    const f = new TrackFilter()
    expect(f.push(fix(0, 0, 45))).toEqual({ accepted: false, reason: 'inaccurate' })
    expect(f.push(fix(0, 0)).accepted).toBe(true) // first good fix anchors
    expect(f.push(fix(3, 2))).toEqual({ accepted: false, reason: 'too_close' })
    expect(f.push(fix(12, 8)).accepted).toBe(true) // 1.5 m/s
    expect(f.push(fix(600, 12))).toEqual({ accepted: false, reason: 'outlier' }) // 147 m/s
    expect(f.push(fix(24, 16)).accepted).toBe(true) // back on track, measured from the last good fix
    expect(f.push(fix(24, 15))).toEqual({ accepted: false, reason: 'out_of_order' })
  })

  it('sends a heartbeat while standing so the server does not see a pause', () => {
    const f = new TrackFilter()
    f.push(fix(0, 0))
    expect(f.push(fix(2, 10)).accepted).toBe(false)
    expect(f.push(fix(2, 21)).accepted).toBe(true)
  })

  it('re-anchors after a long gap even if the jump is large (bus ride)', () => {
    const f = new TrackFilter()
    f.push(fix(0, 0))
    expect(f.push(fix(3000, 300)).accepted).toBe(true) // 10 m/s but 5 min later
  })
})

type Upload = (points: TrackPoint[]) => Promise<ExplorationResult>
const ok = (newCells: Cell[] = [], totalCells = 0): ExplorationResult => ({ accepted: 1, rejected: {}, newCells, totalCells })

function setup(upload: Upload = vi.fn(async () => ok())) {
  const geo = new MockGeolocationService({ lat: LAT, lng: LNG, accuracyM: 8, timestamp: 1_000_000 })
  let now = 1_000_000
  const tracker = new GpsExplorationTracker(geo, upload, {}, () => now)
  // route fixes through the watcher with controlled timestamps (MockGeolocationService stamps Date.now())
  const watchers: ((f: GeoFix) => void)[] = []
  vi.spyOn(geo, 'watchPosition').mockImplementation(async (onFix) => {
    watchers.push(onFix)
    return () => watchers.splice(watchers.indexOf(onFix), 1)
  })
  const send = (eastM: number, tSec: number, accuracyM = 8) => {
    now = 1_000_000 + tSec * 1000
    for (const w of [...watchers]) w(fix(eastM, tSec, accuracyM))
  }
  return { geo, tracker, send, watchers, advance: (ms: number) => (now += ms) }
}

describe('GpsExplorationTracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks for permission when needed and reports a denial', async () => {
    const { geo, tracker } = setup()
    geo.permission = 'prompt'
    const request = vi.spyOn(geo, 'requestPermission').mockResolvedValue('denied')
    await tracker.start()
    expect(request).toHaveBeenCalled()
    expect(tracker.state.status).toBe('permission_denied')
    expect(geo.watchPosition).not.toHaveBeenCalled()
  })

  it('batches accepted fixes and uploads every 10 points', async () => {
    const upload = vi.fn(async () => ok([[1, 2]], 1))
    const { tracker, send } = setup(upload)
    await tracker.start()
    expect(tracker.state.status).toBe('searching')
    for (let i = 0; i < 9; i++) send(i * 12, i * 8)
    expect(upload).not.toHaveBeenCalled()
    expect(tracker.state.status).toBe('tracking')
    send(9 * 12, 9 * 8)
    await vi.runOnlyPendingTimersAsync()
    expect(upload).toHaveBeenCalledTimes(1)
    expect((upload.mock.calls[0] as unknown as [TrackPoint[]])[0]).toHaveLength(10)
  })

  it('uploads a partial batch after the flush interval and keeps points when offline', async () => {
    let fail = true
    const upload = vi.fn(async () => {
      if (fail) throw new Error('Failed to fetch')
      return ok()
    })
    const { tracker, send, advance } = setup(upload)
    const errors = vi.fn()
    tracker.onUploadError(errors)
    await tracker.start()
    send(0, 0)
    send(12, 8)
    advance(16_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(tracker.state.pending).toBe(2) // kept for retry
    fail = false
    advance(16_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(upload).toHaveBeenCalledTimes(2)
    expect(tracker.state.pending).toBe(0)
  })

  it('reports weak signal and signal loss', async () => {
    const { tracker, send, advance } = setup()
    await tracker.start()
    send(0, 0, 60)
    expect(tracker.state).toMatchObject({ status: 'weak_signal', accuracyM: 60 })
    send(0, 1, 8)
    expect(tracker.state.status).toBe('tracking')
    advance(31_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tracker.state.status).toBe('signal_lost')
  })

  it('stops on permission revocation; keeps watching on timeouts', async () => {
    const { tracker, geo } = setup()
    let onError: ((e: GeolocationError) => void) | null = null
    vi.mocked(geo.watchPosition as GeolocationService['watchPosition']).mockImplementation(async (_f, e) => {
      onError = e
      return () => undefined
    })
    await tracker.start()
    onError!(new GeolocationError('timeout'))
    expect(tracker.state.status).toBe('signal_lost')
    onError!(new GeolocationError('permission_denied'))
    expect(tracker.state.status).toBe('permission_denied')
  })

  it('stop() releases GPS and uploads what is buffered; no tracking afterwards', async () => {
    const upload = vi.fn(async () => ok())
    const { tracker, send, watchers } = setup(upload)
    await tracker.start()
    send(0, 0)
    send(12, 8)
    await tracker.stop()
    expect(watchers).toHaveLength(0)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(tracker.state.status).toBe('off')
    send(24, 16)
    expect(tracker.state.pending).toBe(0)
  })
})

describe('GpsExplorationTracker persistence and sync state', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function memoryStore(initial: TrackPoint[] = []) {
    let saved = [...initial]
    return { load: vi.fn(async () => [...saved]), save: vi.fn(async (p: TrackPoint[]) => void (saved = [...p])), get: () => saved }
  }

  it('uploads points left from a previous run (app killed offline) and clears them once confirmed', async () => {
    const now = 1_000_000
    const leftover: TrackPoint[] = [
      { lat: LAT, lng: LNG, accuracy: 8, t: now - 60_000 },
      { lat: LAT, lng: LNG + 0.0002, accuracy: 8, t: now - 50_000 },
    ]
    const store = memoryStore(leftover)
    const upload = vi.fn(async () => ok([[1, 1]], 1))
    const geo = new MockGeolocationService()
    vi.spyOn(geo, 'watchPosition').mockImplementation(async () => () => undefined)
    const tracker = new GpsExplorationTracker(geo, upload, {}, () => now, store)
    await tracker.start()
    expect(tracker.state.pending).toBe(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(upload).toHaveBeenCalledWith(leftover)
    expect(tracker.state).toMatchObject({ pending: 0, sync: 'saved' })
    expect(store.get()).toEqual([])
  })

  it('reports offline / error, keeps points stored, and says "saved" only after the server confirms', async () => {
    let offline = true
    let release: (r: ExplorationResult) => void = () => undefined
    const upload = vi
      .fn<(p: TrackPoint[]) => Promise<ExplorationResult>>()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('500'))
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
    const store = memoryStore()
    const geo = new MockGeolocationService()
    const watchers: ((f: GeoFix) => void)[] = []
    vi.spyOn(geo, 'watchPosition').mockImplementation(async (onFix) => (watchers.push(onFix), () => undefined))
    let now = 1_000_000
    const tracker = new GpsExplorationTracker(geo, upload, {}, () => now, store, () => offline)
    await tracker.start()
    for (const [m, t] of [[0, 0], [12, 8]] as const) {
      now = 1_000_000 + t * 1000
      watchers[0]!(fix(m, t))
    }
    expect(store.get()).toHaveLength(2) // persisted before any upload
    now += 16_000
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tracker.state).toMatchObject({ sync: 'offline', pending: 2 })
    offline = false
    now += 16_000
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tracker.state.sync).toBe('error')
    now += 16_000
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tracker.state.sync).toBe('syncing') // in flight: not "saved" yet
    release(ok([], 0))
    await vi.advanceTimersByTimeAsync(0)
    expect(tracker.state).toMatchObject({ sync: 'saved', pending: 0 })
    expect(store.get()).toEqual([])
  })
})

describe('exploration store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('toggles tracking, merges server cells and disables itself on denied permission', async () => {
    installFakeServices()
    let resultListener: ((r: ExplorationResult) => void) | null = null
    let changeListener: ((s: { status: 'permission_denied'; accuracyM: null; pending: 0 }) => void) | null = null
    const fake = {
      state: { status: 'off' as const, accuracyM: null, pending: 0 },
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      onChange: vi.fn((l) => ((changeListener = l), () => undefined)),
      onResult: vi.fn((l) => ((resultListener = l), () => undefined)),
      onUploadError: vi.fn(() => () => undefined),
    }
    Object.assign(services(), { createExplorationTracker: () => fake })
    const store = useExplorationStore()
    await store.toggle()
    expect(store.enabled).toBe(true)
    expect(fake.start).toHaveBeenCalled()
    resultListener!(ok([[1, 2], [1, 3]], 7))
    expect(store.cellList).toHaveLength(2)
    expect(store.totalCells).toBe(7)
    expect(store.sessionCells).toBe(2)

    await store.pause() // background
    expect(fake.stop).toHaveBeenCalledTimes(1)
    expect(store.enabled).toBe(true)
    await store.resume()
    expect(fake.start).toHaveBeenCalledTimes(2)

    changeListener!({ status: 'permission_denied', accuracyM: null, pending: 0 })
    expect(store.enabled).toBe(false)
    await store.resume()
    expect(fake.start).toHaveBeenCalledTimes(2) // not resumed
  })

  it('loads explored cells for the viewport only when zoomed in', async () => {
    installFakeServices()
    const getExploredCells = vi.fn(async () => ({ cells: [[5, 6] as const], truncated: false, totalCells: 1 }))
    Object.assign(services().api, { getExploredCells })
    const store = useExplorationStore()
    const bbox = { minLng: 37.61, minLat: 55.65, maxLng: 37.63, maxLat: 55.66 }
    await store.loadViewport(bbox, 11)
    expect(getExploredCells).not.toHaveBeenCalled()
    await store.loadViewport(bbox, 15)
    await store.loadViewport(bbox, 15) // cached
    expect(getExploredCells).toHaveBeenCalledTimes(1)
    expect(store.cellList).toEqual([[5, 6]])
  })
})
