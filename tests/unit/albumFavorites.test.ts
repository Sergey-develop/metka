import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import AlbumView from '@/features/album/AlbumView.vue'
import { useMemoriesStore } from '@/stores/memories'
import type { AreaPlace, AreaQuests } from '@/types/game'
import { installFakeServices } from './helpers'

// «Избранное» in the profile opens the album with «Любимые»: hearted Zavidovo places are there too.

const place = (id: string, name: string): AreaPlace => ({
  id, zone: 'resort', category: 'Еда / ресторан', name, description: 'Описание', idea: null, address: null,
  lat: 56.5937, lng: 36.5187, radiusM: 60, isPartner: false, needsCheck: false, tags: ['food'], openingHours: null, phone: null,
  website: null, rewardXp: 10, rewardCoins: 0,
})

beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  const api = services().api as unknown as Record<string, unknown>
  api.getAreaQuests = async (): Promise<AreaQuests> => ({
    routes: [],
    places: [place('zav-tsarevna', 'Царевна'), place('zav-traktir', 'Трактиръ')],
    visits: [],
    collections: [],
  })
  api.getPlaceFavorites = vi.fn(async () => ['zav-tsarevna'])
})

async function mountAlbum() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/album', component: AlbumView },
      { path: '/places/:id', name: 'place', component: { template: '<div/>' } },
    ],
  })
  await router.push('/album')
  const w = mount(AlbumView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

describe('album: favourite places', () => {
  it('«Любимые» lists the hearted places, which open their page; «Все» does not', async () => {
    useMemoriesStore().favoritesOnly = true
    const { w, router } = await mountAlbum()
    const names = w.findAll('.places .memory__name').map((n) => n.text())
    expect(names).toEqual(['Царевна'])
    expect(w.text()).not.toContain('Альбом пуст') // the places are enough to show
    await w.find('.places .memory').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/places/zav-tsarevna')

    useMemoriesStore().favoritesOnly = false
    await flushPromises()
    expect(w.find('.places').exists()).toBe(false)
  })
})
