import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import EventCreateView from '@/features/events/EventCreateView.vue'
import EventDetailView from '@/features/events/EventDetailView.vue'
import EventsView from '@/features/events/EventsView.vue'
import { monthGrid, moscowInstant } from '@/features/events/eventKinds'
import { services } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import type { EventDraft, GameEvent } from '@/types/game'
import { installFakeServices } from './helpers'

const person = (userId: string, username: string) => ({ userId, username, avatarUrl: null, avatarKey: null })
const event = (over: Partial<GameEvent> = {}): GameEvent => ({
  id: 'e1',
  kind: 'run',
  title: 'Утренняя пробежка',
  description: 'Бежим вдоль реки',
  lat: 55.75,
  lng: 37.6,
  placeName: 'Пречистенская наб., 1',
  startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  maxParticipants: 10,
  coverUrl: null,
  participants: 2,
  joined: false,
  organizer: person('u1', 'Анна'),
  faces: [person('u1', 'Анна'), person('u3', 'Олег')],
  ...over,
})

type EventsApi = {
  getEvents: ReturnType<typeof vi.fn<() => Promise<GameEvent[]>>>
  getEvent: ReturnType<typeof vi.fn<(id: string) => Promise<GameEvent>>>
  createEvent: ReturnType<typeof vi.fn<(userId: string, draft: EventDraft) => Promise<string>>>
  joinEvent: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>
  leaveEvent: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>
}
const api = () => services().api as unknown as EventsApi

async function mountAt(component: object, path: string, props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/events', '/events/new', '/events/:id'].map((p) => ({ path: p, component: { template: '<div/>' } })),
  })
  await router.push(path)
  const w = mount(component, { props, global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  useAuthStore().session = { user: { id: 'u2' } } as never
  api().getEvents = vi.fn(async () => [])
  api().getEvent = vi.fn(async () => event())
  api().createEvent = vi.fn(async () => 'new-id')
  api().joinEvent = vi.fn(async () => undefined)
  api().leaveEvent = vi.fn(async () => undefined)
})

