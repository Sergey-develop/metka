import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import DiarySheet from '@/features/album/DiarySheet.vue'
import DiaryView from '@/features/album/DiaryView.vue'
import { services } from '@/app/providers/services'
import { useAuthStore } from '@/stores/auth'
import type { CollectionItem, Memory } from '@/types/game'
import { installFakeServices } from './helpers'

const memory = (id: string, buildingId: string, createdAt: string, note: string | null = null): Memory => ({
  id,
  buildingId,
  buildingName: `Здание ${buildingId}`,
  address: null,
  rarity: 'rare',
  note,
  visitedOn: null,
  impression: null,
  isFavorite: false,
  photoPath: null,
  createdAt,
  updatedAt: createdAt,
})
const item = (buildingId: string): CollectionItem => ({
  buildingId,
  discoveredAt: '2026-10-01T10:00:00Z',
  name: `Здание ${buildingId}`,
  rarity: 'rare',
  imageUrl: `https://cdn.test/${buildingId}.webp`,
  districtId: null,
  photoPath: null,
})

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

async function mountDiary() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/diary', '/album'].map((path) => ({ path, component: { template: '<div/>' } })),
  })
  await router.push('/diary')
  const w = mount(DiaryView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { w, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  installFakeServices()
  useAuthStore().session = { user: { id: 'u1' } } as never
  vi.mocked(services().memories.list).mockResolvedValue([
    memory('m1', 'b1', daysAgo(31), 'МГУ — крупнейший университет'),
    memory('m2', 'b2', daysAgo(1)),
  ])
  ;(services().api as unknown as { getCollection: () => Promise<CollectionItem[]> }).getCollection = vi.fn(async () => [item('b1'), item('b2'), item('b3')])
})

describe('DiaryView', () => {
  it('counts entries and the days the diary has been kept', async () => {
    const { w } = await mountDiary()
    const stats = w.findAll('.stat b').map((b) => b.text())
    expect(stats).toEqual(['2 записи', '32 дня'])
    w.unmount()
  })

  it('latest notes: newest first, with the note as a quote and the building photo', async () => {
    const { w } = await mountDiary()
    const notes = w.findAll('.note')
    expect(notes.map((n) => n.find('.note__place').text())).toEqual(['Здание b2', 'Здание b1'])
    expect(notes[1]!.find('.note__quote').text()).toContain('МГУ — крупнейший университет')
    expect(notes[1]!.find('img').attributes('src')).toBe('https://cdn.test/b1.webp')
    w.unmount()
  })

  it('«Новая запись» offers only unlocked places without an entry', async () => {
    const { w } = await mountDiary()
    await w.find('.new').trigger('click')
    await flushPromises()
    const rows = document.body.querySelectorAll('.pick__row')
    expect([...rows].map((r) => r.textContent?.trim())).toEqual(['Здание b3'])
    w.unmount()
  })

  it('an empty diary says how to start', async () => {
    vi.mocked(services().memories.list).mockResolvedValue([])
    const { w } = await mountDiary()
    expect(w.findAll('.stat b').map((b) => b.text())).toEqual(['0 записей', '0 дней'])
    expect(w.find('.recent__empty').exists()).toBe(true)
    w.unmount()
  })

  it('time capsule and the book of the year are marked as coming later', async () => {
    const { w } = await mountDiary()
    expect(w.findAll('.soon__badge').map((b) => b.text())).toEqual(['Скоро', 'Скоро'])
    w.unmount()
  })
})

describe('DiarySheet', () => {
  it('shows the top of the diary and, expanded, stays a sheet (no page swap)', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: ['/profile', '/diary', '/album'].map((path) => ({ path, component: { template: '<div/>' } })),
    })
    await router.push('/profile')
    const w = mount(DiarySheet, { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()
    expect(w.findAll('.stat b').map((b) => b.text())).toEqual(['2 записи', '32 дня'])
    w.findComponent({ name: 'BottomSheet' }).vm.$emit('expanded')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/profile')
    expect(w.emitted('close')).toBeUndefined()
    w.unmount()
  })
})
