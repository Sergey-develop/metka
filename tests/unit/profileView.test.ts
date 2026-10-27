import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import ProfileView from '@/features/profile/ProfileView.vue'
import { services } from '@/app/providers/services'
import { useClanStore } from '@/stores/clan'
import { useMapStore } from '@/stores/map'
import { useProfileStore } from '@/stores/profile'
import { ApiError } from '@/services/api/errors'
import { useAuthStore } from '@/stores/auth'
import type { ClaimResult, DistrictOverview, PlayerProgress, PlayerStats, Profile, PublicProfile, QuestView } from '@/types/game'
import { installFakeServices } from './helpers'

const square = (lng: number, lat: number): GeoJSON.MultiPolygon => ({
  type: 'MultiPolygon',
  coordinates: [[[[lng, lat], [lng + 0.1, lat], [lng + 0.1, lat + 0.1], [lng, lat + 0.1], [lng, lat]]]],
})
const district = (id: string, shortName: string, discovered: number, total: number): DistrictOverview => ({
  id,
  slug: id,
  name: shortName,
  shortName,
  boundary: square(37.6, 55.7),
  totalBuildings: total,
  discoveredBuildings: discovered,
  myInfluence: 0,
})
const PROFILE: Profile = {
  id: 'u1',
  username: 'Михаил',
  avatarUrl: null,
  avatarKey: null,
  setupCompleted: true,
  level: 4,
  xp: 926,
  coins: 245,
  buildingsDiscovered: 47,
  homeDistrictId: 'cao',
}

const day = (daysAgo: number) => new Date(Date.parse('2026-10-21T00:00:00Z') - daysAgo * 86_400_000).toISOString().slice(0, 10)
const STATS: PlayerStats = {
  today: '2026-10-21',
  streakDays: 3,
  // 3 days in a row up to today, one more 10 days ago, one outside the month (40 days ago)
  activeDays: [day(40), day(10), day(2), day(1), day(0)],
  streets: { visited: 12, total: 48, scope: 'home' },
  clan: { level: 5, discoveries: 31 },
}
const PROGRESS: PlayerProgress = { exploredCells: 4000, exploredDistricts: 1, districtMinCells: 130, unlockedBuildings: 47, memories: 2, favoritePlaces: 1 }

const quest = (id: string, kind: QuestView['kind'], progress: number, target: number, done: 'no' | 'completed' | 'claimed'): QuestView => ({
  id,
  slug: id,
  title: id,
  description: `Описание ${id}`,
  kind,
  target,
  progress,
  reward: { xp: 50, coins: 20 },
  completedAt: done === 'no' ? null : '2026-10-20T10:00:00Z',
  claimedAt: done === 'claimed' ? '2026-10-20T11:00:00Z' : null,
  endsAt: null,
})
const QUESTS = [
  quest('Исследователь', 'discover_count', 2, 5, 'no'),
  quest('Первая метка', 'discover_count', 1, 1, 'claimed'),
  quest('Легенда', 'discover_rarity', 1, 1, 'completed'),
]

type StatsApi = {
  getPlayerStats: () => Promise<PlayerStats>
  getProgress: () => Promise<PlayerProgress>
  getQuests: () => Promise<QuestView[]>
  claimQuest: (id: string) => Promise<ClaimResult>
}
const statsApi = () => services().api as unknown as StatsApi

async function mountProfile(userId?: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/profile', '/map', '/clan', '/album', '/collection', '/scan'].map((path) => ({ path, component: { template: '<div/>' } })),
  })
  await router.push('/profile')
  const w = mount(ProfileView, { props: userId ? { userId } : {}, global: { plugins: [router] } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  useProfileStore().profile = { ...PROFILE }
  useMapStore().districts = [district('cao', 'ЦАО', 40, 400), district('sao', 'САО', 7, 600)]
  statsApi().getPlayerStats = async () => STATS
  statsApi().getProgress = async () => PROGRESS
  statsApi().getQuests = async () => QUESTS
})

