import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { services, setServices } from '@/app/providers/services'
import ArScanView from '@/features/scanner/ArScanView.vue'
import { CameraError } from '@/services/camera/types'
import type { GeoFix } from '@/services/geolocation/types'
import type { BuildingOutline } from '@/types/game'
import { installFakeServices } from './helpers'

const ORIGIN = { lat: 55.6534, lng: 37.6196 }
const KX = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111_320
const ll = (x: number, y: number): [number, number] => [ORIGIN.lng + x / KX, ORIGIN.lat + y / 110_540]
const outline = (id: number, name: string, x: number, y: number): BuildingOutline => ({
  id,
  osmType: 'way',
  osmId: id,
  geometry: { type: 'Polygon', coordinates: [[ll(x, y), ll(x + 20, y), ll(x + 20, y + 20), ll(x, y + 20), ll(x, y)]] },
  name,
  address: null,
  category: null,
  game: null,
})

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/map', component: { template: '<div/>' } },
      { path: '/scan', name: 'ar-scan', component: ArScanView },
      { path: '/scan/:buildingId', name: 'scan', component: { template: '<div/>' } },
    ],
  })
}

function install(over: { cameraError?: CameraError; accuracyM?: number }) {
  installFakeServices()
  const base = services()
  Object.assign(base.api, {
    getBuildingOutlines: vi.fn(async () => ({ features: [outline(1, 'Школа', 10, 10), outline(2, 'Дом', -40, 10)], truncated: false })),
  })
  setServices({
    ...base,
    cameraPreview: {
      isSupported: () => true,
      start: vi.fn(async () => {
        if (over.cameraError) throw over.cameraError
        return { stop: vi.fn() }
      }),
    },
    geolocation: {
      checkPermission: vi.fn(async () => 'granted' as const),
      requestPermission: vi.fn(async () => 'granted' as const),
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(async (onFix: (f: GeoFix) => void) => {
        onFix({ ...ORIGIN, accuracyM: over.accuracyM ?? 5, timestamp: 0 })
        return () => undefined
      }),
    },
    orientation: { isSupported: () => false, requestPermission: vi.fn(async () => 'denied' as const), watchHeading: vi.fn(() => () => undefined) },
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('ArScanView', () => {
  it('camera denied: explains and offers retry / back to the map', async () => {
    install({ cameraError: new CameraError('permission_denied') })
    const r = router()
    await r.push('/scan')
    const w = mount(ArScanView, { global: { plugins: [r] }, attachTo: document.body })
    await flushPromises()
    expect(w.find('.ar__failure').text()).toContain('Нет доступа к камере')
    expect(w.findAll('.ar__failure button').map((b) => b.text())).toEqual(['Попробовать снова', 'Назад к карте'])
    w.unmount()
  })

  it('no compass: says so, no «Здания рядом» list and no automatic pick', async () => {
    install({})
    const r = router()
    await r.push('/scan')
    const w = mount(ArScanView, { global: { plugins: [r] }, attachTo: document.body })
    await flushPromises()
    expect(w.find('.ar__status').text()).toContain('Компас недоступен')
    expect(w.find('.ar__choice').exists()).toBe(false)
    expect(w.text()).not.toContain('Здания рядом')
    expect(w.find('.info').exists()).toBe(false)
    w.unmount()
  })
})
