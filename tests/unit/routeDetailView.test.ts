import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import RouteDetailView from '@/features/routes/RouteDetailView.vue'
import RoutesView from '@/features/routes/RoutesView.vue'
import PlaceDetailView from '@/features/routes/PlaceDetailView.vue'
import { services } from '@/app/providers/services'
import { useRouteStore } from '@/stores/route'
import type { AreaPlace, AreaQuests, StepResult } from '@/types/game'
import { installFakeServices, type FakeServices } from './helpers'

const BAY: AreaPlace = {
  id: 'zav-bay',
  zone: 'bay',
  category: 'Природа / вода',
  name: 'Главная бухта',
  description: 'Бухта.',
  idea: 'Чек-ин',
  address: null,
  lat: 56.59365,
  lng: 36.51869,
  radiusM: 150,
  isPartner: false,
  needsCheck: false,
  tags: ['free', 'kids'],
  openingHours: null,
  phone: null,
  website: null,
  rewardXp: 10,
  rewardCoins: 0,
}

const QUESTS: AreaQuests = {
  routes: [
    {
      id: 'r1',
      slug: 'zav-catch-wave',
      title: 'Завидово: поймай волну',
      questTitle: 'Секреты большой воды',
      description: 'Прогулка по набережной.',
      duration: '30–45 мин',
      audience: 'Для всех',
      categories: ['Природа'],
      note: null,
      finalTitle: 'Исследователь большой воды',
      finalText: 'Все точки открыты.',
      rewardXp: 50,
      rewardCoins: 100,
      artifact: { id: 'blue-wave', title: 'Синяя волна' },
      completedAt: null,
      steps: [
        {
          id: 's1', slug: 'wave-1', ord: 1, title: 'Открой горизонт', task: 'Дойди до бухты.', kind: 'checkin', question: null, options: null,
          safety: null, rewardXp: 30, artifact: { id: 'first-discovery', title: 'Первое открытие' }, place: BAY, doneAt: null,
        },
        {
          id: 's2', slug: 'wave-4', ord: 2, title: 'Найди отражение', task: 'Посмотри на воду.', kind: 'question', question: 'Что отражается в воде?',
          options: ['Небо', 'Деревья'], safety: null, rewardXp: 20, artifact: null, place: null, doneAt: null,
        },
      ],
    },
  ],
  places: [
    BAY,
    { ...BAY, id: 'zav-meridian', name: 'Яхт-клуб «Меридиан»', lat: null, lng: null, needsCheck: true },
    {
      ...BAY, id: 'zav-traktir', zone: 'resort', name: '«Трактиръ»', tags: ['food'], lat: 56.59561, lng: 36.53686,
      openingHours: 'пт–сб 09:00–23:00', phone: '+7 903 806-79-97', website: 'https://yatraktir.ru',
    },
  ],
  visits: [],
  collections: [{ id: 'zav-trophies', title: 'Трофеи маршрутов', items: [{ id: 'first-discovery', title: 'Первое открытие', how: 'Дойди до бухты', earnedAt: null }] }],
}

type Api = {
  getAreaQuests: () => Promise<AreaQuests>
  completeRouteStep: (id: string, at: { lat: number; lng: number; accuracyM: number } | null, answer: number | null) => Promise<StepResult>
}
const api = () => services().api as unknown as Api
let fake: FakeServices

async function mountAt(path: string, component: typeof RouteDetailView | typeof RoutesView | typeof PlaceDetailView, props: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/routes', component: { template: '<div/>' } },
      { path: '/routes/random', name: 'random-route', component: { template: '<div/>' } },
      { path: '/routes/:slug', name: 'route', component: { template: '<div/>' } },
      { path: '/map', component: { template: '<div/>' } },
      { path: '/places/:id', name: 'place', component: { template: '<div/>' } },
    ],
  })
  await router.push(path)
  const w = mount(component, { props, global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  fake = installFakeServices()
  fake.geolocation.setPosition(BAY.lat!, BAY.lng!, 12)
  api().getAreaQuests = vi.fn(async () => structuredClone(QUESTS))
})

