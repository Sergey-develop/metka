import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import LocationsView from '@/features/locations/LocationsView.vue'
import { swipeSession } from '@/features/locations/places'
import { services } from '@/app/providers/services'
import { useMapStore } from '@/stores/map'
import type { AreaPlace, AreaQuests } from '@/types/game'
import { BUILDING, installFakeServices } from './helpers'

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...['/locations', '/map'].map((path) => ({ path, component: { template: '<div/>' } })),
      { path: '/locations/:id', name: 'location', component: { template: '<div/>' } },
      { path: '/places/:id', name: 'place', component: { template: '<div/>' } },
      { path: '/routes', component: { template: '<div/>' } },
    ],
  })
  await router.push('/locations')
  const w = mount(LocationsView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  swipeSession.mode = 'gallery'
  swipeSession.range = null
  swipeSession.seen.clear()
  installFakeServices()
  const api = services().api as unknown as { getBuildingsInBbox: (...a: unknown[]) => Promise<unknown> }
  api.getBuildingsInBbox = async () => [
    { ...BUILDING, id: 'locked', name: 'Большой театр', discoveredAt: null },
    { ...BUILDING, discoveredAt: '2026-10-01T00:00:00Z' },
    { ...BUILDING, id: 'far', name: 'Далёкое', lat: BUILDING.lat + 0.1, discoveredAt: null },
  ]
})