describe('EventsView', () => {
  it('shows only real events, each linking to its page', async () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString()
    api().getEvents = vi.fn(async () => [event({ id: 'today', startsAt: soon }), event({ id: 'later' })])
    const { w } = await mountAt(EventsView, '/events')
    // «today» may already be tomorrow in Moscow right before midnight
    const links = w.findAll('a.big, a.item')
    expect(links.map((a) => a.attributes('href')).sort()).toEqual(['/events/later', '/events/today'])
    expect(w.text()).toContain('Мест: 8 из 10')
    expect(w.findAll('article')).toHaveLength(0) // no mockup examples
    expect(w.text()).not.toContain('макета')
  })

  it('no events yet: an empty state that leads to creating the first one', async () => {
    const { w } = await mountAt(EventsView, '/events')
    expect(w.findAll('a.big, a.item')).toHaveLength(0)
    expect(w.text()).toContain('Пока событий нет')
    expect(w.find('.ev__cta').attributes('href')).toBe('/events/new')
    expect(w.find('a[aria-label="Создать событие"]').attributes('href')).toBe('/events/new')
  })

  it('a failed first load shows an error with a retry', async () => {
    api().getEvents = vi.fn(async () => {
      throw new ApiError('offline')
    })
    const { w } = await mountAt(EventsView, '/events')
    expect(w.text()).toContain('Не удалось загрузить события')
    api().getEvents = vi.fn(async () => [event()])
    await w.find('.state button').trigger('click')
    await flushPromises()
    expect(w.findAll('a.item')).toHaveLength(1)
  })

  it('the type chips filter the feed; a second tap clears the choice', async () => {
    api().getEvents = vi.fn(async () => [event({ id: 'run' }), event({ id: 'read', kind: 'reading' })])
    const { w } = await mountAt(EventsView, '/events')
    const chips = w.findAll('.cats button')
    expect(chips.map((c) => c.text())).toEqual(['Пробежка', 'Прогулка', 'Чтение', 'Субботник'])
    await chips[2]!.trigger('click')
    expect(w.findAll('a.item').map((a) => a.attributes('href'))).toEqual(['/events/read'])
    expect(chips[2]!.attributes('aria-pressed')).toBe('true')
    await chips[3]!.trigger('click') // Субботник: none
    expect(w.text()).toContain('Ничего не нашлось')
    await chips[3]!.trigger('click')
    expect(w.findAll('a.item')).toHaveLength(2)
  })

  it('the filter sheet: only mine, only with free places; reset brings everything back', async () => {
    api().getEvents = vi.fn(async () => [
      event({ id: 'mine', joined: true, participants: 10 }),
      event({ id: 'full', participants: 10 }),
      event({ id: 'open' }),
    ])
    const { w } = await mountAt(EventsView, '/events')
    const ids = () => w.findAll('a.item').map((a) => a.attributes('href'))
    const sheet = () => document.body.querySelector('[role="dialog"][aria-label="Фильтры"]')!
    const click = async (el: Element) => {
      ;(el as HTMLElement).click()
      await flushPromises()
    }

    await w.find('button[aria-label="Фильтры"]').trigger('click')
    const [free] = sheet().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    free!.checked = true
    free!.dispatchEvent(new Event('change'))
    await click([...sheet().querySelectorAll('button')].find((b) => b.textContent?.includes('Применить'))!)
    expect(ids()).toEqual(['/events/mine', '/events/open']) // full is hidden, mine stays (I'm in)
    expect(w.find('.ev__filter--on').exists()).toBe(true)

    await w.find('button[aria-label="Фильтры"]').trigger('click')
    const boxes = sheet().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    boxes[1]!.checked = true
    boxes[1]!.dispatchEvent(new Event('change'))
    await click([...sheet().querySelectorAll('button')].find((b) => b.textContent?.includes('Применить'))!)
    expect(ids()).toEqual(['/events/mine'])
    expect(w.text()).toContain('Вы идёте')

    await w.find('button[aria-label="Фильтры"]').trigger('click')
    await click([...sheet().querySelectorAll('button')].find((b) => b.textContent?.includes('Сбросить'))!)
    await click([...sheet().querySelectorAll('button')].find((b) => b.textContent?.includes('Применить'))!)
    expect(ids()).toHaveLength(3)
    w.unmount()
  })

  it('date filter: tomorrow', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
    api().getEvents = vi.fn(async () => [event({ id: 'tomorrow', startsAt: tomorrow }), event({ id: 'later' })])
    const { w } = await mountAt(EventsView, '/events')
    await w.find('button[aria-label="Фильтры"]').trigger('click')
    const sheet = document.body.querySelector('[role="dialog"][aria-label="Фильтры"]')!
    ;[...sheet.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Завтра')!.dispatchEvent(new MouseEvent('click'))
    await flushPromises()
    ;[...sheet.querySelectorAll('button')].find((b) => b.textContent?.includes('Применить'))!.dispatchEvent(new MouseEvent('click'))
    await flushPromises()
    expect(w.findAll('a.big, a.item').map((a) => a.attributes('href'))).toEqual(['/events/tomorrow'])
    w.unmount()
  })
})

