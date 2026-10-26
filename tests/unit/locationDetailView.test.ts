import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import LocationDetailView from '@/features/locations/LocationDetailView.vue'
import { services } from '@/app/providers/services'
import { useMapStore } from '@/stores/map'
import { BUILDING, installFakeServices } from './helpers'

const NEAR = { ...BUILDING, id: 'near', name: 'Большой театр', lat: BUILDING.lat + 0.004, discoveredAt: null }
const FAR = { ...BUILDING, id: 'far', name: 'ВДНХ', lat: BUILDING.lat + 0.08, discoveredAt: null }

async function mountView(id = BUILDING.id) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...['/locations', '/map', '/scan/:buildingId'].map((path) => ({ path, component: { template: '<div/>' } })),
      { path: '/locations/:id', name: 'location', component: { template: '<div/>' } },
    ],
  })
  await router.push(`/locations/${id}`)
  const w = mount(LocationDetailView, { props: { id }, global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

let rows: unknown[]
beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  rows = [
    { ...BUILDING, address: 'Красная пл., 3', description: 'Главный универмаг страны.', discoveredAt: '2026-10-01T00:00:00Z' },
    FAR,
    NEAR,
  ]
  const api = services().api as unknown as { getBuildingsInBbox: (...a: unknown[]) => Promise<unknown> }
  api.getBuildingsInBbox = async () => rows
})

describe('LocationDetailView', () => {
  it('shows the place with its rewards and the nearest places first', async () => {
    const { w } = await mountView()
    expect(w.find('.ld__name').text()).toBe(BUILDING.name)
    expect(w.text()).toContain('Красная пл., 3')
    expect(w.text()).toContain('Главный универмаг страны.')
    expect(w.text()).toContain(`+${BUILDING.reward.coins} монет`)
    expect(w.text()).toContain(`+${BUILDING.reward.xp} опыта`)
    expect(w.findAll('.near__name').map((n) => n.text())).toEqual(['Большой театр', 'ВДНХ'])
    expect(w.find('.near__meta').text()).toBe('445 м')
    // discovered: heart is available, no scan shortcut
    expect(w.find('.ld__fav').exists()).toBe(true)
    expect(w.find('.ld__scan').exists()).toBe(false)
  })

  it('«Читать больше» shows only when the text is taller than six lines, and opens to its full height', async () => {
    const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
    try {
      tall.mockReturnValue(100) // five lines: nothing to expand
      const short = await mountView()
      expect(short.w.find('.ld__more').exists()).toBe(false)
      expect(short.w.find('.ld__text').attributes('style')).toBeUndefined()
      short.w.unmount()

      tall.mockReturnValue(300)
      const { w } = await mountView()
      const text = () => w.find('.ld__text')
      expect(w.find('.ld__more').text()).toBe('Читать больше')
      expect(text().attributes('style')).toContain('max-height: 120px')
      expect(text().classes()).toContain('ld__text--clamped')
      await w.find('.ld__more').trigger('click')
      expect(text().attributes('style')).toContain('max-height: 300px')
      expect(text().classes()).not.toContain('ld__text--clamped')
      expect(w.find('.ld__more').text()).toBe('Свернуть')
    } finally {
      tall.mockRestore()
    }
  })

  it('offers the scan for an undiscovered place and hides the heart, without blur or lock', async () => {
    const { w } = await mountView('near')
    expect(w.find('.ld__hero--locked').exists()).toBe(false)
    expect(w.find('.ld__lock').exists()).toBe(false)
    expect(w.find('.ld__fav').exists()).toBe(false)
    expect(w.find('.ld__scan').attributes('href')).toBe('/scan/near')
  })

  it('opens the place on the map', async () => {
    const { w, router } = await mountView()
    await w.find('.ld__primary').trigger('click')
    await flushPromises()
    expect(useMapStore().selectedBuildingId).toBe(BUILDING.id)
    expect(router.currentRoute.value.path).toBe('/map')
  })

  it('says when the place is not in the game', async () => {
    const { w } = await mountView('missing')
    expect(w.text()).toContain('Место не найдено')
  })
})
