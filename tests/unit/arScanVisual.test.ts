import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { services, setServices } from '@/app/providers/services'
import type { GeoFix } from '@/services/geolocation/types'
import { parseReferenceSet } from '@/services/scan/visualMatch'
import type { VisualRecognizer } from '@/services/scan/visualRecognizer'
import { useArScanStore } from '@/stores/arScan'
import type { BuildingOutline, OutlinesPage } from '@/types/game'
import { installFakeServices } from './helpers'

// The scan screen in Zavidovo: a camera frame like a corpus's photos takes the card.

const frames: number[][] = []
const recognizer: VisualRecognizer = {
  set: parseReferenceSet(
    {
      version: 'test-v1',
      modelUrl: 'model.onnx',
      inputSize: 224,
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      scoreThreshold: 0.75,
      marginThreshold: 0.04,
      references: [
        { label: 'Северный', osm: 'way/1', e: [1, 0, 0] },
        { label: 'Восточный', osm: 'way/2', e: [0, 1, 0] },
        { label: 'Бухта', osm: null, e: [0, 0, 1] },
      ],
    },
    'https://app.test/r/references.json',
  ),
  embedFrame: vi.fn(async () => Float32Array.from(frames.shift() ?? [0, 0, 1])),
}
vi.mock('@/services/scan/visualRecognizer', () => ({ loadVisualRecognizer: vi.fn(async () => recognizer) }))

const ORIGIN = { lat: 56.5925, lng: 36.523 } // the Zavidovo bay
const KX = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111_320
const KY = 110_540
const ll = (x: number, y: number): [number, number] => [ORIGIN.lng + x / KX, ORIGIN.lat + y / KY]
const rect = (id: number, x0: number, y0: number, x1: number, y1: number): BuildingOutline => ({
  id,
  osmType: 'way',
  osmId: id,
  geometry: { type: 'Polygon', coordinates: [[ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]] },
  name: `#${id}`,
  address: null,
  category: null,
  game: null,
})
const NORTH = rect(1, -15, 40, 15, 60)
const EAST = rect(2, 40, -15, 60, 15)

async function setup() {
  installFakeServices()
  let emitFix: (f: GeoFix) => void = () => undefined
  const base = services()
  Object.assign(base.api, {
    getBuildingOutlines: vi.fn(async (): Promise<OutlinesPage> => ({ features: [NORTH, EAST], truncated: false })),
    getBuildingFacts: vi.fn(async () => ({})),
  })
  setServices({
    ...base,
    cameraPreview: { isSupported: () => true, start: vi.fn(async () => ({ stop: vi.fn() })) },
    geolocation: {
      checkPermission: vi.fn(async () => 'granted' as const),
      requestPermission: vi.fn(async () => 'granted' as const),
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(async (onFix: (f: GeoFix) => void) => {
        emitFix = onFix
        return vi.fn()
      }),
    },
    // no compass: every corpus close by may be the one in view
    orientation: { isSupported: () => false, requestPermission: vi.fn(), watchHeading: vi.fn() },
  })
  const store = useArScanStore()
  await store.start({} as HTMLVideoElement)
  emitFix({ ...ORIGIN, accuracyM: 5, timestamp: 0 })
  await vi.advanceTimersByTimeAsync(0)
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout'] })
  frames.length = 0
})
afterEach(() => {
  useArScanStore().stop()
  vi.useRealTimers()
})

describe('arScan: recognition by look (Zavidovo)', () => {
  it('two frames in a row like a corpus open its card; then the camera rests', async () => {
    const store = await setup()
    expect(store.match?.status).toBe('no_heading')
    expect(store.selection.id).toBeNull()
    frames.push([0, 1, 0], [0, 1, 0])
    await vi.advanceTimersByTimeAsync(1500)
    expect(store.selection.id).toBeNull() // once may be a glimpse
    await vi.advanceTimersByTimeAsync(1500)
    expect(store.selection).toEqual({ id: 2, manual: false })
    expect(store.visual?.label).toBe('Восточный')
    const calls = vi.mocked(recognizer.embedFrame).mock.calls.length
    await vi.advanceTimersByTimeAsync(4500)
    expect(vi.mocked(recognizer.embedFrame).mock.calls.length).toBe(calls) // confirmed: no more inference
  })

  it('a frame like the bay or two different corpuses in a row open nothing', async () => {
    const store = await setup()
    frames.push([0, 0, 1], [0, 0, 1], [1, 0, 0], [0, 1, 0])
    await vi.advanceTimersByTimeAsync(1500 * 4)
    expect(store.selection.id).toBeNull()
  })

  it('the player’s own choice is never replaced', async () => {
    const store = await setup()
    store.choose(1)
    frames.push([0, 1, 0], [0, 1, 0])
    await vi.advanceTimersByTimeAsync(1500 * 2)
    expect(store.selection).toEqual({ id: 1, manual: true })
  })
})
