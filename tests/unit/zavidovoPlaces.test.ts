import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import PlaceDetailView from '@/features/routes/PlaceDetailView.vue'
import RoutesView from '@/features/routes/RoutesView.vue'
import { pickWalk } from '@/features/routes/random'
import { useMapStore } from '@/stores/map'
import type { AreaPlace, AreaQuests, CheckInResult, PlaceTag } from '@/types/game'
import { installFakeServices, type FakeServices } from './helpers'

const place = (id: string, lat: number, lng: number, tags: PlaceTag[], over: Partial<AreaPlace> = {}): AreaPlace => ({
  id,
  zone: 'resort',
  category: 'Место',
  name: id,
  description: '',
  idea: null,
  address: null,
  lat,
  lng,
  radiusM: 60,
  isPartner: false,
  needsCheck: false,
  tags,
  openingHours: null,
  phone: null,
  website: null,
  rewardXp: 10,
  rewardCoins: 0,
  ...over,
})

const BAY = { lat: 56.59365, lng: 36.51869 }
const PLACES = [
  place('zav-bay', BAY.lat, BAY.lng, ['free', 'kids']),
  place('zav-bridge', 56.59821, 36.51882, ['free']),
  place('zav-memorial', 56.59299, 36.53194, ['culture', 'free']),
  place('zav-tennis', 56.59646, 36.51722, ['sport']),
  place('zav-tsarevna', 56.60028, 36.51376, ['food'], { isPartner: true, rewardXp: 20, rewardCoins: 10 }),
  place('zav-alpaca', 56.593597, 36.539613, ['kids']),
]

describe('pickWalk', () => {
  const noRandom = () => 0

  it('a pair that wants to be surprised walks the free and culture places and finishes at a café', () => {
    const w = pickWalk(PLACES, { mood: 'surprise', minutes: 30, company: 'pair', reach: 'resort' }, BAY, new Set(), noRandom)
    expect(w.stops).toHaveLength(3)
    expect(w.stops.at(-1)!.place.id).toBe('zav-tsarevna')
    expect(w.stops.slice(0, -1).every((s) => s.place.tags.some((t) => t === 'free' || t === 'culture'))).toBe(true)
    // the walk starts at the nearest stop and the distance adds up
    expect(w.stops[0]!.place.id).toBe('zav-bay')
    expect(w.totalM).toBeCloseTo(w.stops.reduce((s, x) => s + x.legM, 0))
  })

  it('«рядом» keeps within 800 m, visited places go last, a sporty walk alone has no café', () => {
    const near = pickWalk(PLACES, { mood: 'surprise', minutes: 45, company: 'alone', reach: 'near' }, BAY, new Set(), noRandom)
    expect(near.stops.map((s) => s.place.id)).not.toContain('zav-memorial') // ≈ 830 m from the bay
    const sport = pickWalk(PLACES, { mood: 'move', minutes: 20, company: 'alone', reach: 'resort' }, BAY, new Set(['zav-bay']), noRandom)
    expect(sport.stops[0]!.place.id).toBe('zav-tennis')
    expect(sport.stops.some((s) => s.place.tags.includes('food'))).toBe(false)
  })

  it('with kids, the kids places come first', () => {
    const w = pickWalk(PLACES, { mood: 'relax', minutes: 20, company: 'kids', reach: 'resort' }, BAY, new Set(), noRandom)
    expect(w.stops.map((s) => s.place.id)).toEqual(expect.arrayContaining(['zav-bay']))
    expect(w.stops.every((s) => s.place.tags.includes('kids') || s.place.tags.includes('free'))).toBe(true)
  })
})

const QUESTS: AreaQuests = { routes: [], places: PLACES, visits: [], collections: [] }
type Api = {
  getAreaQuests: () => Promise<AreaQuests>
  checkInPlace: (id: string, at: { lat: number; lng: number; accuracyM: number }) => Promise<CheckInResult>
}
const api = () => services().api as unknown as Api
let fake: FakeServices

