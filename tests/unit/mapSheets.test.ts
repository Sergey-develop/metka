import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import ClanSheet from '@/features/map/ClanSheet.vue'
import TasksSheet from '@/features/map/TasksSheet.vue'
import { services } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'
import { useTasksStore } from '@/stores/tasks'
import type { ClanMembership, ClanPage, GameTask, Profile, TasksState } from '@/types/game'
import { installFakeServices } from './helpers'

const task = (slug: string, progress: number, target: number, claimed = false, period: 'day' | 'week' = 'day'): GameTask => ({
  slug,
  period,
  kind: period === 'week' ? 'districts' : 'discover',
  title: `Задание ${slug}`,
  target,
  progress,
  rewardCoins: period === 'week' ? 300 : 50,
  claimed,
})
const STATE: TasksState = {
  dayEndsAt: '2026-10-24T21:00:00Z',
  weekEndsAt: '2026-10-25T21:00:00Z',
  tasks: [task('a', 2, 2, true), task('b', 300, 300), task('c', 0, 1), task('d', 1, 1, true), task('w', 1, 3, false, 'week')],
  season: {
    id: 'q1',
    title: 'Открой 5 зданий',
    description: '',
    target: 5,
    progress: 5,
    rewardCoins: 1000,
    endsAt: '2026-11-30T21:00:00Z',
    completed: true,
    claimed: false,
  },
}
const PROFILE: Profile = {
  id: 'u1',
  username: 'Я',
  avatarUrl: null,
  avatarKey: null,
  setupCompleted: true,
  level: 2,
  xp: 100,
  coins: 245,
  buildingsDiscovered: 1,
  homeDistrictId: null,
}

type Api = {
  getTasks: ReturnType<typeof vi.fn<() => Promise<TasksState>>>
  claimTask: ReturnType<typeof vi.fn<(slug: string) => Promise<number>>>
  getMyClan: (userId: string) => Promise<ClanMembership | null>
  getClanLeaderboard: () => Promise<[]>
  getClanPage: () => Promise<ClanPage | null>
}
const api = () => services().api as unknown as Api

async function mountSheet(component: object) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/map', '/clan', '/tasks', '/profile', '/players/:id'].map((path) => ({ path, component: { template: '<div/>' } })),
  })
  await router.push('/map')
  const w = mount(component, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  useAuthStore().session = { user: { id: 'u1' } } as never
  useProfileStore().profile = { ...PROFILE }
  api().getTasks = vi.fn(async () => structuredClone(STATE))
  api().claimTask = vi.fn(async () => 295)
})

describe('tasks store', () => {
  it('counts rewards waiting: finished, unclaimed tasks plus a finished season', async () => {
    const tasks = useTasksStore()
    await tasks.load()
    expect(tasks.ready).toBe(2) // «b» and the season
    expect(tasks.day).toHaveLength(4)
    expect(tasks.week).toHaveLength(1)
  })
})