describe('RouteDetailView', () => {
  it('opens the first step and checks in with the current position', async () => {
    api().completeRouteStep = vi.fn(async () => ({
      status: 'done' as const,
      reward: { xp: 30, coins: 0 },
      artifacts: [{ id: 'first-discovery', title: 'Первое открытие' }],
      routeCompleted: false,
      profile: null,
    }))
    const { w } = await mountAt('/routes/zav-catch-wave', RouteDetailView, { slug: 'zav-catch-wave' })
    // the cover names the quest; the steps are cards with their place's photo and status
    expect(w.find('.hero__title').text()).toBe(QUESTS.routes[0]!.questTitle)
    expect(w.find('.prog__count').text()).toBe('0/2')
    expect(w.find('.st--open .st__title').text()).toBe('Открой горизонт')
    expect(w.find('.st--open .st__thumb').attributes('src')).toContain('zav-bay')
    expect(w.find('.st--open .tag--todo').text()).toBe('Не выполнено')
    expect(w.find('.st--open .info__row').text()).toContain('Чек-ин в точке')
    await w.find('.st--open .st__primary').trigger('click')
    await flushPromises()
    expect(api().completeRouteStep).toHaveBeenCalledWith('s1', { lat: BAY.lat, lng: BAY.lng, accuracyM: 12 }, null)
    expect(w.findAll('.st--done')).toHaveLength(1)
    expect(w.text()).toContain('Новый артефакт: «Первое открытие»')
    // the next step opens by itself
    expect(w.find('.st--open .st__title').text()).toBe('Найди отражение')
    expect(w.find('.prog__count').text()).toBe('1/2')
    expect(w.find('.st--done .tag--done').text()).toBe('Выполнено')
    expect(w.findAll('.prog__line li.on')).toHaveLength(1)
  })

  it('says how far the place is when the server finds the player too far', async () => {
    api().completeRouteStep = vi.fn(async () => ({ status: 'too_far' as const, distanceM: 420, radiusM: 150 }))
    const { w } = await mountAt('/routes/zav-catch-wave', RouteDetailView, { slug: 'zav-catch-wave' })
    await w.find('.st--open .st__primary').trigger('click')
    await flushPromises()
    expect(w.find('.st__result').text()).toContain('До точки ещё')
    expect(w.findAll('.st--done')).toHaveLength(0)
  })

  it('a question is sent without a position, only after an option is chosen, and the last step finishes the route', async () => {
    const quests = structuredClone(QUESTS)
    quests.routes[0]!.steps[0]!.doneAt = '2026-10-27T10:00:00Z'
    api().getAreaQuests = vi.fn(async () => quests)
    api().completeRouteStep = vi.fn(async () => ({
      status: 'done' as const,
      reward: { xp: 70, coins: 100 },
      artifacts: [{ id: 'blue-wave', title: 'Синяя волна' }],
      routeCompleted: true,
      profile: null,
    }))
    const { w } = await mountAt('/routes/zav-catch-wave', RouteDetailView, { slug: 'zav-catch-wave' })
    const send = w.find('.st--open .st__primary')
    expect(send.text()).toBe('Ответить')
    expect(send.attributes('disabled')).toBeDefined()
    await w.findAll('.st--open input[type=radio]')[1]!.setValue()
    await w.find('.st--open .st__primary').trigger('click')
    await flushPromises()
    expect(api().completeRouteStep).toHaveBeenCalledWith('s2', null, 1)
    expect(w.find('.done').exists()).toBe(true)
    expect(w.find('.fin--done').exists()).toBe(true)
  })

  it('dev builds with mocks can move the mock GPS to the step; real builds have no such button', async () => {
    const { w: plain } = await mountAt('/routes/zav-catch-wave', RouteDetailView, { slug: 'zav-catch-wave' })
    expect(plain.find('.st__dev').exists()).toBe(false)
    plain.unmount()

    const teleport = vi.fn()
    ;(services() as { devTools: { teleport: (lat: number, lng: number) => void } | null }).devTools = { teleport }
    const { w } = await mountAt('/routes/zav-catch-wave', RouteDetailView, { slug: 'zav-catch-wave' })
    await w.find('.st--open .st__dev').trigger('click')
    expect(teleport).toHaveBeenCalledWith(BAY.lat, BAY.lng)
  })

  it('«Открыть карту» starts the walking route to the step and comes back to the route', async () => {
    const { w, router } = await mountAt('/routes/zav-catch-wave', RouteDetailView, { slug: 'zav-catch-wave' })
    await w.find('.st--open .st__map').trigger('click')
    await flushPromises()
    const route = useRouteStore()
    expect(route.target).toMatchObject({ id: 'place:zav-bay', lat: BAY.lat, lng: BAY.lng, scanRadiusM: 150 })
    expect(route.returnTo).toBe('/routes/zav-catch-wave')
    expect(route.target!.imageUrl).toContain('zav-bay')
    expect(router.currentRoute.value.path).toBe('/map')
  })
})

