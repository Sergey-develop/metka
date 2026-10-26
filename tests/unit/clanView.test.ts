import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import ClanView from '@/features/clans/ClanView.vue'
import { chronicleText, chronicleTime, weeklyRanking } from '@/features/clans/clanPage'
import { plural } from '@/utils/plural'
import { services } from '@/app/providers/services'
import { useAuthStore } from '@/stores/auth'
import type { ClanMembership, ClanPage, ClanRanking } from '@/types/game'
import { installFakeServices } from './helpers'

const member = (userId: string, username: string, weekCells: number, role: 'owner' | 'member' = 'member') => ({
  userId,
  username,
  level: 3,
  role,
  avatarUrl: null,
  avatarKey: null,
  weekCells,
})

const PAGE: ClanPage = {
  clan: { id: 'c1', name: 'Хамовники', tag: 'HAM', ownerId: 'u1', avatarUrl: null, members: 4, maxMembers: 50 },
  week: { daysLeft: 3, goal: { target: 800, progress: 134, districtId: 'cao', districtName: 'ЦАО' } },
  members: [member('u1', 'Иван', 20, 'owner'), member('u2', 'Анна', 50), member('u3', 'Лена', 30), member('u4', 'Олег', 0)],
  ownedDistrictIds: ['cao'],
  metrics: { level: 7, exploredCells: 8000, discoveries: 36 },
  chronicle: [
    { kind: 'discovery', at: '2026-10-23T09:00:00Z', username: 'Анна', buildingName: 'Большой театр', rarity: 'legendary' },
    { kind: 'joined', at: '2026-10-20T09:00:00Z', username: 'Олег' },
  ],
}
const MEMBERSHIP: ClanMembership = {
  clan: { id: 'c1', name: 'Хамовники', tag: 'HAM', ownerId: 'u1', avatarUrl: null },
  role: 'member',
  members: [],
}

type ClanApi = {
  getMyClan: (userId: string) => Promise<ClanMembership | null>
  getClanLeaderboard: () => Promise<ClanRanking[]>
  getClanPage: ReturnType<typeof vi.fn<() => Promise<ClanPage | null>>>
}
const clanApi = () => services().api as unknown as ClanApi

async function mountClan() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/clan', '/map', '/profile', '/players/:id'].map((path) => ({ path, component: { template: '<div/>' } })),
  })
  await router.push('/clan')
  const w = mount(ClanView, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  useAuthStore().session = { user: { id: 'u2' } } as never
  clanApi().getMyClan = async () => MEMBERSHIP
  clanApi().getClanLeaderboard = async () => []
  clanApi().getClanPage = vi.fn(async () => PAGE)
})

describe('ClanView (member)', () => {
  it('shows the clan, the weekly goal and days left from clan_page', async () => {
    const w = await mountClan()
    expect(w.find('h1').text()).toBe('Хамовники')
    expect(w.text()).toContain('4 участника')
    expect(w.find('.goal .card__title').text()).toBe('Открыть 800 клеток в ЦАО')
    expect(w.find('.goal').text()).toContain('3 дня до конца')
    expect(w.find('.goal__num').text().replace(/\s/g, '')).toBe('134/800')
  })

  it('weekly leaders: top 3 by cells with their share; nobody without cells', async () => {
    const w = await mountClan()
    const leaders = w.findAll('.leaders__text').map((li) => `${li.find('b').text()} ${li.find('small').text()}`)
    expect(leaders).toEqual(['50% Анна', '30% Лена', '20% Иван'])
  })

  it('metrics, owned territory and the leader label', async () => {
    const w = await mountClan()
    const metrics = w.findAll('.metric').map((m) => `${m.find('.metric__num').text()} ${m.find('.metric__label').text()}`)
    expect(metrics[0]).toBe('1 Округ во владении')
    expect(metrics[1]).toBe('1 км² Исследовано вместе') // 8000 × 125.6 m² ≈ 1.0 km²
    expect(metrics[2]).toBe('36 Открытых объектов')
    expect(metrics[3]).toBe('7 Уровень клана')
    expect(w.findAll('.member')[2]!.text()).toContain('Глава клана')
  })

  it('members open their profiles; the own row opens the own profile', async () => {
    const w = await mountClan()
    await w.find('.members__all').trigger('click')
    const links = w.findAll('a.member').map((a) => a.attributes('href'))
    expect(links).toContain('/players/u1')
    expect(links).toContain('/profile') // u2 is the viewer
    expect(w.find('a.leaders__link').attributes('href')).toBe('/profile') // Анна (u2) leads the week
  })

  it('shows 3 members, then all of them on «Все участники»', async () => {
    const w = await mountClan()
    expect(w.findAll('.member')).toHaveLength(3)
    await w.find('.members__all').trigger('click')
    expect(w.findAll('.member')).toHaveLength(4)
  })

  it('players without a clan get the create form and never call clan_page', async () => {
    clanApi().getMyClan = async () => null
    const w = await mountClan()
    expect(w.find('form').exists()).toBe(true)
    expect(clanApi().getClanPage).not.toHaveBeenCalled()
  })
})

describe('clan page helpers', () => {
  it('plural', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, ['день', 'дня', 'дней']))).toEqual(['день', 'дня', 'дней', 'дней', 'день', 'дня', 'дней'])
  })

  it('weekly ranking keeps joining order on ties and handles an empty week', () => {
    expect(weeklyRanking([member('a', 'A', 0), member('b', 'B', 0)]).map((m) => [m.userId, m.share])).toEqual([['a', 0], ['b', 0]])
  })

  it('chronicle text is gender-neutral', () => {
    expect(chronicleText(PAGE.chronicle[0]!)).toBe('Анна: легендарная находка «Большой театр»')
    expect(chronicleText(PAGE.chronicle[1]!)).toBe('Олег — новый участник клана')
  })

  it('chronicle time in Moscow: today, yesterday, a date', () => {
    const now = new Date('2026-10-23T12:00:00Z') // 15:00 in Moscow
    expect(chronicleTime('2026-10-23T09:05:00Z', now)).toBe('Сегодня, 12:05')
    expect(chronicleTime('2026-10-22T18:37:00Z', now)).toBe('Вчера, 21:37')
    expect(chronicleTime('2026-10-12T06:05:00Z', now)).toBe('12 октября, 09:05')
  })
})
