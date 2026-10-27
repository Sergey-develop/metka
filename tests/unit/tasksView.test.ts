import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import TasksView from '@/features/tasks/TasksView.vue'
import { timeLeft } from '@/features/tasks/tasksText'
import { services } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import type { AreaQuests, QuestRoute, StyleCollections, TasksState } from '@/types/game'
import { installFakeServices } from './helpers'

const TASKS: TasksState = {
  dayEndsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  weekEndsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  tasks: [
    { slug: 'a', period: 'day', kind: 'discover', title: 'Найди 2 объекта', target: 2, progress: 1, rewardCoins: 50, claimed: false },
    { slug: 'w', period: 'week', kind: 'districts', title: 'Исследуй 3 округа', target: 3, progress: 1, rewardCoins: 300, claimed: false },
  ],
  season: null,
}
const STYLES: StyleCollections = {
  collections: [],
  rarity: [
    { rarity: 'rare', found: 2, total: 5 },
    { rarity: 'epic', found: 1, total: 3 },
    { rarity: 'legendary', found: 0, total: 1 },
  ],
}

const route = (slug: string, questTitle: string, steps: number, completedAt: string | null = null): QuestRoute => ({
  id: slug, slug, title: slug, questTitle, description: 'Исследуй бухту', duration: '30 мин', audience: 'Для всех', categories: [],
  note: null, finalTitle: '', finalText: '', rewardXp: 100, rewardCoins: 100, artifact: { id: 'blue-wave', title: 'Синяя волна' },
  completedAt, steps: Array.from({ length: steps }, () => ({}) as QuestRoute['steps'][number]),
})
const QUESTS: AreaQuests = {
  routes: [route('zav-catch-wave', 'Секреты большой воды', 4), route('zav-forest', 'Следы лесного хранителя', 5, '2026-10-27T10:00:00Z')],
  places: [],
  visits: [],
  collections: [
    { id: 'zav-elements', title: 'Стихии Завидово', items: [
      { id: 'a', title: 'A', how: '', earnedAt: '2026-10-27T10:00:00Z' },
      { id: 'b', title: 'B', how: '', earnedAt: null },
      { id: 'c', title: 'C', how: '', earnedAt: null },
    ] },
  ],
}

type Api = {
  getTasks: () => Promise<TasksState>
  getStyleCollections: () => Promise<StyleCollections>
  getAreaQuests: () => Promise<AreaQuests>
}
const api = () => services().api as unknown as Api

async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/tasks', component: { template: '<div/>' } },
    { path: '/routes', component: { template: '<div/>' } },
    { path: '/routes/:slug', name: 'route', component: { template: '<div/>' } },
  ] })
  await router.push('/tasks')
  const w = mount(TasksView, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  useAuthStore().session = { user: { id: 'u1' } } as never
  api().getTasks = vi.fn(async () => structuredClone(TASKS))
  api().getStyleCollections = vi.fn(async () => structuredClone(STYLES))
  api().getAreaQuests = vi.fn(async () => structuredClone(QUESTS))
})

describe('TasksView', () => {
  it('shows the tasks, the time to the reset and the week’s progress', async () => {
    const w = await mountView()
    expect(w.find('h1').text()).toBe('Задания')
    expect(w.text()).toContain('Найди 2 объекта')
    expect(w.findAll('.head .chip')[0]!.text()).toMatch(/^(1ч 59мин|2ч 0мин)$/)
    expect(w.find('.big__count').text()).toBe('1/3')
  })

  it('the quests: one banner per route with its tasks, coins and artifact, and how many are done', async () => {
    const w = await mountView()
    expect(w.find('.head--quests .chip').text()).toBe('1/2')
    const banners = w.findAll('.quest')
    expect(banners.map((b) => b.find('.quest__title').text())).toEqual(['Секреты большой воды', 'Следы лесного хранителя'])
    expect(banners[0]!.findAll('.quest__chip').map((c) => c.text())).toEqual(['4 задания', '+100', 'Артефакт «Синяя волна»'])
    expect(banners[0]!.attributes('href')).toBe('/routes/zav-catch-wave')
    expect(banners[1]!.find('.quest__chip--steps').text()).toBe('Пройден')
  })

  it('the artifact collections with their progress; rarity with the mockup notes, greyed until found', async () => {
    const w = await mountView()
    const cards = w.findAll('.style')
    expect(cards.map((s) => s.find('.style__title').text())).toEqual(['«Стихии Завидово»'])
    expect(cards[0]!.find('.style__count').text()).toBe('1/3')
    expect(cards[0]!.find('img').attributes('src')).toContain('zav-bay')
    const rows = w.findAll('.rarity__row')
    expect(rows.map((r) => r.find('small').text())).toEqual(['Только ночью, в дождь или снег', 'Очень редко', 'Крайне редко'])
    expect(rows[2]!.classes()).toContain('rarity__row--none')
    expect(rows[0]!.classes()).not.toContain('rarity__row--none')
  })

  it('a failed rarity load offers a retry and keeps the tasks', async () => {
    api().getStyleCollections = vi.fn(async () => {
      throw new ApiError('offline')
    })
    const w = await mountView()
    expect(w.text()).toContain('Не удалось загрузить')
    expect(w.text()).toContain('Найди 2 объекта')
  })
})

describe('timeLeft', () => {
  it('days, hours and minutes, rounded up', () => {
    expect(timeLeft((3 * 1440 + 12 * 60 + 25) * 60_000)).toBe('3д 12ч 25мин')
    expect(timeLeft((12 * 60 + 5) * 60_000 - 30_000)).toBe('12ч 5мин')
    expect(timeLeft(4 * 60_000)).toBe('4мин')
    expect(timeLeft(-1000)).toBe('0мин')
  })
})