describe('EventCreateView', () => {
  const next = (w: ReturnType<typeof mount>) => w.findAll('.wiz__foot button')[1]!

  it('goes type → place → date/time/limit → title/description and creates the event', async () => {
    const { w, router } = await mountAt(EventCreateView, '/events/new')
    expect(w.text()).toContain('Шаг 1 из 4')
    expect(next(w).attributes('disabled')).toBeDefined() // no type yet
    await w.findAll('.kind')[3]!.trigger('click') // Субботник
    await next(w).trigger('click')

    expect(w.text()).toContain('Шаг 2 из 4')
    expect(w.text()).toContain('Укажите место встречи')
    await next(w).trigger('click')

    expect(w.text()).toContain('Шаг 3 из 4')
    const [, plus] = w.findAll('.stepper button')
    await plus!.trigger('click')
    expect(w.text()).toContain('11')
    await next(w).trigger('click')

    expect(w.text()).toContain('Шаг 4 из 4')
    const title = w.find<HTMLInputElement>('#event-title')
    expect(title.element.value).toBe('Субботник') // prefilled with the type
    await title.setValue('Субботник в парке')
    await w.find('textarea').setValue('Перчатки дадим')
    expect(w.find('.note__count').text()).toBe('14/500')
    await next(w).trigger('click')
    await flushPromises()

    const [userId, draft] = api().createEvent.mock.calls[0]!
    expect(userId).toBe('u2')
    expect(draft).toMatchObject({ kind: 'cleanup', title: 'Субботник в парке', description: 'Перчатки дадим', maxParticipants: 11, cover: null })
    expect(draft.startsAt.getTime()).toBeGreaterThan(Date.now())
    expect(router.currentRoute.value.path).toBe('/events/new-id')
  })

  it('shows the server’s reason when creation is refused', async () => {
    api().createEvent = vi.fn(async () => {
      throw new ApiError('too_many_events')
    })
    const { w } = await mountAt(EventCreateView, '/events/new')
    await w.findAll('.kind')[0]!.trigger('click')
    for (let i = 0; i < 4; i++) await next(w).trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('5 предстоящих событий')
  })
})

describe('EventDetailView', () => {
  it('shows the event and signs the player up', async () => {
    const { w } = await mountAt(EventDetailView, '/events/e1', { id: 'e1' })
    expect(w.find('h1').text()).toBe('Утренняя пробежка')
    expect(w.text()).toContain('Пречистенская наб., 1')
    expect(w.text()).toContain('2 участника')
    expect(w.text()).toContain('из 10')
    expect(w.text()).toContain('Анна')

    api().getEvent = vi.fn(async () => event({ joined: true, participants: 3 }))
    await w.find('.cta button').trigger('click')
    await flushPromises()
    expect(api().joinEvent).toHaveBeenCalledWith('e1')
    expect(w.find('.cta button').text()).toBe('Отменить запись')
  })

  it('full event: no sign-up; organizer: no button at all', async () => {
    api().getEvent = vi.fn(async () => event({ participants: 10 }))
    let { w } = await mountAt(EventDetailView, '/events/e1', { id: 'e1' })
    expect(w.find('.cta button').text()).toBe('Мест нет')
    expect(w.find('.cta button').attributes('disabled')).toBeDefined()

    api().getEvent = vi.fn(async () => event({ organizer: person('u2', 'Я'), joined: true }))
    ;({ w } = await mountAt(EventDetailView, '/events/e1', { id: 'e1' }))
    expect(w.find('.cta button').exists()).toBe(false)
    expect(w.text()).toContain('Вы организатор')
  })
})

describe('event date helpers', () => {
  it('a month grid starts on Monday and covers whole weeks', () => {
    const grid = monthGrid(2026, 10) // 1 October 2026 is a Thursday
    expect(grid).toHaveLength(35)
    expect(grid[0]!.day).toEqual({ year: 2026, month: 9, day: 28 })
    expect(grid[3]!).toEqual({ day: { year: 2026, month: 10, day: 1 }, inMonth: true })
    expect(grid.at(-1)!.day).toEqual({ year: 2026, month: 11, day: 1 })
  })

  it('Moscow wall-clock time is UTC+3', () => {
    expect(moscowInstant({ year: 2026, month: 2, day: 16 }, 16, 0).toISOString()).toBe('2026-02-16T13:00:00.000Z')
    expect(moscowInstant({ year: 2026, month: 3, day: 1 }, 1, 30).toISOString()).toBe('2026-02-28T22:30:00.000Z')
  })
})
