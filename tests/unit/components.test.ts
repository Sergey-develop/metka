import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import BottomNav from '@/components/ui/BottomNav.vue'
import BuildingCard from '@/features/map/BuildingCard.vue'
import ScannerView from '@/features/scanner/ScannerView.vue'
import { useMapStore } from '@/stores/map'
import { BUILDING, decision, installFakeServices } from './helpers'

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: ['/map', '/scan', '/locations', '/events', '/results', '/quests', '/collection', '/profile', '/clan'].map((path) => ({ path, component: { template: '<div/>' } })),
  })
}

let fakes: ReturnType<typeof installFakeServices>
beforeEach(() => {
  setActivePinia(createPinia())
  fakes = installFakeServices()
  useMapStore().buildings = new Map([[BUILDING.id, { ...BUILDING }]])
})

describe('BuildingCard', () => {
  it('shows distance, reward and scan action when in range', () => {
    const w = mount(BuildingCard, {
      props: { building: BUILDING, position: { lat: BUILDING.lat, lng: BUILDING.lng, accuracyM: 5, timestamp: 0 } },
    })
    expect(w.text()).toContain('ГУМ')
    expect(w.text()).toContain('Можно сканировать')
    expect(w.text()).toContain('+120 XP')
    expect(w.find('button.btn').exists()).toBe(true)
  })

  it('hides the scan action for discovered buildings', () => {
    const w = mount(BuildingCard, { props: { building: { ...BUILDING, discoveredAt: '2026-01-01' }, position: null } })
    expect(w.text()).toContain('Открыто')
    const actions = w.findAll('button.btn').map((b) => b.text())
    expect(actions.some((t) => t.includes('Сканировать'))).toBe(false)
    expect(actions).toEqual(['Воспоминание']) // unlocked: only the album action
  })
})

describe('BottomNav', () => {
  it('renders Ar, Локации, map button, Ивенты, Профиль in mockup order', async () => {
    const r = router()
    await r.push('/events')
    const w = mount(BottomNav, { global: { plugins: [r] } })
    const tabs = w.findAll('a')
    expect(tabs.map((t) => t.attributes('href'))).toEqual(['/scan', '/locations', '/map', '/events', '/profile'])
    expect(tabs.map((t) => t.text())).toEqual(['Ar', 'Локации', '', 'Ивенты', 'Профиль'])
    expect(tabs[2]?.attributes('aria-label')).toBe('Карта')
    expect(w.find('[aria-current="page"]').text()).toBe('Ивенты')
  })
})

describe('ScannerView', () => {
  const mountScanner = async () => {
    const r = router()
    await r.push('/map')
    return mount(ScannerView, { props: { buildingId: BUILDING.id }, global: { plugins: [r] } })
  }

  it('shows the confirmed reward after a successful scan', async () => {
    const w = await mountScanner()
    await w.find('button.btn--primary').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('Здание открыто!'))
    expect(w.text()).toContain('+120 XP')
  })

  it('explains a permission problem', async () => {
    fakes.camera.permission = 'denied'
    const w = await mountScanner()
    await w.find('button.btn--primary').trigger('click')
    await vi.waitFor(() => expect(w.find('[role="alert"]').text()).toContain('Нет доступа к камере'))
  })

  it('explains a server rejection', async () => {
    fakes.api.submitScan.mockResolvedValueOnce(decision({ status: 'rejected', reason: 'ambiguous', reward: null }))
    const w = await mountScanner()
    await w.find('button.btn--primary').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('Не засчитано'))
    expect(w.text()).toContain('неуверенно')
  })
})