describe('ProfileView', () => {
  it('an empty diary and collection invite to start, instead of grey tiles that look unloaded', async () => {
    const w = await mountProfile()
    const empty = w.findAll('.empty')
    expect(empty.map((e) => e.find('b').text())).toEqual(['Здесь будут твои фото', 'Пока ни одной находки'])
    expect(empty[0]!.attributes('href')).toBe('/scan')
    expect(empty[1]!.attributes('href')).toBe('/map')
    expect(w.findAll('.strip__item:not(.strip__item--skeleton)')).toHaveLength(0)
  })

  it('shows the header, level and share of Moscow from real data', async () => {
    const w = await mountProfile()
    expect(w.find('h1').text()).toBe('Михаил')
    expect(w.text()).toContain('Знаток ЦАО')
    expect(w.text()).toContain('4 уровень')
    expect(w.text()).toContain('245')
    expect(w.text()).toContain('4,7% Москвы') // 47 of 1000 buildings
    expect(w.findAll('.mcard__okrug')).toHaveLength(2)
  })

  it('the clan card opens the clan sheet in place, as on the map', async () => {
    const w = await mountProfile()
    const card = w.find('a.clan')
    expect(card.attributes('href')).toBe('/clan')
    await card.trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"][aria-label="Клан"]').exists()).toBe(true)
    expect(w.vm.$router.currentRoute.value.path).toBe('/profile')
    w.unmount()
  })

  it('tapping a clanmate in the clan sheet closes it: the profile under it becomes theirs', async () => {
    const w = await mountProfile()
    await w.find('a.clan').trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"][aria-label="Клан"]').exists()).toBe(true)
    // /profile → /players/:id keeps the same ProfileView instance; only the prop changes
    await w.setProps({ userId: 'u9' })
    await flushPromises()
    expect(w.find('[role="dialog"][aria-label="Клан"]').exists()).toBe(false)
    w.unmount()
  })

  it('counts visited places in the home district', async () => {
    const w = await mountProfile()
    const tile = w.findAll('.tile')[0]!
    // the numbers count up when they arrive
    await vi.waitFor(() => expect(tile.find('.tile__num').text()).toBe('40'))
    expect(tile.text()).toContain('из 400 меток')
    expect(tile.text()).toContain('10%')
  })

  it('shows placeholders, not dashes, while the numbers are on their way', async () => {
    let release: () => void = () => {}
    const pending = new Promise<void>((r) => (release = r))
    const original = services().api.getPlayerStats.bind(services().api)
    services().api.getPlayerStats = async () => {
      await pending
      return original()
    }
    const w = await mountProfile()
    expect(w.find('.tiles').attributes('aria-busy')).toBe('true')
    expect(w.findAll('.tiles .skel--num')).toHaveLength(4)
    release()
    await flushPromises()
    expect(w.find('.tiles .skel').exists()).toBe(false)
    expect(w.findAll('.tile--in')).toHaveLength(4)
  })

  it('shows streets, territory and okrugs from the server', async () => {
    const w = await mountProfile()
    const tiles = w.findAll('.tile')
    await vi.waitFor(() => {
      expect(tiles[1]!.find('.tile__num').text()).toBe('12')
      expect(tiles[2]!.find('.tile__num').text()).toBe('0,5 км²') // 4000 cells × 125.6 m²
    })
    expect(tiles[1]!.text()).toContain('из 48 улиц')
    expect(tiles[1]!.text()).toContain('25%')
    expect(tiles[2]!.text().replace(/\s/g, ' ')).toContain('4 000 клеток карты')
    expect(tiles[3]!.find('.tile__num').text()).toBe('1')
    expect(tiles[3]!.text()).toContain('из 2 округов')
    expect(tiles[3]!.text()).toContain('50%')
  })

  it('streak, monthly activity, sport index and clan numbers come from player_stats', async () => {
    const w = await mountProfile()
    expect(w.find('.wallet__streak').text()).toBe('3 дня')
    const cells = w.findAll('.activity span')
    expect(cells).toHaveLength(80)
    expect(cells.filter((c) => c.classes('on'))).toHaveLength(5)
    expect(cells.at(-1)!.classes('on')).toBe(true) // today is the last cell
    expect(w.find('.block--activity .block__sub').text()).toBe('4 дня') // the 40-days-ago day is outside the month
    expect(w.find('.sport__value').text()).toContain('13') // 4 of 30 days
  })

  it('achievements are the server quests: reward waiting first, then received, then in progress', async () => {
    const w = await mountProfile()
    const badges = w.findAll('.ach')
    expect(badges.map((b) => b.attributes('aria-label'))).toEqual(['Легенда: есть награда', 'Первая метка: получено', 'Исследователь: 2 из 5'])
    expect(badges[0]!.find('.ach__dot').exists()).toBe(true)
    expect(badges[2]!.find('[role="img"]').attributes('aria-label')).toContain('ещё не получено')
    expect(w.find('.block__count').text()).toBe('2/3')
    expect(w.text()).not.toContain('Задания') // the old quest list is gone
  })

  it('claims an achievement reward from its sheet', async () => {
    const claimed: string[] = []
    statsApi().claimQuest = async (id) => {
      claimed.push(id)
      return { status: 'claimed', questId: id, profile: null }
    }
    const w = await mountProfile()
    await w.findAll('.ach')[0]!.trigger('click')
    const sheet = w.find('[role="dialog"]')
    expect(sheet.text()).toContain('Описание Легенда')
    expect(sheet.text()).toContain('+50 опыта')
    await sheet.findAll('button').find((b) => b.text() === 'Забрать награду')!.trigger('click')
    await flushPromises()
    expect(claimed).toEqual(['Легенда'])
    expect(w.find('[role="dialog"]').text()).toContain('Награда получена')
  })

  it('shows dashes, not invented numbers, when the stats cannot be loaded', async () => {
    statsApi().getPlayerStats = async () => Promise.reject(new Error('offline'))
    statsApi().getProgress = async () => Promise.reject(new Error('offline'))
    const w = await mountProfile()
    expect(w.findAll('.tile')[1]!.find('.tile__num').text()).toBe('—')
    expect(w.find('.sport__value').text()).toContain('—')
    expect(w.find('.wallet__streak').text()).toBe('— дней')
  })

  it('clan card shows the members’ avatars: photo, preset figure or the first letter', async () => {
    useClanStore().membership = {
      clan: { id: 'c1', name: 'Дикий лев', tag: 'LEV', ownerId: 'u1', avatarUrl: null },
      role: 'owner',
      members: [
        { userId: 'u1', username: 'Михаил', level: 4, role: 'owner', avatarUrl: 'https://cdn.test/u1.webp', avatarKey: null },
        { userId: 'u2', username: 'анна', level: 2, role: 'member', avatarUrl: null, avatarKey: 'runner' },
        { userId: 'u3', username: 'олег', level: 1, role: 'member', avatarUrl: null, avatarKey: null },
      ],
    }
    const w = await mountProfile()
    const faces = w.findAll('.clan__face')
    expect(faces).toHaveLength(3) // no gray placeholders for a real clan
    expect(faces[0]!.find('img').attributes('src')).toBe('https://cdn.test/u1.webp')
    expect(faces[1]!.find('.figure-avatar').exists()).toBe(true)
    expect(faces[2]!.text()).toBe('О')
  })

  it('clan and favourites sit side by side above the map (mockup профиль.png)', async () => {
    const w = await mountProfile()
    const duo = w.find('.duo')
    expect(duo.find('.clan').exists()).toBe(true)
    expect(duo.find('.fav').text()).toContain('Избранное')
    const html = w.html()
    expect(html.indexOf('class="duo')).toBeLessThan(html.indexOf('class="mcard'))
  })

  it('without a clan the card has no grey «members»: a shield and an invitation to find a team', async () => {
    const w = await mountProfile()
    expect(w.findAll('.clan__face')).toHaveLength(0)
    expect(w.find('.clan__crest--none svg').exists()).toBe(true)
    expect(w.find('.clan__empty').text()).toBe('Ты пока не в клане. Найти команду')
  })

  it('opens account settings from the gear', async () => {
    const w = await mountProfile()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    await w.find('button[aria-label="Настройки"]').trigger('click')
    expect(w.find('[role="dialog"]').text()).toContain('Выйти из аккаунта')
  })
})

