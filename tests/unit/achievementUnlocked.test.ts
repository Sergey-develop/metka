import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { services } from '@/app/providers/services'
import AchievementUnlocked from '@/features/profile/AchievementUnlocked.vue'
import { useAchievementAlertsStore } from '@/stores/achievementAlerts'
import { useProfileStore } from '@/stores/profile'
import { useQuestsStore } from '@/stores/quests'
import type { QuestView } from '@/types/game'
import { installFakeServices } from './helpers'

const quest = (id: string, title: string, over: Partial<QuestView> = {}): QuestView => ({
  id,
  slug: id,
  title,
  description: 'Откройте первое здание.',
  kind: 'discover_count',
  target: 1,
  progress: 1,
  reward: { xp: 100, coins: 50 },
  completedAt: '2026-10-28T10:00:00Z',
  claimedAt: null,
  endsAt: null,
  ...over,
})

type Api = { getQuests: ReturnType<typeof vi.fn>; claimQuest: ReturnType<typeof vi.fn> }
const api = () => services().api as unknown as Api

beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  api().getQuests = vi.fn(async () => [quest('q1', 'Первая метка'), quest('q2', 'Исследователь', { reward: { xp: 200, coins: 0 } })])
  api().claimQuest = vi.fn(async (id: string) => ({ status: 'claimed', questId: id, profile: { level: 2, xp: 100, coins: 50, buildingsDiscovered: 1 } }))
})

async function show(...titles: [string, string][]) {
  const w = mount(AchievementUnlocked, { attachTo: document.body })
  useAchievementAlertsStore().push(titles.map(([questId, title]) => ({ questId, title })))
  await flushPromises()
  return w
}

describe('AchievementUnlocked', () => {
  it('nothing is shown until an achievement is completed', async () => {
    const w = await show()
    expect(w.find('.unlock').exists()).toBe(false)
  })

  it('shows the new achievement with its description and reward, and claims it on the spot', async () => {
    useProfileStore().profile = { id: 'u', username: 'x', avatarUrl: null, avatarKey: null, setupCompleted: true, level: 1, xp: 0, coins: 0, buildingsDiscovered: 1, homeDistrictId: null }
    const w = await show(['q1', 'Первая метка'])
    expect(w.find('.unlock__label').text()).toBe('Новое достижение')
    expect(w.find('.unlock__title').text()).toBe('Первая метка')
    expect(w.find('.unlock__text').text()).toBe('Откройте первое здание.')
    expect(w.find('.unlock__reward').text()).toContain('+100 опыта')
    expect(w.find('.unlock__reward').text()).toContain('+50')
    await w.find('.unlock__primary').trigger('click')
    await flushPromises()
    expect(api().claimQuest).toHaveBeenCalledWith('q1')
    expect(useProfileStore().profile?.coins).toBe(50)
    expect(w.find('.unlock').exists()).toBe(false)
    w.unmount()
  })

  it('«Позже» leaves the reward for the profile; two at once are shown one after the other', async () => {
    const w = await show(['q1', 'Первая метка'], ['q2', 'Исследователь'])
    expect(w.find('.unlock__title').text()).toBe('Первая метка')
    await w.find('.unlock__later').trigger('click')
    await flushPromises()
    expect(api().claimQuest).not.toHaveBeenCalled()
    expect(w.find('.unlock__title').text()).toBe('Исследователь')
    expect(w.find('.unlock__reward').text()).toBe('+200 опыта')
    w.unmount()
  })

  it('after a quest step: an achievement completed a moment ago is announced, older or claimed ones are not', async () => {
    const now = new Date().toISOString()
    api().getQuests = vi.fn(async () => [
      quest('r1', 'Первый маршрут', { kind: 'route_count', completedAt: now }),
      quest('old', 'Давнее', { completedAt: '2026-01-01T00:00:00Z' }),
      quest('got', 'Уже забрано', { completedAt: now, claimedAt: now }),
      quest('todo', 'В процессе', { completedAt: null, progress: 0 }),
    ])
    await useQuestsStore().announceCompleted()
    expect(useAchievementAlertsStore().queue.map((a) => a.questId)).toEqual(['r1'])
    // announced once a session
    await useQuestsStore().announceCompleted()
    expect(useAchievementAlertsStore().queue).toHaveLength(1)
  })
})

