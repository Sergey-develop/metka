import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The app as deployed now: VITE_MOSCOW unset — only Zavidovo is in the game (the unit project sets it to
// 'true' for the tests written with Moscow). Modules read the flag once, so they are loaded afresh here.

beforeEach(() => {
  vi.stubEnv('VITE_MOSCOW', '')
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('Moscow off (VITE_MOSCOW unset)', () => {
  it('only Zavidovo is a game area; a point in Moscow is outside the game', async () => {
    const areas = await import('@/utils/gameAreas')
    expect(areas.MOSCOW_ENABLED).toBe(false)
    expect(areas.GAME_AREAS.map((a) => a.id)).toEqual(['zavidovo'])
    expect(areas.HOME_AREA).toBe('zavidovo')
    expect(areas.gameAreaAt({ lat: 55.7558, lng: 37.6176 })).toBeNull()
    expect(areas.gameAreaAt({ lat: 56.5937, lng: 36.5187 })).toBe('zavidovo')
  })

  it('the locations list asks the server for no Moscow buildings', async () => {
    const { installFakeServices } = await import('./helpers')
    const { services } = await import('@/app/providers/services')
    setActivePinia(createPinia())
    installFakeServices()
    const api = services().api as unknown as { getBuildingsInBbox: ReturnType<typeof vi.fn> }
    api.getBuildingsInBbox = vi.fn(async () => [])
    const { usePlaces } = await import('@/features/locations/places')
    const places = usePlaces()
    await places.load()
    expect(api.getBuildingsInBbox).not.toHaveBeenCalled()
    expect(places.buildings.value).toEqual([])
    expect(places.loading.value).toBe(false)
  })

  it('the okrug task is not shown; the clan goal names Zavidovo', async () => {
    const { useTasksStore } = await import('@/stores/tasks')
    setActivePinia(createPinia())
    const tasks = useTasksStore()
    tasks.state = {
      dayEndsAt: new Date().toISOString(),
      weekEndsAt: new Date().toISOString(),
      tasks: [
        { slug: 'd', period: 'day', kind: 'discover', title: 'Найди 2 объекта', target: 2, progress: 0, rewardCoins: 50, claimed: false },
        { slug: 'w', period: 'week', kind: 'districts', title: 'Исследуй 3 разных округа', target: 3, progress: 0, rewardCoins: 300, claimed: false },
      ],
      season: null,
    }
    expect(tasks.day.map((t) => t.slug)).toEqual(['d'])
    expect(tasks.week).toEqual([])

    const { goalTitle } = await import('@/features/clans/clanPage')
    const page = { week: { goal: { target: 800, districtName: 'ЦАО' } } } as unknown as Parameters<typeof goalTitle>[0]
    expect(goalTitle(page)).toBe('Открыть 800 клеток в Завидово')
  })
})
