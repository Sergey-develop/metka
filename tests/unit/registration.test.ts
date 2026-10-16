import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FigureLoader from '@/components/ui/FigureLoader.vue'
import { services } from '@/app/providers/services'
import { useAuthStore } from '@/stores/auth'
import { useClanStore } from '@/stores/clan'
import { useMapStore } from '@/stores/map'
import { useScanStore } from '@/stores/scan'
import { BUILDING, installFakeServices } from './helpers'

let fakes: ReturnType<typeof installFakeServices>

beforeEach(() => {
  setActivePinia(createPinia())
  fakes = installFakeServices()
  useMapStore().buildings = new Map([[BUILDING.id, { ...BUILDING }]])
})

describe('location permission (asked when the map opens)', () => {
  it('explains before the OS prompt and only asks the OS once confirmed', async () => {
    fakes.geolocation.permission = 'prompt'
    const request = vi.spyOn(fakes.geolocation, 'requestPermission').mockResolvedValue('granted')
    const map = useMapStore()

    await map.startTracking()
    expect(map.locationPrompt).toBe(true)
    expect(request).not.toHaveBeenCalled()

    await map.startTracking('confirmed')
    expect(request).toHaveBeenCalledOnce()
    expect(map.locationPrompt).toBe(false)
    expect(map.position).not.toBeNull()
  })

  it('does not nag after "not now" until the player taps locate', async () => {
    fakes.geolocation.permission = 'prompt'
    const map = useMapStore()
    await map.startTracking()
    map.dismissLocationPrompt()

    await map.startTracking() // e.g. app resumed
    expect(map.locationPrompt).toBe(false)
    await map.startTracking('user')
    expect(map.locationPrompt).toBe(true)
  })

  it('skips the explanation when already granted', async () => {
    const map = useMapStore()
    await map.startTracking()
    expect(map.locationPrompt).toBe(false)
    expect(map.position).not.toBeNull()
  })
})

describe('camera permission (asked at the first scan)', () => {
  it('explains before the OS prompt, then continues the capture', async () => {
    fakes.camera.permission = 'prompt'
    const request = vi.spyOn(fakes.camera, 'requestPermission').mockResolvedValue('granted')
    const takePhoto = vi.spyOn(fakes.camera, 'takePhoto')
    const scan = useScanStore()
    scan.start(BUILDING.id)

    await scan.capture()
    expect(scan.cameraPrompt).toBe(true)
    expect(scan.phase).toBe('ready')
    expect(scan.failure).toBeNull()
    expect(request).not.toHaveBeenCalled()
    expect(takePhoto).not.toHaveBeenCalled()

    await scan.confirmCamera()
    expect(request).toHaveBeenCalledOnce()
    expect(takePhoto).toHaveBeenCalledOnce()
    expect(scan.cameraPrompt).toBe(false)
  })
})

describe('map viewport loading', () => {
  it('never asks the server for more than 1° (buildings_in_bbox rejects it)', async () => {
    const fetch = vi.mocked(services().api.getBuildingsInBbox)
    // widest viewport the store still loads (0.9°): unclamped 25% padding would make it 1.35°
    await useMapStore().loadViewport({ minLng: 37.2, minLat: 55.4, maxLng: 38.1, maxLat: 56.3 })
    const bbox = fetch.mock.calls[0]?.[0]
    expect(bbox).toBeDefined()
    expect(bbox!.maxLng - bbox!.minLng).toBeLessThan(1)
    expect(bbox!.maxLat - bbox!.minLat).toBeLessThan(1)
    expect(bbox!.minLng).toBeLessThanOrEqual(37.2)
    expect(bbox!.maxLat).toBeGreaterThanOrEqual(56.3)
  })
})

describe('clan loading', () => {
  it('reports a failed load as an error, not as "not in a clan", and keeps the shown clan', async () => {
    useAuthStore().session = { user: { id: 'u1' } } as never
    const api = services().api as unknown as Record<string, ReturnType<typeof vi.fn>>
    const membership = { clan: { id: 'c1', name: 'Север', tag: 'SEV', ownerId: 'u1', avatarUrl: null }, role: 'owner', members: [] }
    api.getMyClan = vi.fn().mockResolvedValueOnce(membership).mockRejectedValueOnce(new Error('column clans.avatar_path does not exist'))
    api.getClanLeaderboard = vi.fn().mockResolvedValue([])
    const clan = useClanStore()

    await clan.load()
    expect(clan.membership?.clan.id).toBe('c1')
    expect(clan.loadError).toBeNull()

    await clan.load() // e.g. after a reload against a database missing a migration
    expect(clan.loadError).not.toBeNull()
    expect(clan.membership?.clan.id).toBe('c1')
    expect(clan.error).toBeNull() // action errors stay separate
  })
})

describe('FigureLoader', () => {
  afterEach(() => vi.useRealTimers())

  it('alternates the four figures', async () => {
    vi.useFakeTimers()
    const w = mount(FigureLoader)
    const frames = new Set<string>()
    for (let i = 0; i < 4; i++) {
      frames.add(w.find('svg').html())
      await vi.advanceTimersByTimeAsync(480)
    }
    expect(frames.size).toBe(4)
    expect(w.attributes('role')).toBe('status')
    w.unmount()
  })

  it('changes the tile colour with each figure in tiles mode', async () => {
    vi.useFakeTimers()
    const w = mount(FigureLoader, { props: { tiles: true } })
    const colors = new Set<string>()
    for (let i = 0; i < 4; i++) {
      colors.add(w.find('.loader__tile').attributes('style') ?? '')
      await vi.advanceTimersByTimeAsync(480)
    }
    expect(colors.size).toBe(4)
    w.unmount()
  })
})