describe('LocationsView', () => {
  it('lists discovered places first; every photo is shown as is, without blur or lock', async () => {
    const { w } = await mountView()
    expect(w.text()).toContain('Все (3)')
    const places = w.findAll('.place')
    expect(places).toHaveLength(3)
    expect(places[0]!.find('.place__name').text()).toBe(BUILDING.name)
    expect(places[0]!.find('.place__fav').exists()).toBe(true)
    expect(w.find('.place__photo--locked').exists()).toBe(false)
    expect(w.find('.place__lock').exists()).toBe(false)
    expect(places[1]!.find('.place__fav').exists()).toBe(false)
  })

  it('opens the page of the picked place', async () => {
    const { w, router } = await mountView()
    await w.findAll('.place__photo')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/locations/${BUILDING.id}`)
  })

  it('shows walking time from the current position', async () => {
    useMapStore().position = { lat: BUILDING.lat, lng: BUILDING.lng, accuracyM: 5, timestamp: 0 }
    const { w } = await mountView()
    expect(w.findAll('.place')[0]!.text()).toContain('до 5 мин.')
  })

  it('swipe mode asks who and how far before going on', async () => {
    const { w } = await mountView()
    const tab = w.findAll('[role="tab"]')[1]!
    expect(tab.text()).toBe('Свайп')
    await tab.trigger('click')
    expect(w.find('.chips').exists()).toBe(false)
    const next = w.find('.sw__next')
    expect(next.attributes('disabled')).toBeDefined()
    await w.findAll('.who__opt')[1]!.trigger('click')
    expect(next.attributes('disabled')).toBeDefined()
    await w.findAll('.far__opt')[0]!.trigger('click')
    expect(w.findAll('.who__opt')[1]!.attributes('aria-checked')).toBe('true')
    expect(next.attributes('disabled')).toBeUndefined()
    await next.trigger('click')
    expect(w.find('.sw').exists()).toBe(false)
    expect(w.find('.deck').exists()).toBe(true)
  })

  it('swipe deck keeps places within the chosen distance; left skips, right opens the page', async () => {
    useMapStore().position = { lat: BUILDING.lat, lng: BUILDING.lng, accuracyM: 5, timestamp: 0 }
    const { w, router } = await mountView()
    await w.findAll('[role="tab"]')[1]!.trigger('click')
    await w.findAll('.who__opt')[0]!.trigger('click')
    await w.findAll('.far__opt')[0]!.trigger('click') // up to 1 km: the far one is left out
    await w.find('.sw__next').trigger('click')
    expect(w.find('.card:not(.card--under) h2').text()).toBe('Большой театр')
    expect(w.find('.card--under').exists()).toBe(true)

    await w.find('.card:not(.card--under)').trigger('keydown', { key: 'ArrowLeft' })
    await new Promise((r) => setTimeout(r, 260))
    await flushPromises()
    expect(w.find('.card:not(.card--under) h2').text()).toBe(BUILDING.name)
    expect(w.find('.card--under').exists()).toBe(false)

    await w.find('.card:not(.card--under)').trigger('keydown', { key: 'ArrowRight' })
    await new Promise((r) => setTimeout(r, 260))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/locations/${BUILDING.id}`)
    expect(w.text()).toContain('Места закончились')

    // back from the place page: the swipe mode and answers are still there
    w.unmount()
    const again = await mountView()
    expect(again.w.findAll('[role="tab"]')[1]!.attributes('aria-selected')).toBe('true')
    const shown = again.w.findAll('.card:not(.card--under) h2').map((h) => h.text())
    expect(shown).not.toContain('Большой театр')
    expect(shown).not.toContain(BUILDING.name)
  })

  it('swipe card shows what letting go will do while dragged', async () => {
    const { w } = await mountView()
    await w.findAll('[role="tab"]')[1]!.trigger('click')
    await w.findAll('.who__opt')[0]!.trigger('click')
    await w.findAll('.far__opt')[2]!.trigger('click')
    await w.find('.sw__next').trigger('click')
    const card = w.find('.card:not(.card--under)')
    expect(w.find('.card__hint').exists()).toBe(false)

    await card.trigger('pointerdown', { clientX: 100, pointerId: 1 })
    await card.trigger('pointermove', { clientX: 140, pointerId: 1 })
    expect(w.find('.card__hint--go').text()).toBe('Хочу сходить')
    expect(w.find('.card__hint').classes()).not.toContain('ready')
    await card.trigger('pointermove', { clientX: 260, pointerId: 1 })
    expect(w.find('.card__hint').classes()).toContain('ready')
    await card.trigger('pointermove', { clientX: 20, pointerId: 1 })
    expect(w.find('.card__hint--skip').text()).toBe('Дальше')

    // let go short of the threshold: the card returns and the hint goes away
    await card.trigger('pointermove', { clientX: 130, pointerId: 1 })
    await card.trigger('pointerup', { clientX: 130, pointerId: 1 })
    expect(w.find('.card__hint').exists()).toBe(false)
  })

  it('shows the Zavidovo places by zone in the gallery and in the swipe deck', async () => {
    const zav = (id: string, zone: AreaPlace['zone'], lat: number, lng: number, category: string): AreaPlace => ({
      id, zone, category, name: id, description: 'Описание', idea: null, address: null, lat, lng, radiusM: 60,
      isPartner: false, needsCheck: false, tags: ['free'], openingHours: null, phone: null, website: null, rewardXp: 10, rewardCoins: 0,
    })
    const quests: AreaQuests = {
      routes: [],
      places: [zav('zav-bay', 'bay', 56.59365, 36.51869, 'Природа / вода'), zav('zav-traktir', 'resort', 56.59561, 36.53686, 'Еда / партнёр')],
      visits: [],
      collections: [],
    }
    ;(services().api as unknown as { getAreaQuests: () => Promise<AreaQuests> }).getAreaQuests = async () => quests
    useMapStore().position = { lat: 56.5937, lng: 36.5187, accuracyM: 5, timestamp: 0 }
    const { w, router } = await mountView()
    expect(w.text()).toContain('Все (5)')
    const heads = w.findAll('.loc__row h2').map((h) => h.text())
    expect(heads).toEqual(expect.arrayContaining(['Завидово · Набережная и бухта', 'Завидово · Ещё на курорте']))
    // the bay card shows its bundled photo and opens the place page
    const bayCard = w.findAll('.place').find((p) => p.find('.place__name').text() === 'zav-bay')!
    expect(bayCard.find('img').attributes('src')).toContain('zav-bay')
    await bayCard.find('.place__photo').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/places/zav-bay')

    await router.push('/locations')
    await w.findAll('[role="tab"]')[1]!.trigger('click')
    await w.findAll('.who__opt')[0]!.trigger('click')
    await w.findAll('.far__opt')[0]!.trigger('click') // up to 1 km from the bay: the Moscow buildings and «Трактиръ» are out
    await w.find('.sw__next').trigger('click')
    expect(w.find('.card:not(.card--under) h2').text()).toBe('zav-bay')
    expect(w.find('.card:not(.card--under) .card__tag--own').text()).toBe('Природа / вода')
  })
})
