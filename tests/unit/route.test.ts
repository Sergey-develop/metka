import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { services } from '@/app/providers/services'
import type { GeoFix } from '@/services/geolocation/types'
import { MAX_WALK_M, OsrmRoutingService, parseOsrmRoute } from '@/services/routing/osrmRouting'
import { RoutingError, type RoutingService, type WalkingRoute } from '@/services/routing/types'
import { useMapStore } from '@/stores/map'
import { REBUILD_MIN_INTERVAL_MS, useRouteStore } from '@/stores/route'
import { walkRange } from '@/utils/geo'
import { BUILDING, installFakeServices } from './helpers'

const OK = {
  code: 'Ok',
  routes: [{ distance: 365.4, duration: 292.4, geometry: { type: 'LineString', coordinates: [[37.6177, 55.7558], [37.6203, 55.7541]] } }],
}

describe('parseOsrmRoute', () => {
  it('reads the line, distance and time', () => {
    expect(parseOsrmRoute(OK)).toEqual({ path: [[37.6177, 55.7558], [37.6203, 55.7541]], distanceM: 365.4, durationS: 292.4 })
  })

  it('tells "no route" from a broken answer', () => {
    expect(() => parseOsrmRoute({ code: 'NoRoute', routes: [] })).toThrow(expect.objectContaining({ code: 'no_route' }))
    expect(() => parseOsrmRoute({ code: 'Ok', routes: [{ distance: 'x' }] })).toThrow(expect.objectContaining({ code: 'unavailable' }))
    expect(() => parseOsrmRoute(null)).toThrow(expect.objectContaining({ code: 'unavailable' }))
  })
})

describe('OsrmRoutingService', () => {
  const from = { lat: 55.7558, lng: 37.6176 }
  const to = { lat: 55.7539, lng: 37.6208 }

  it('asks the foot profile and joins the line to both ends', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(OK)))
    const route = await new OsrmRoutingService('https://osrm.test/foot', fetchFn).walking(from, to)
    expect(fetchFn.mock.calls[0]![0]).toBe('https://osrm.test/foot/37.6176,55.7558;37.6208,55.7539?overview=full&geometries=geojson')
    expect(route.path[0]).toEqual([37.6176, 55.7558])
    expect(route.path.at(-1)).toEqual([37.6208, 55.7539])
    expect(route.path).toHaveLength(4)
  })

  it('reads NoRoute from a 400 answer', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ code: 'NoRoute' }), { status: 400 }))
    await expect(new OsrmRoutingService('https://osrm.test/foot', fetchFn).walking(from, to)).rejects.toMatchObject({ code: 'no_route' })
  })

  it('maps a failed request to network and refuses walks that are too long without asking', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(new OsrmRoutingService('https://osrm.test/foot', down).walking(from, to)).rejects.toMatchObject({ code: 'network' })
    const far = { lat: from.lat + (MAX_WALK_M + 1000) / 111_000, lng: from.lng }
    await expect(new OsrmRoutingService('https://osrm.test/foot', down).walking(from, far)).rejects.toMatchObject({ code: 'too_far' })
    expect(down).toHaveBeenCalledTimes(1)
  })
})

describe('walkRange', () => {
  it('rounds up to five-minute steps, as on the mockup', () => {
    expect(walkRange(200)).toBe('до 5 мин')
    expect(walkRange(292 + 60)).toBe('5–10 мин')
    expect(walkRange(17 * 60)).toBe('15–20 мин')
    expect(walkRange(20 * 60)).toBe('15–20 мин')
  })
})

describe('route store', () => {
  /** ~600 m south of the place */
  const fix = (dLat = -0.0055, at = 0): GeoFix => ({ lat: BUILDING.lat + dLat, lng: BUILDING.lng, accuracyM: 10, timestamp: at })
  const line = (n: number): WalkingRoute => ({ path: [[BUILDING.lng, BUILDING.lat - 0.0055], [BUILDING.lng, BUILDING.lat]], distanceM: 600 + n, durationS: 480 })
  let walking: Mock<RoutingService['walking']>

  beforeEach(() => {
    setActivePinia(createPinia())
    installFakeServices()
    walking = vi.fn<RoutingService['walking']>(async () => line(0))
    services().routing.walking = walking
    vi.useFakeTimers({ now: 1_000_000 })
  })
  afterEach(() => vi.useRealTimers())

  it('builds at once when the position is known', async () => {
    useMapStore().position = fix()
    const route = useRouteStore()
    route.start(BUILDING)
    expect(route.state).toBe('loading')
    await vi.waitFor(() => expect(route.state).toBe('ready'))
    expect(walking).toHaveBeenCalledWith(fix(), BUILDING, expect.any(AbortSignal))
    expect(route.route?.distanceM).toBe(600)
  })

  it('waits for the first fix', async () => {
    const route = useRouteStore()
    route.start(BUILDING)
    expect(route.state).toBe('waiting_position')
    useMapStore().position = fix()
    await nextTick()
    await vi.waitFor(() => expect(route.state).toBe('ready'))
  })

  it('rebuilds after the player has walked away from the start, not on every fix', async () => {
    const map = useMapStore()
    map.position = fix()
    const route = useRouteStore()
    route.start(BUILDING)
    await vi.waitFor(() => expect(route.state).toBe('ready'))
    walking.mockImplementation(async () => line(1))

    map.position = fix(-0.0053) // ~22 m
    await nextTick()
    vi.advanceTimersByTime(REBUILD_MIN_INTERVAL_MS)
    map.position = fix(-0.0054)
    await nextTick()
    expect(walking).toHaveBeenCalledTimes(1)

    map.position = fix(-0.0045) // ~110 m from the start
    await nextTick()
    await vi.waitFor(() => expect(route.route?.distanceM).toBe(601))
    expect(walking).toHaveBeenCalledTimes(2)
  })

  it('says the player has arrived and drops the line', async () => {
    const map = useMapStore()
    map.position = fix()
    const route = useRouteStore()
    route.start(BUILDING)
    await vi.waitFor(() => expect(route.state).toBe('ready'))
    map.position = fix(0.0001)
    await nextTick()
    expect(route.state).toBe('arrived')
    expect(route.route).toBeNull()
  })

  it('shows the error and retries on demand', async () => {
    walking.mockRejectedValueOnce(new RoutingError('no_route'))
    useMapStore().position = fix()
    const route = useRouteStore()
    route.start(BUILDING)
    await vi.waitFor(() => expect(route.state).toBe('error'))
    expect(route.errorCode).toBe('no_route')
    route.retry()
    await vi.waitFor(() => expect(route.state).toBe('ready'))
  })

  it('a finished route ignores a late answer', async () => {
    let resolve: (r: WalkingRoute) => void = () => undefined
    walking.mockImplementationOnce(() => new Promise<WalkingRoute>((r) => (resolve = r)))
    useMapStore().position = fix()
    const route = useRouteStore()
    route.start(BUILDING)
    route.stop()
    resolve(line(0))
    await Promise.resolve()
    expect(route.state).toBe('idle')
    expect(route.route).toBeNull()
  })
})
