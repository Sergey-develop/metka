import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { services, setServices } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import { MediaDevicesCameraPreview } from '@/services/camera/preview'
import { CameraError } from '@/services/camera/types'
import { GeolocationError, type GeoFix } from '@/services/geolocation/types'
import { DeviceOrientationService, rearCameraHeading } from '@/services/orientation/deviceOrientation'
import type { HeadingReading } from '@/services/orientation/types'
import type { AppPermissionState } from '@/services/shared'
import { useArScanStore } from '@/stores/arScan'
import type { BuildingOutline, OutlinesPage } from '@/types/game'
import { installFakeServices } from './helpers'

const ORIGIN = { lat: 55.6534, lng: 37.6196 }
const KX = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111_320
const KY = 110_540
const ll = (x: number, y: number): [number, number] => [ORIGIN.lng + x / KX, ORIGIN.lat + y / KY]
function rect(id: number, x0: number, y0: number, x1: number, y1: number): BuildingOutline {
  return {
    id,
    osmType: 'way',
    osmId: id,
    geometry: { type: 'Polygon', coordinates: [[ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]] },
    name: `#${id}`,
    address: null,
    category: null,
    game: null,
  }
}
const NORTH = rect(1, -15, 40, 15, 60)
const EAST = rect(2, 40, -15, 60, 15)
const fix = (accuracyM = 5, dx = 0, dy = 0): GeoFix => ({ lat: ORIGIN.lat + dy / KY, lng: ORIGIN.lng + dx / KX, accuracyM, timestamp: 0 })

function setup(opts: { cameraError?: CameraError; geoPermission?: AppPermissionState; compass?: AppPermissionState } = {}) {
  installFakeServices()
  let emitFix: (f: GeoFix) => void = () => undefined
  let emitGeoError: (e: GeolocationError) => void = () => undefined
  let emitHeading: (r: HeadingReading) => void = () => undefined
  let headingUnavailable: () => void = () => undefined
  const camStop = vi.fn()
  const geoStop = vi.fn()
  const headingStop = vi.fn()
  const getBuildingOutlines = vi.fn(async (): Promise<OutlinesPage> => ({ features: [NORTH, EAST], truncated: false }))
  const base = services()
  Object.assign(base.api, { getBuildingOutlines, getBuildingFacts: vi.fn(async () => ({})) })
  const fakes = {
    cameraPreview: {
      isSupported: () => true,
      start: vi.fn(async () => {
        if (opts.cameraError) throw opts.cameraError
        return { stop: camStop }
      }),
    },
    geolocation: {
      checkPermission: vi.fn(async () => opts.geoPermission ?? 'granted'),
      requestPermission: vi.fn(async () => opts.geoPermission ?? 'granted'),
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(async (onFix: (f: GeoFix) => void, onError: (e: GeolocationError) => void) => {
        emitFix = onFix
        emitGeoError = onError
        return geoStop
      }),
    },
    orientation: {
      isSupported: () => true,
      requestPermission: vi.fn(async () => opts.compass ?? 'granted'),
      watchHeading: vi.fn((onReading: (r: HeadingReading) => void, onUnavailable: () => void) => {
        emitHeading = onReading
        headingUnavailable = onUnavailable
        return headingStop
      }),
    },
  }
  setServices({ ...base, ...fakes })
  const heading = (deg: number, accuracyDeg: number | null = 10, upright = true) =>
    emitHeading({ deg, accuracyDeg, upright, timestamp: Date.now() })
  return {
    ...fakes,
    getBuildingOutlines,
    camStop,
    geoStop,
    headingStop,
    fix: (f: GeoFix) => emitFix(f),
    geoError: (e: GeolocationError) => emitGeoError(e),
    heading,
    headingUnavailable: () => headingUnavailable(),
  }
}

const video = {} as HTMLVideoElement
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(0)
})
afterEach(() => vi.useRealTimers())