describe('ProfileView (another player)', () => {
  const OTHER: PublicProfile = {
    profile: { id: 'u9', username: 'Анна', avatarUrl: null, avatarKey: 'runner', level: 7, xp: 2000, buildingsDiscovered: 5, homeDistrictId: 'sao' },
    stats: { ...STATS, streakDays: 6, streets: { visited: 3, total: 30, scope: 'home' } },
    progress: { exploredCells: 8000, exploredDistricts: 2, districtMinCells: 130, unlockedBuildings: 5 },
    discoveredByDistrict: { sao: 60 },
    achievements: [{ id: 'q1', slug: 'q1', title: 'Первая метка', description: 'Открой здание', kind: 'discover_count', target: 1, progress: 1, completedAt: '2026-10-20T10:00:00Z' }],
    bestFinds: [{ buildingId: 'b1', name: 'Большой театр', rarity: 'legendary', imageUrl: 'https://cdn.test/b1.webp' }],
  }
  type PublicApi = { getPublicProfile: (id: string) => Promise<PublicProfile>; getPlayerStats: () => Promise<PlayerStats> }
  const publicApi = () => services().api as unknown as PublicApi

  beforeEach(() => {
    useAuthStore().session = { user: { id: 'u1' } } as never
    publicApi().getPublicProfile = async () => OTHER
  })

  it('shows the other player’s data, not mine', async () => {
    let ownStatsCalled = false
    publicApi().getPlayerStats = async () => {
      ownStatsCalled = true
      return STATS
    }
    const w = await mountProfile('u9')
    expect(w.find('h1').text()).toBe('Анна')
    expect(w.text()).toContain('Знаток САО')
    expect(w.text()).toContain('7 уровень')
    expect(w.find('.wallet__streak').text()).toBe('6 дней')
    expect(w.find('.mcard__lead').text()).toBe('Анна')
    expect(w.text()).toContain('6% Москвы') // 60 of 1000 buildings
    const tiles = w.findAll('.tile')
    await vi.waitFor(() => {
      expect(tiles[0]!.find('.tile__num').text()).toBe('60') // home district САО
      expect(tiles[1]!.find('.tile__num').text()).toBe('3')
      expect(tiles[3]!.find('.tile__num').text()).toBe('2')
    })
    expect(w.find('.strip img').attributes('src')).toBe('https://cdn.test/b1.webp')
    expect(ownStatsCalled).toBe(false)
  })

  it('hides what is private or not theirs to change: coins, favourites, diary, settings, claims', async () => {
    const w = await mountProfile('u9')
    expect(w.find('.wallet__coins').exists()).toBe(false)
    expect(w.find('.fav').exists()).toBe(false)
    expect(w.text()).not.toContain('Дневник')
    expect(w.find('.head__gear').exists()).toBe(false)
    expect(w.find('.back').exists()).toBe(true)
    expect(w.find('.ach').attributes('disabled')).toBeDefined()
    expect(w.find('.ach__dot').exists()).toBe(false)
  })

  it('outside the clan: «Профиль скрыт»', async () => {
    publicApi().getPublicProfile = async () => {
      throw new ApiError('profile_hidden')
    }
    const w = await mountProfile('u9')
    expect(w.text()).toContain('Профиль скрыт')
    expect(w.text()).toContain('только участники его клана')
  })

  it('my own id shows my own profile', async () => {
    const w = await mountProfile('u1')
    expect(w.find('h1').text()).toBe('Михаил')
    expect(w.find('.head__gear').exists()).toBe(true)
  })
})