async function mountAt(path: string, component: typeof PlaceDetailView | typeof RoutesView, props: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/routes', component: { template: '<div/>' } },
      { path: '/routes/random', name: 'random-route', component: { template: '<div/>' } },
      { path: '/routes/:slug', name: 'route', component: { template: '<div/>' } },
      { path: '/places/:id', name: 'place', component: { template: '<div/>' } },
      { path: '/map', component: { template: '<div/>' } },
    ],
  })
  await router.push(path)
  const w = mount(component, { props, global: { plugins: [router] } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  fake = installFakeServices()
  fake.geolocation.setPosition(56.60028, 36.51376, 8)
  api().getAreaQuests = vi.fn(async () => structuredClone(QUESTS))
})

describe('PlaceDetailView check-in', () => {
  it('checks in a partner with the current position and shows the reward', async () => {
    api().checkInPlace = vi.fn(async () => ({
      status: 'done' as const,
      reward: { xp: 20, coins: 10 },
      artifacts: [],
      profile: null,
    }))
    const w = await mountAt('/places/zav-tsarevna', PlaceDetailView, { id: 'zav-tsarevna' })
    expect(w.find('.pd__task-title').text()).toBe('Задание партнёра')
    expect(w.find('.pd__task-text').text()).toContain('+20 опыта')
    await w.find('.pd__task .pd__primary').trigger('click')
    await flushPromises()
    expect(api().checkInPlace).toHaveBeenCalledWith('zav-tsarevna', { lat: 56.60028, lng: 36.51376, accuracyM: 8 })
    expect(w.find('.pd__result').text()).toContain('+20 опыта · +10 монет')
    expect(w.find('.pd__task-title').text()).toBe('Ты здесь отметился')
  })

  it('says how far the place is', async () => {
    api().checkInPlace = vi.fn(async () => ({ status: 'too_far' as const, distanceM: 640, radiusM: 60 }))
    const w = await mountAt('/places/zav-bay', PlaceDetailView, { id: 'zav-bay' })
    await w.find('.pd__task .pd__primary').trigger('click')
    await flushPromises()
    expect(w.find('.pd__result').text()).toContain('До точки ещё')
    expect(w.find('.pd__task-title').text()).toBe('Самостоятельное задание')
  })
})

describe('RoutesView extras', () => {
  it('«Рядом с тобой» lists the three nearest places not visited; the random walk card is on the routes tab', async () => {
    const quests = structuredClone(QUESTS)
    quests.visits = [{ placeId: 'zav-tsarevna', visitedAt: '2026-10-27T10:00:00Z' }]
    api().getAreaQuests = vi.fn(async () => quests)
    useMapStore().position = { lat: 56.60028, lng: 36.51376, accuracyM: 8, timestamp: 0 }
    const w = await mountAt('/routes', RoutesView)
    expect(w.find('.rc--random .rc__title').text()).toBe('Случайное Завидово')
    await w.findAll('.zr__tabs button')[1]!.trigger('click')
    const near = w.findAll('.pl__item--near .pl__name').map((n) => n.text())
    expect(near).toHaveLength(3)
    expect(near).not.toContain('zav-tsarevna')
    expect(near[0]).toBe('zav-bridge')
    // the visited place is marked in the list
    expect(w.findAll('.pl__visited')).toHaveLength(1)
  })

  it('a Commons photo carries its author and licence; a typical one says so', async () => {
    api().getAreaQuests = vi.fn(async () => ({ ...structuredClone(QUESTS), places: [...PLACES, place('zav-memorial', 56.59299, 36.53194, ['culture'])] }))
    const memorial = await mountAt('/places/zav-memorial', PlaceDetailView, { id: 'zav-memorial' })
    expect(memorial.find('.pd__credit').text()).toBe('Kohomologie, CC BY-SA 4.0')
    const alpaca = await mountAt('/places/zav-alpaca', PlaceDetailView, { id: 'zav-alpaca' })
    expect(alpaca.find('.pd__credit').text()).toContain('Фото для примера')
    const bay = await mountAt('/places/zav-bay', PlaceDetailView, { id: 'zav-bay' })
    expect(bay.find('.pd__cover').exists()).toBe(true)
    expect(bay.find('.pd__credit').exists()).toBe(false)
  })
})