describe('arScan store', () => {
  it('camera → GPS → nearby footprints → compass → a steady selection with card data', async () => {
    const s = setup()
    const store = useArScanStore()
    await store.start(video)
    expect(store.phase).toBe('running')
    s.fix(fix())
    await flush()
    const [bbox, zoom] = s.getBuildingOutlines.mock.calls[0] as unknown as [{ minLat: number; maxLat: number }, number]
    expect(zoom).toBe(18)
    expect(bbox.maxLat - bbox.minLat).toBeCloseTo(500 / KY, 6)
    expect(store.outlinesState).toBe('ready')

    s.heading(0)
    expect(store.match?.status).toBe('likely')
    expect(store.selection.id).toBeNull() // not before the hold time
    vi.setSystemTime(900)
    s.heading(0)
    expect(store.selection).toEqual({ id: 1, manual: false })
    expect(services().api.getBuildingFacts).toHaveBeenCalledWith(1)
    expect(store.distanceM).toBeCloseTo(40, 0)
  })

  it('does not switch on a brief glance at another building', async () => {
    const s = setup()
    const store = useArScanStore()
    await store.start(video)
    s.fix(fix())
    await flush()
    s.heading(0)
    vi.setSystemTime(900)
    s.heading(0)
    vi.setSystemTime(1200)
    for (let i = 0; i < 5; i++) s.heading(90) // smoothing + hold: still the first building
    expect(store.selection.id).toBe(1)
  })

  it('rough GPS: no automatic choice, a nearby list instead, no distance shown', async () => {
    const s = setup()
    const store = useArScanStore()
    await store.start(video)
    s.fix(fix(60))
    await flush()
    s.heading(0)
    vi.setSystemTime(2000)
    s.heading(0)
    expect(store.match?.status).toBe('inaccurate')
    expect(store.selection.id).toBeNull()
    expect(store.match?.nearby.map((n) => n.outline.id).sort()).toEqual([1, 2])
    store.choose(2)
    expect(store.selection).toEqual({ id: 2, manual: true })
    expect(store.distanceM).toBeNull()
  })

  it('a manual choice holds until the player walks away or switches back to auto', async () => {
    const s = setup()
    const store = useArScanStore()
    await store.start(video)
    s.fix(fix())
    await flush()
    store.choose(2)
    s.heading(0)
    vi.setSystemTime(5000)
    s.heading(0)
    expect(store.selection).toEqual({ id: 2, manual: true })
    s.fix(fix(5, 0, 50))
    expect(store.selection.manual).toBe(false)
  })

  it('phone held flat: no heading, nothing is guessed', async () => {
    const s = setup()
    const store = useArScanStore()
    await store.start(video)
    s.fix(fix())
    await flush()
    s.heading(0, 10, false)
    expect(store.headingState).toBe('flat')
    expect(store.match?.status).toBe('no_heading')
  })

  it('iOS: compass needs a tap; no compass at all → manual list', async () => {
    const s = setup({ compass: 'prompt' })
    const store = useArScanStore()
    await store.start(video)
    expect(store.headingState).toBe('needs_permission')
    expect(s.orientation.watchHeading).not.toHaveBeenCalled()
    s.orientation.requestPermission.mockResolvedValueOnce('granted')
    await store.enableCompass()
    expect(s.orientation.watchHeading).toHaveBeenCalledTimes(1)
    s.headingUnavailable()
    expect(store.headingState).toBe('unavailable')
  })

  it('camera errors fail before asking for location', async () => {
    const s = setup({ cameraError: new CameraError('permission_denied') })
    const store = useArScanStore()
    await store.start(video)
    expect(store.phase).toBe('failed')
    expect(store.failure).toBe('camera_denied')
    expect(s.geolocation.watchPosition).not.toHaveBeenCalled()
  })

  it('location denied stops the camera', async () => {
    const s = setup({ geoPermission: 'denied' })
    const store = useArScanStore()
    await store.start(video)
    expect(store.failure).toBe('location_denied')
    expect(s.camStop).toHaveBeenCalled()
  })

  it('GPS timeouts are not fatal; GPS turned off is', async () => {
    const s = setup()
    const store = useArScanStore()
    await store.start(video)
    s.geoError(new GeolocationError('timeout'))
    expect(store.phase).toBe('running')
    expect(store.gps).toBe('lost')
    s.geoError(new GeolocationError('disabled'))
    expect(store.failure).toBe('gps_disabled')
  })

  it('network error loading footprints is shown and can be retried', async () => {
    const s = setup()
    s.getBuildingOutlines.mockRejectedValueOnce(new ApiError('offline'))
    const store = useArScanStore()
    await store.start(video)
    s.fix(fix())
    await flush()
    expect(store.outlinesState).toBe('error')
    expect(store.outlinesError?.code).toBe('offline')
    store.retryOutlines()
    await flush()
    expect(store.outlinesState).toBe('ready')
  })

  it('does not refetch footprints for small moves, refetches after 100 m', async () => {
    const s = setup()
    const store = useArScanStore()
    await store.start(video)
    s.fix(fix())
    await flush()
    s.fix(fix(5, 30, 0))
    await flush()
    expect(s.getBuildingOutlines).toHaveBeenCalledTimes(1)
    s.fix(fix(5, 120, 0))
    await flush()
    expect(s.getBuildingOutlines).toHaveBeenCalledTimes(2)
  })

  it('stop() releases the camera, GPS and compass', async () => {
    const s = setup()
    const store = useArScanStore()
    await store.start(video)
    store.stop()
    expect(s.camStop).toHaveBeenCalled()
    expect(s.geoStop).toHaveBeenCalled()
    expect(s.headingStop).toHaveBeenCalled()
    expect(store.phase).toBe('idle')
  })

  it('leaving while the camera is starting still releases it', async () => {
    const s = setup()
    let resolve: (h: { stop: typeof s.camStop }) => void = () => undefined
    s.cameraPreview.start.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    const store = useArScanStore()
    const started = store.start(video)
    store.stop()
    resolve({ stop: s.camStop })
    await started
    expect(s.camStop).toHaveBeenCalled()
    expect(s.geolocation.watchPosition).not.toHaveBeenCalled()
  })
})