describe('TasksSheet', () => {
  it('looks like the sheet mockup: count without a timer, progress of unfinished tasks, claim for finished ones', async () => {
    const { w } = await mountSheet(TasksSheet)
    expect(w.find('.head h2').text()).toBe('Задания дня')
    const chips = w.findAll('.head .chip')
    expect(chips.map((c) => c.text())).toEqual(['3/4']) // the timer is on the page only
    const cards = w.findAll('.task')
    expect(cards).toHaveLength(4)
    expect(cards[2]!.find('.task__progress').text()).toBe('0 / 1')
    expect(cards[0]!.find('.coin--claim').exists()).toBe(false) // already claimed
    expect(cards[1]!.find('.coin--claim').exists()).toBe(true)
    expect(w.text()).toContain('Задание недели')
    expect(w.find('.big__count').exists()).toBe(false) // no progress bars in the sheet mockup
    expect(w.find('.big .coin').text()).toContain('+300')
    expect(w.text()).toContain('Сезонное задание')
    expect(w.text()).toContain('Открой 5 зданий')
  })

  it('claims coins and updates the balance and the card', async () => {
    const { w } = await mountSheet(TasksSheet)
    await w.findAll('.task')[1]!.find('.coin--claim').trigger('click')
    await flushPromises()
    expect(api().claimTask).toHaveBeenCalledWith('b')
    expect(useProfileStore().profile!.coins).toBe(295)
    expect(w.findAll('.task')[1]!.find('.coin--claim').exists()).toBe(false)
    expect(useTasksStore().ready).toBe(1)
  })

  it('a refused claim is explained', async () => {
    api().claimTask = vi.fn(async () => {
      throw new ApiError('task_not_completed')
    })
    const { w } = await mountSheet(TasksSheet)
    await w.findAll('.task')[1]!.find('.coin--claim').trigger('click')
    await flushPromises()
    expect(w.find('.error').text()).toBe('Задание ещё не выполнено.')
  })

  it('the chevron expands it in place into the full tasks, without opening the page', async () => {
    const { w, router } = await mountSheet(TasksSheet)
    const path = router.currentRoute.value.path
    await w.find('.big__more').trigger('click')
    await flushPromises()
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('true')
    expect(w.findAll('.head .chip')).toHaveLength(2) // the page look: timer + count
    expect(w.find('.big__more').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe(path)
    expect(w.emitted('close')).toBeUndefined()
  })

  it('no season: no seasonal card', async () => {
    api().getTasks = vi.fn(async () => ({ ...structuredClone(STATE), season: null }))
    const { w } = await mountSheet(TasksSheet)
    expect(w.text()).not.toContain('Сезонное задание')
  })
})

describe('ClanSheet', () => {
  const PAGE: ClanPage = {
    clan: { id: 'c1', name: 'Хамовники', tag: 'HAM', ownerId: 'u1', avatarUrl: null, members: 2, maxMembers: 50 },
    week: { daysLeft: 3, goal: { target: 400, progress: 134, districtId: null, districtName: null } },
    members: [
      { userId: 'u1', username: 'Иван', level: 3, role: 'owner', avatarUrl: null, avatarKey: null, weekCells: 30 },
      { userId: 'u2', username: 'Анна', level: 2, role: 'member', avatarUrl: null, avatarKey: null, weekCells: 70 },
    ],
    ownedDistrictIds: [],
    metrics: { level: 4, exploredCells: 100, discoveries: 3 },
    chronicle: [],
  }

  it('looks like the sheet mockup: the goal with contributions and the metrics', async () => {
    api().getMyClan = async () => ({ clan: { id: 'c1', name: 'Хамовники', tag: 'HAM', ownerId: 'u1', avatarUrl: null }, role: 'owner', members: [] })
    api().getClanLeaderboard = async () => []
    api().getClanPage = async () => PAGE
    const { w } = await mountSheet(ClanSheet)
    expect(w.find('.who__name').text()).toBe('Хамовники')
    expect(w.find('.goal__title').text()).toBe('Открыть 400 клеток Москвы')
    expect(w.find('.goal__num').text().replace(/\s/g, '')).toBe('134/400')
    expect(w.text()).toContain('Вклад участников')
    const contrib = w.findAll('.contrib__text').map((c) => `${c.find('b').text()} ${c.find('small').text()}`)
    expect(contrib).toEqual(['70% Анна', '30% Иван'])
    expect(w.findAll('.contrib__link').map((a) => a.attributes('href'))).toEqual(['/players/u2', '/profile'])
    expect(w.findAll('.metric')).toHaveLength(4)
    // the page's sections are on the page, not in the sheet
    expect(w.text()).not.toContain('Летопись')
  })

  it('the chevron expands it in place into the whole clan page, without opening /clan', async () => {
    api().getMyClan = async () => ({ clan: { id: 'c1', name: 'Хамовники', tag: 'HAM', ownerId: 'u1', avatarUrl: null }, role: 'owner', members: [] })
    api().getClanLeaderboard = async () => []
    api().getClanPage = async () => PAGE
    const { w, router } = await mountSheet(ClanSheet)
    const path = router.currentRoute.value.path
    await w.find('.metrics-block .more').trigger('click')
    await flushPromises()
    expect(w.find('.bsheet__grip').attributes('aria-expanded')).toBe('true')
    expect(w.text()).toContain('Летопись')
    expect(w.text()).toContain('2 участника')
    expect(router.currentRoute.value.path).toBe(path)
    expect(w.emitted('close')).toBeUndefined()
  })

  it('not in a clan: an invitation to find one', async () => {
    api().getMyClan = async () => null
    api().getClanLeaderboard = async () => []
    api().getClanPage = async () => null
    const { w } = await mountSheet(ClanSheet)
    expect(w.text()).toContain('Ты пока не в клане')
    expect(w.text()).toContain('Найти клан')
  })
})
