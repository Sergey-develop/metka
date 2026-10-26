import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import TasksView from '@/features/tasks/TasksView.vue'
import { timeLeft } from '@/features/tasks/tasksText'
import { services } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import type { StyleCollections, TasksState } from '@/types/game'
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
  collections: [
    { id: 'constructivism', collected: 0, total: 24 },
    { id: 'stalinist', collected: 3, total: 7 },
    { id: 'water_tower', collected: 1, total: 12 },
  ],
  rarity: [
    { rarity: 'rare', found: 2, total: 5 },
    { rarity: 'epic', found: 1, total: 3 },
    { rarity: 'legendary', found: 0, total: 1 },
  ],
}

type Api = { getTasks: () => Promise<TasksState>; getStyleCollections: () => Promise<StyleCollections> }
const api = () => services().api as unknown as Api

async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/tasks', component: { template: '<div/>' } }] })
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
})

describe('TasksView', () => {
  it('shows the tasks, the time to the reset and the week’s progress', async () => {
    const w = await mountView()
    expect(w.find('h1').text()).toBe('Задания')
    expect(w.text()).toContain('Найди 2 объекта')
    expect(w.findAll('.head .chip')[0]!.text()).toMatch(/^(1ч 59мин|2ч 0мин)$/)
    expect(w.find('.big__count').text()).toBe('1/3')
  })

  it('style collections and rarity come from the server', async () => {
    const w = await mountView()
    const styles = w.findAll('.style')
    expect(styles.map((s) => s.find('.style__title').text())).toEqual(['Конструктивизм', 'Сталинский ампир', 'Водонапорные башни'])
    expect(styles[1]!.find('.style__count').text()).toBe('3/7')
    const rows = w.findAll('.rarity__row')
    expect(rows[0]!.text()).toContain('Найдено 2 из 5')
    expect(rows[2]!.classes()).toContain('rarity__row--none')
  })

  it('a failed collections load offers a retry and keeps the tasks', async () => {
    api().getStyleCollections = vi.fn(async () => {
      throw new ApiError('offline')
    })
    const w = await mountView()
    expect(w.text()).toContain('Не удалось загрузить коллекции')
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