describe('rearCameraHeading', () => {
  it('upright phone: alpha turns the camera direction (W3C: alpha counter-clockwise)', () => {
    expect(rearCameraHeading(0, 90, 0)).toBeCloseTo(0, 6)
    expect(rearCameraHeading(90, 90, 0)).toBeCloseTo(270, 6)
    expect(rearCameraHeading(270, 90, 0)).toBeCloseTo(90, 6)
    expect(rearCameraHeading(180, 90, 0)).toBeCloseTo(180, 6)
  })
})

describe('DeviceOrientationService', () => {
  function fakeWindow(withAbsolute: boolean) {
    const target = new EventTarget()
    const win = Object.assign(target, { DeviceOrientationEvent: class {} }) as unknown as Window
    if (withAbsolute) Object.assign(win, { ondeviceorientationabsolute: null })
    return { win, fire: (type: string, props: Record<string, unknown>) => target.dispatchEvent(Object.assign(new Event(type), props)) }
  }

  it('iOS compass heading and accuracy are used as is', () => {
    const { win, fire } = fakeWindow(false)
    const readings: HeadingReading[] = []
    const stop = new DeviceOrientationService(win).watchHeading((r) => readings.push(r), () => undefined)
    fire('deviceorientation', { webkitCompassHeading: 123, webkitCompassAccuracy: 15, alpha: 10, beta: 80, gamma: 0, absolute: false })
    expect(readings[0]).toMatchObject({ deg: 123, accuracyDeg: 15, upright: true })
    stop()
  })

  it('ignores relative-only orientation instead of treating it as a compass', () => {
    vi.useRealTimers()
    vi.useFakeTimers()
    const { win, fire } = fakeWindow(false)
    const onUnavailable = vi.fn()
    const readings: HeadingReading[] = []
    const stop = new DeviceOrientationService(win).watchHeading((r) => readings.push(r), onUnavailable)
    fire('deviceorientation', { alpha: 10, beta: 80, gamma: 0, absolute: false })
    vi.advanceTimersByTime(3000)
    expect(readings).toEqual([])
    expect(onUnavailable).toHaveBeenCalled()
    stop()
  })

  it('Android absolute events become a rear-camera heading; flat phone is flagged', () => {
    const { win, fire } = fakeWindow(true)
    const readings: HeadingReading[] = []
    const stop = new DeviceOrientationService(win).watchHeading((r) => readings.push(r), () => undefined)
    fire('deviceorientationabsolute', { alpha: 90, beta: 90, gamma: 0, absolute: true })
    fire('deviceorientationabsolute', { alpha: 0, beta: 5, gamma: 3, absolute: true })
    expect(readings[0]?.deg).toBeCloseTo(270, 6)
    expect(readings[0]?.accuracyDeg).toBeNull()
    expect(readings[1]?.upright).toBe(false)
    stop()
  })
})

describe('MediaDevicesCameraPreview', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps getUserMedia errors to camera error codes', async () => {
    for (const [name, code] of [
      ['NotAllowedError', 'permission_denied'],
      ['NotFoundError', 'unavailable'],
      ['AbortError', 'failed'],
    ] as const) {
      const err = Object.assign(new Error(name), { name })
      vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(err)) } })
      await expect(new MediaDevicesCameraPreview().start({} as HTMLVideoElement)).rejects.toMatchObject({ code })
    }
  })

  it('stop() ends every track and detaches the stream', async () => {
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track] }
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } })
    const videoEl = { srcObject: null as unknown, play: vi.fn(async () => undefined) } as unknown as HTMLVideoElement
    const handle = await new MediaDevicesCameraPreview().start(videoEl)
    expect(videoEl.srcObject).toBe(stream)
    handle.stop()
    expect(track.stop).toHaveBeenCalled()
    expect(videoEl.srcObject).toBeNull()
  })
})
