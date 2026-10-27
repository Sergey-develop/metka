import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import CollectionView from '@/features/collection/CollectionView.vue'
import { services } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import type { AreaQuests } from '@/types/game'
import { installFakeServices } from './helpers'

const QUESTS: AreaQuests = {
  routes: [],
  places: [],
  visits: [],
  collections: [
    {
      id: 'zav-elements',
      title: 'Стихии Завидово',
      items: [
        { id: 'blue-wave', title: 'Синяя волна', how: 'Пройди маршрут «Поймай волну»', earnedAt: '2026-10-28T10:00:00Z' },
        { id: 'forest-whisper', title: 'Лесной шёпот', how: 'Найди «великана»', earnedAt: null },
        { id: 'golden-horizon', title: 'Золотой горизонт', how: 'Сфотографируй горизонт', earnedAt: null },
      ],
    },
    { id: 'zav-postcards', title: 'Открытки Завидово', items: [{ id: 'panorama', title: 'Панорама', how: 'Вид с моста', earnedAt: null }] },
  ],
}

type Api = { getAreaQuests: () => Promise<AreaQuests> }
const api = () => services().api as unknown as Api

async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/collection', component: { template: '<div/>' } }] })
  await router.push('/collection')
  const w = mount(CollectionView, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  api().getAreaQuests = vi.fn(async () => structuredClone(QUESTS))
})

describe('CollectionView', () => {
  it('the Zavidovo artifact collections, as on the tasks page: cover, progress, every artifact and how to get it', async () => {
    const w = await mountView()
    expect(w.find('h1').text()).toBe('Коллекция и артефакты')
    const cards = w.findAll('.lc')
    expect(cards.map((c) => c.find('h2').text())).toEqual(['«Стихии Завидово»', '«Открытки Завидово»'])
    expect(cards[0]!.find('.lc__art').attributes('src')).toContain('zav-bay')
    expect(cards[0]!.find('.lc__count').text()).toBe('1/3')
    expect(cards[0]!.findAll('.lc__item--on')).toHaveLength(1)
    expect(cards[0]!.find('.lc__item small').text()).toBe('Пройди маршрут «Поймай волну»')
  })

  it('offers a retry when the collections fail to load', async () => {
    api().getAreaQuests = vi.fn(async () => {
      throw new ApiError('server')
    })
    const w = await mountView()
    expect(w.text()).toContain('Не удалось загрузить')
    api().getAreaQuests = vi.fn(async () => structuredClone(QUESTS))
    await w.find('.state button').trigger('click')
    await flushPromises()
    expect(w.findAll('.lc')).toHaveLength(2)
  })
})