describe('RoutesView', () => {
  it('lists the routes, the places by zone and the artifacts', async () => {
    const { w } = await mountAt('/routes', RoutesView)
    expect(w.find('.zr__list .rc__title').text()).toBe('Завидово: поймай волну')
    // bundled photos: the route cover and the bay
    expect(w.find('.rc__cover').attributes('src')).toContain('zav-catch-wave')
    await w.findAll('.zr__tabs button')[1]!.trigger('click')
    expect(w.find('.zr__zone h2').text()).toBe('Набережная и бухта')
    // a place without a point cannot be walked to
    expect(w.findAll('.pl__item')).toHaveLength(3)
    expect(w.findAll('.pl__go')).toHaveLength(2)
    expect(w.text()).toContain('Точка уточняется')
    // «Меридиан» has no photo
    expect(w.findAll('.pl__photo').map((i) => i.attributes('src'))).toEqual([
      expect.stringContaining('zav-bay'),
      expect.stringContaining('zav-traktir'),
    ])
    await w.findAll('.zr__tabs button')[2]!.trigger('click')
    expect(w.find('.zr__count').text()).toBe('Собрано 0 из 1')
  })

  it('a category chip leaves only its places', async () => {
    const { w } = await mountAt('/routes', RoutesView)
    await w.findAll('.zr__tabs button')[1]!.trigger('click')
    const food = w.findAll('.zr__cats button').find((b) => b.text() === 'Еда')!
    await food.trigger('click')
    expect(w.findAll('.pl__name').map((n) => n.text())).toEqual(['«Трактиръ»'])
    expect(w.find('.zr__zone h2').text()).toBe('Ещё на курорте')
    await food.trigger('click')
    expect(w.findAll('.pl__item')).toHaveLength(3)
  })
})

describe('PlaceDetailView', () => {
  it('shows the categories, contacts and the routes through the place', async () => {
    const { w } = await mountAt('/places/zav-traktir', PlaceDetailView, { id: 'zav-traktir' })
    expect(w.find('.pd__name').text()).toBe('«Трактиръ»')
    expect(w.findAll('.pd__tag').map((t) => t.text())).toEqual(['Еда'])
    expect(w.find('.pd__info').text()).toContain('пт–сб 09:00–23:00')
    expect(w.find('a[href="tel:+79038067997"]').exists()).toBe(true)
    expect(w.find('a[href="https://yatraktir.ru"]').text()).toBe('yatraktir.ru')
    expect(w.find('.pd__routes').exists()).toBe(false)

    const bay = await mountAt('/places/zav-bay', PlaceDetailView, { id: 'zav-bay' })
    expect(bay.w.find('.pd__route').text()).toContain('Завидово: поймай волну')
    expect(bay.w.find('.pd__cover').attributes('src')).toContain('zav-bay')
  })
})
