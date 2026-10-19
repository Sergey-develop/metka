import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { services } from '@/app/providers/services'
import { GpsExplorationTracker, type ExplorationResult } from '@/services/exploration/explorationTracker'
import { CELL_LAT_DEG, CELL_LNG_DEG, cellBounds, cellOf, cellsToMultiPolygon, type Cell } from '@/services/exploration/grid'
import { TrackFilter, type TrackPoint } from '@/services/exploration/trackFilter'
import { GeolocationError, type GeoFix, type GeolocationService } from '@/services/geolocation/types'
import { MockGeolocationService } from '@/mocks'
import { RECENT_MS, useExplorationStore } from '@/stores/exploration'
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

  it('stop() during an upload waits for it and then sends the points that arrived meanwhile', async () => {
    let release: () => void = () => undefined
    const upload = vi
      .fn<(points: TrackPoint[]) => Promise<ExplorationResult>>()
      .mockImplementationOnce(() => new Promise((r) => (release = () => r(ok()))))
      .mockImplementation(async () => ok())
    const { tracker, send, watchers } = setup(upload)
    await tracker.start()
    for (let i = 0; i < 10; i++) send(i * 12, i * 8) // a full batch: upload starts
    send(10 * 12, 10 * 8) // arrives while the first upload is running
    send(11 * 12, 11 * 8)
    const stopping = tracker.stop()
    expect(watchers).toHaveLength(0) // GPS released at once
    release()
    await stopping
    expect(upload).toHaveBeenCalledTimes(2)
    expect((upload.mock.calls[1] as unknown as [TrackPoint[]])[0]).toHaveLength(2)
    expect(tracker.state).toMatchObject({ status: 'off', pending: 0, sync: 'saved' })
  })

  it('diagnostics: fixes, client drops, gaps over 30 s, uploads and server verdicts', async () => {
    const upload = vi.fn(async () => ({ accepted: 9, rejected: { too_fast: 1 }, newCells: [[1, 2] as const, [1, 3] as const], totalCells: 2 }))
    const { tracker, send } = setup(upload)
    await tracker.start()
    send(0, 0, 60) // inaccurate
    for (let i = 0; i < 10; i++) send(i * 12, i * 8)
    send(9 * 12 + 3, 9 * 8 + 2) // 3 m in 2 s after the last accepted point: standing still
    send(9 * 12 + 40, 9 * 8 + 47) // 47 s after the last accepted point, walking pace
    await vi.runOnlyPendingTimersAsync()
    const d = tracker.diagnostics
    expect(d).toMatchObject({ fixes: 13, sent: 10, serverAccepted: 9, newCells: 2, uploadsOk: 1, uploadsFailed: 0, starts: 1, gapsOver30s: 1 })
    expect(d.dropped).toMatchObject({ inaccurate: 1, too_close: 1 })
    expect(d.serverRejected).toEqual({ too_fast: 1 })
    expect(d.bestAccuracyM).toBe(8)
    d.dropped.inaccurate = 99 // a copy: the tracker's counters are not affected
    expect(tracker.diagnostics.dropped.inaccurate).toBe(1)
  })

  it('stop() with a failing upload ends promptly and keeps the points for the next start', async () => {
    const upload = vi.fn(async (): Promise<ExplorationResult> => {
      throw new Error('Failed to fetch')
    })
    const { tracker, send } = setup(upload)
    await tracker.start()
    send(0, 0)
    send(12, 8)
    await tracker.stop()
    expect(upload).toHaveBeenCalledTimes(1) // no retry loop on failure
    expect(tracker.state).toMatchObject({ status: 'off', pending: 2 })
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

  it('player pause: GPS off, survives background/foreground, resumes only on request', async () => {
    installFakeServices()
    const fake = {
      state: { status: 'off' as const, accuracyM: null, pending: 0 },
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      onChange: vi.fn(() => () => undefined),
      onResult: vi.fn(() => () => undefined),
      onUploadError: vi.fn(() => () => undefined),
    }
    Object.assign(services(), { createExplorationTracker: () => fake })
    const store = useExplorationStore()
    await store.pauseByPlayer() // not enabled: nothing to pause
    expect(store.paused).toBe(false)
    await store.enable()
    await store.pauseByPlayer()
    expect(store).toMatchObject({ enabled: true, paused: true })
    expect(fake.stop).toHaveBeenCalledTimes(1)
    await store.pause() // app to background
    await store.resume() // back to foreground: stays paused
    expect(fake.start).toHaveBeenCalledTimes(1)
    await store.resumeByPlayer()
    expect(store.paused).toBe(false)
    expect(fake.start).toHaveBeenCalledTimes(2)
    await store.pauseByPlayer()
    await store.disable() // switching off clears the pause
    expect(store).toMatchObject({ enabled: false, paused: false })
  })

  it('keeps the screen on exactly while exploring (on and not paused), counts background stops', async () => {
    installFakeServices()
    const fake = {
      state: { status: 'off' as const, accuracyM: null, pending: 0 },
      diagnostics: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      onChange: vi.fn(() => () => undefined),
      onResult: vi.fn(() => () => undefined),
      onUploadError: vi.fn(() => () => undefined),
    }
    Object.assign(services(), { createExplorationTracker: () => fake })
    const { keepOn, release } = vi.mocked(services().wakeLock)
    const store = useExplorationStore()
    await store.enable()
    expect(keepOn).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(store.screenKeptOn).toBe(true))
    await store.pauseByPlayer()
    expect(release).toHaveBeenCalledTimes(1)
    await store.resumeByPlayer()
    expect(keepOn).toHaveBeenCalledTimes(2)
    await store.pause() // app to background
    expect(store.backgroundStops).toBe(1)
    await store.disable()
    expect(release).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(store.screenKeptOn).toBe(false))
  })

  it('highlights freshly revealed cells and the last gain for a few seconds', async () => {
    vi.useFakeTimers()
    try {
      installFakeServices()
      let resultListener: ((r: ExplorationResult) => void) | null = null
      const fake = {
        state: { status: 'off' as const, accuracyM: null, pending: 0 },
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        onChange: vi.fn(() => () => undefined),
        onResult: vi.fn((l) => ((resultListener = l), () => undefined)),
        onUploadError: vi.fn(() => () => undefined),
      }
      Object.assign(services(), { createExplorationTracker: () => fake })
      const store = useExplorationStore()
      await store.enable()
      resultListener!(ok([[1, 2], [1, 3]], 2))
      expect(store.recentList).toHaveLength(2)
      expect(store.lastGain?.count).toBe(2)
      resultListener!(ok([], 2)) // nothing new: no notice change
      expect(store.lastGain?.count).toBe(2)
      vi.advanceTimersByTime(RECENT_MS + 1500)
      expect(store.recentList).toEqual([])
      expect(store.lastGain).toBeNull()
      expect(store.cellList).toHaveLength(2) // explored cells stay
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-loading known cells does not create a new cell list (no fog rebuild on map moves)', async () => {
    installFakeServices()
    const getExploredCells = vi.fn(async () => ({ cells: [[5, 6] as const, [5, 7] as const], truncated: false, totalCells: 2 }))
    Object.assign(services().api, { getExploredCells })
    const store = useExplorationStore()
    await store.loadViewport({ minLng: 37.61, minLat: 55.65, maxLng: 37.63, maxLat: 55.66 }, 15)
    const first = store.cellList
    await store.loadViewport({ minLng: 37.7, minLat: 55.7, maxLng: 37.72, maxLat: 55.71 }, 15) // same cells come back
    expect(getExploredCells).toHaveBeenCalledTimes(2)
    expect(store.cellList).toBe(first)
  })

  it('GameApi.getRecentExploredCells reads own cells newest first and validates them', async () => {
    const { GameApi } = await import('@/services/api/gameApi')
    const rows = { data: [{ cell_y: 1456534, cell_x: 1208997 }], error: null as unknown }
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    }
    const client = { from: vi.fn(() => query) }
    const api = new GameApi(client as never)
    expect(await api.getRecentExploredCells(50)).toEqual([[1456534, 1208997]])
    expect(client.from).toHaveBeenCalledWith('explored_cells')
    expect(query.order).toHaveBeenCalledWith('explored_at', { ascending: false })
    expect(query.limit).toHaveBeenCalledWith(50)
    rows.data = [{ cell_y: 1.5, cell_x: 2 }] as never
    await expect(api.getRecentExploredCells()).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('"show explored": area around the newest cell, far older cells ignored; null when nothing is explored', async () => {
    installFakeServices()
    const getRecentExploredCells = vi.fn(async () => [] as (readonly [number, number])[])
    Object.assign(services().api, { getRecentExploredCells })
    const store = useExplorationStore()
    expect(await store.latestExploredArea()).toBeNull()
    getRecentExploredCells.mockResolvedValueOnce([
      [1456534, 1208997],
      [1456535, 1208998],
      [1450000, 1200000], // an old walk far away
    ])
    const area = await store.latestExploredArea()
    expect(area![0][0]).toBeCloseTo(1208997 * 0.00018 - 180, 9)
    expect(area![1][1]).toBeCloseTo(1456536 * 0.0001 - 90, 9)
    expect(store.cellList).toHaveLength(3) // merged: the fog opens there at once
    const box = (lng: number, lat: number) => ({ minLng: lng - 0.001, minLat: lat - 0.001, maxLng: lng + 0.001, maxLat: lat + 0.001 })
    expect(store.anyExploredIn(box(1208997 * 0.00018 - 180, 1456534 * 0.0001 - 90))).toBe(true)
    expect(store.anyExploredIn(box(37.9, 55.9))).toBe(false)
    getRecentExploredCells.mockRejectedValueOnce(new Error('offline'))
    await expect(store.latestExploredArea()).rejects.toThrow()
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
