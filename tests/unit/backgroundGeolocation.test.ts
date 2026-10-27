import { describe, expect, it, vi } from 'vitest'
import type { CallbackError, Location, WatcherOptions } from '@capacitor-community/background-geolocation'
import { MockGeolocationService } from '@/mocks'
import { BACKGROUND_MESSAGE, BackgroundWatchGeolocationService } from '@/services/geolocation/backgroundGeolocation'
import type { GeoFix } from '@/services/geolocation/types'
import { GeolocationError } from '@/services/geolocation/types'

type Callback = (location?: Location, error?: CallbackError) => void

function fakePlugin() {
  const watchers = new Map<string, { options: WatcherOptions; callback: Callback }>()
  let next = 0
  return {
    watchers,
    addWatcher: vi.fn(async (options: WatcherOptions, callback: Callback) => {
      const id = `w${++next}`
      watchers.set(id, { options, callback })
      return id
    }),
    removeWatcher: vi.fn(async ({ id }: { id: string }) => {
      watchers.delete(id)
    }),
  }
}

const location = (over: Partial<Location> = {}): Location => ({
  latitude: 56.5937,
  longitude: 36.5187,
  accuracy: 8,
  altitude: null,
  altitudeAccuracy: null,
  simulated: false,
  bearing: null,
  speed: null,
  time: 1_700_000_000_000,
  ...over,
})

describe('BackgroundWatchGeolocationService', () => {
  it('watches in background mode (a background message turns it on), fresh fixes only', async () => {
    const plugin = fakePlugin()
    const service = new BackgroundWatchGeolocationService(new MockGeolocationService(), plugin)
    const fixes: GeoFix[] = []
    await service.watchPosition((f) => fixes.push(f), () => undefined)
    const { options, callback } = [...plugin.watchers.values()][0]!
    expect(options).toMatchObject({ backgroundMessage: BACKGROUND_MESSAGE, requestPermissions: true, stale: false })
    expect(options.distanceFilter).toBeGreaterThan(0)
    callback(location())
    expect(fixes).toEqual([{ lat: 56.5937, lng: 36.5187, accuracyM: 8, timestamp: 1_700_000_000_000 }])
  })

  it('maps «not authorized» to permission_denied and stops delivering after unwatch', async () => {
    const plugin = fakePlugin()
    const service = new BackgroundWatchGeolocationService(new MockGeolocationService(), plugin)
    const fixes: GeoFix[] = []
    const errors: GeolocationError[] = []
    const unwatch = await service.watchPosition((f) => fixes.push(f), (e) => errors.push(e))
    const [id, { callback }] = [...plugin.watchers.entries()][0]!
    const denied = Object.assign(new Error('Location permission denied'), { code: 'NOT_AUTHORIZED' })
    callback(undefined, denied)
    expect(errors.map((e) => e.code)).toEqual(['permission_denied'])

    unwatch()
    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id })
    callback(location())
    expect(fixes).toEqual([])
  })

  it('leaves permission checks and one-off fixes to the regular service', async () => {
    const base = new MockGeolocationService({ lat: 1, lng: 2, accuracyM: 3, timestamp: 4 })
    const service = new BackgroundWatchGeolocationService(base, fakePlugin())
    expect(await service.checkPermission()).toBe('granted')
    expect(await service.getCurrentPosition()).toMatchObject({ lat: 1, lng: 2 })
  })
})
