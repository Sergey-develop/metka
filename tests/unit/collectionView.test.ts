import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import CollectionView from '@/features/collection/CollectionView.vue'
import { services } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import type { LandmarkCollection } from '@/types/game'
import { installFakeServices } from './helpers'

const COLLECTIONS: LandmarkCollection[] = [
  {
    id: 'skyscrapers',
    title: 'Сталинские высотки',
    items: [
      { id: 'msu-main', name: 'Главное здание МГУ', marked: true },
      { id: 'ukraina', name: 'Гостиница «Украина»', marked: false },
      { id: 'mid', name: 'Министерство иностранных дел', marked: false },
    ],
  },
  { id: 'metro', title: 'Секреты московского метро', items: [{ id: 'kievskaya', name: 'Панно «Киевской»', marked: false }] },
]

type Api = { getLandmarkCollections: () => Promise<LandmarkCollection[]> }
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
  api().getLandmarkCollections = vi.fn(async () => structuredClone(COLLECTIONS))
})

describe('CollectionView', () => {
  it('shows the collections with their progress and checklist', async () => {
    const w = await mountView()
    expect(w.find('h1').text()).toBe('Коллекция и артефакты')
    const cards = w.findAll('.lc')
    expect(cards.map((c) => c.find('h2').text())).toEqual(['Сталинские высотки', 'Секреты московского метро'])
    expect(cards[0]!.find('.lc__count').text()).toBe('1/3')
    expect(cards[0]!.findAll('.lc__item--on')).toHaveLength(1)
    expect(w.text()).not.toContain('Отметить')
  })

  it('offers a retry when the collections fail to load', async () => {
    api().getLandmarkCollections = vi.fn(async () => {
      throw new ApiError('server')
    })
    const w = await mountView()
    expect(w.text()).toContain('Не удалось загрузить')
    api().getLandmarkCollections = vi.fn(async () => structuredClone(COLLECTIONS))
    await w.find('button.state__action, .state button').trigger('click')
    await flushPromises()
    expect(w.findAll('.lc')).toHaveLength(2)
  })
})
