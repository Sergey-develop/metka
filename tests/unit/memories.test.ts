import type { SupabaseClient } from '@supabase/supabase-js'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { services } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import { GameApi } from '@/services/api/gameApi'
import { SupabaseMemoriesService } from '@/services/memories/memoriesService'
import { useAuthStore } from '@/stores/auth'
import { useMemoriesStore } from '@/stores/memories'
import type { Memory, MemoryDraft } from '@/types/game'
import { installFakeServices } from './helpers'

const USER = '11111111-1111-4111-8111-111111111111'
const BUILDING = '22222222-2222-4222-8222-222222222222'
const PLACE = { buildingName: 'ГУМ', address: 'Красная пл., 3', rarity: 'rare' as const }

function memoryRow(photo: string | null) {
  return {
    id: 'm1',
    building_id: BUILDING,
    note: 'note',
    visited_on: '2026-10-18',
    impression: 'wow',
    is_favorite: true,
    photo_path: photo,
    updated_at: '2026-10-18T10:00:00Z',
  }
}

function fakeClient(rpcResult: { data: unknown; error: unknown }) {
  const bucket = {
    upload: vi.fn(async () => ({ data: {}, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    createSignedUrls: vi.fn(async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null })),
  }
  const client = { rpc: vi.fn(async () => rpcResult), storage: { from: vi.fn(() => bucket) } }
  return { client, bucket }
}

const prepared = new Blob(['x'], { type: 'image/webp' })
const service = (client: unknown) => new SupabaseMemoriesService(client as SupabaseClient, vi.fn(async () => prepared))
const draft = (over: Partial<MemoryDraft> = {}): MemoryDraft => ({
  buildingId: BUILDING,
  note: 'note',
  visitedOn: '2026-10-18',
  impression: 'wow',
  isFavorite: true,
  ...over,
})
const current = (photoPath: string | null): Memory => ({
  id: 'm1',
  buildingId: BUILDING,
  ...PLACE,
  note: null,
  visitedOn: null,
  impression: null,
  isFavorite: false,
  photoPath,
  updatedAt: '',
})

describe('SupabaseMemoriesService', () => {
  it('uploads the re-encoded photo into the player folder, links it and removes the replaced one', async () => {
    const { client, bucket } = fakeClient({ data: { memory: memoryRow('new'), previousPhotoPath: `${USER}/old.webp` }, error: null })
    const saved = await service(client).save(USER, draft({ photo: new Blob(['raw'], { type: 'image/jpeg' }) }), current(`${USER}/old.webp`), PLACE)
    const [path, body] = bucket.upload.mock.calls[0] as unknown as [string, Blob]
    expect(path).toMatch(new RegExp(`^${USER}/[0-9a-f-]{36}\\.webp$`))
    expect(body).toBe(prepared) // never the original file (EXIF/GPS stripped by re-encoding)
    expect(client.rpc).toHaveBeenCalledWith('save_memory', expect.objectContaining({ p_building_id: BUILDING, p_photo_path: path }))
    expect(bucket.remove).toHaveBeenCalledWith([`${USER}/old.webp`])
    expect(saved).toMatchObject({ buildingName: 'ГУМ', impression: 'wow', isFavorite: true })
  })

  it('removes the uploaded photo when the server refuses (no orphans)', async () => {
    const { client, bucket } = fakeClient({ data: null, error: { message: 'building_locked', code: 'P0001' } })
    await expect(service(client).save(USER, draft({ photo: new Blob(['raw'], { type: 'image/jpeg' }) }), null, PLACE)).rejects.toMatchObject({
      code: 'building_locked',
    })
    const [uploaded] = bucket.upload.mock.calls[0] as unknown as [string]
    expect(bucket.remove).toHaveBeenCalledWith([uploaded])
  })

  it('keeps the current photo when none is picked, and drops it on request', async () => {
    const { client } = fakeClient({ data: { memory: memoryRow(null), previousPhotoPath: null }, error: null })
    const s = service(client)
    await s.save(USER, draft(), current(`${USER}/keep.webp`), PLACE)
    expect(client.rpc).toHaveBeenLastCalledWith('save_memory', expect.objectContaining({ p_photo_path: `${USER}/keep.webp` }))
    await s.save(USER, draft({ removePhoto: true }), current(`${USER}/keep.webp`), PLACE)
    expect(client.rpc).toHaveBeenLastCalledWith('save_memory', expect.objectContaining({ p_photo_path: null }))
  })
})

describe('memories store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    installFakeServices()
    Object.assign(useAuthStore(), { session: { user: { id: USER } } })
  })

  it('updates the album only after the server confirmed; errors leave it untouched', async () => {
    const save = vi.mocked(services().memories.save)
    save.mockRejectedValueOnce(new ApiError('offline'))
    const store = useMemoriesStore()
    await expect(store.save(draft(), PLACE)).rejects.toMatchObject({ code: 'offline' })
    expect(store.items).toEqual([])
    save.mockResolvedValueOnce({ ...current(null), impression: 'liked' })
    await store.save(draft(), PLACE)
    expect(store.items).toHaveLength(1)
    expect(store.byBuilding.get(BUILDING)?.impression).toBe('liked')
  })

  it('photoOf gives the signed memory photo, or null so the card photo is used', async () => {
    const path = `${USER}/m.webp`
    vi.mocked(services().memories.photoUrls).mockResolvedValue(new Map([[path, 'https://signed/m']]))
    const store = useMemoriesStore()
    expect(store.photoOf(BUILDING)).toBeNull()
    vi.mocked(services().memories.save).mockResolvedValueOnce(current(path))
    await store.save(draft(), PLACE)
    expect(store.photoOf(BUILDING)).toBe('https://signed/m')
  })
})

describe('GameApi.getProgress', () => {
  it('parses player_progress', async () => {
    const data = { exploredCells: 120, exploredDistricts: 1, districtMinCells: 50, unlockedBuildings: 3, memories: 2, favoritePlaces: 1 }
    const api = new GameApi({ rpc: vi.fn(async () => ({ data, error: null })) } as unknown as SupabaseClient)
    await expect(api.getProgress()).resolves.toEqual(data)
  })
})
