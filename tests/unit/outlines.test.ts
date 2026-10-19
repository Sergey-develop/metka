import type { SupabaseClient } from '@supabase/supabase-js'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { services } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import { GameApi } from '@/services/api/gameApi'
import { OUTLINES_MIN_ZOOM, useOutlinesStore } from '@/stores/outlines'
import type { Bbox, BuildingOutline, OutlinesPage } from '@/types/game'
import { installFakeServices } from './helpers'

const VIEW: Bbox = { minLng: 37.615, minLat: 55.651, maxLng: 37.625, maxLat: 55.656 }
const Z = OUTLINES_MIN_ZOOM + 1

function outline(id: number, game: BuildingOutline['game'] = null): BuildingOutline {
  return {
    id,
    osmType: 'way',
    osmId: 1000 + id,
    geometry: { type: 'Polygon', coordinates: [[[37.62, 55.65], [37.621, 55.65], [37.621, 55.651], [37.62, 55.65]]] },
    name: null,
    address: null,
    category: null,
    game,
  }
}

const GAME = {
  id: 'g1',
  status: 'published' as const,
  name: 'Школа',
  description: null,
  category: null,
  rarity: 'rare' as const,
  imageUrl: null,
  discoveredAt: null,
}

type Fetch = (bbox: Bbox, zoom: number, signal?: AbortSignal) => Promise<OutlinesPage>

function installApi(impl: Fetch) {
  installFakeServices()
  const fn = vi.fn(impl)
  Object.assign(services().api, { getBuildingOutlines: fn })
  return fn
}

describe('outlines store', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.useRealTimers())

  it('does not request footprints when zoomed out', async () => {
    const fetch = installApi(async () => ({ features: [outline(1)], truncated: false }))
    const store = useOutlinesStore()
    await store.load(VIEW, OUTLINES_MIN_ZOOM - 0.5)
    await store.load({ minLng: 37.5, minLat: 55.6, maxLng: 37.7, maxLat: 55.62 }, Z) // wider than server limit
    expect(fetch).not.toHaveBeenCalled()
    expect(store.tooFar).toBe(true)
  })

  it('loads a padded viewport, reuses it for small pans and refetches on zoom in', async () => {
    const fetch = installApi(async () => ({ features: [outline(1), outline(2, GAME)], truncated: false }))
    const store = useOutlinesStore()
    await store.load(VIEW, Z)
    const [bbox] = fetch.mock.calls[0]!
    expect(bbox.minLng).toBeLessThan(VIEW.minLng)
    expect(bbox.maxLat).toBeGreaterThan(VIEW.maxLat)
    expect(store.list.map((o) => o.id)).toEqual([1, 2])
    expect([...store.gameIdsWithOutline]).toEqual(['g1'])

    await store.load({ ...VIEW, minLng: VIEW.minLng + 0.001, maxLng: VIEW.maxLng + 0.001 }, Z)
    expect(fetch).toHaveBeenCalledTimes(1)
    await store.load(VIEW, Z + 1) // finer geometry needed
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]![1]).toBe(Z + 1)
  })

  it('debounces viewport events into one request', async () => {
    vi.useFakeTimers()
    const fetch = installApi(async () => ({ features: [], truncated: false }))
    const store = useOutlinesStore()
    for (let i = 0; i < 5; i++) store.onViewport({ ...VIEW, minLng: VIEW.minLng + i * 0.05 }, Z)
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0].minLng).toBeLessThan(VIEW.minLng + 0.2 + 1e-9)
  })

  it('aborts a superseded request and ignores its result', async () => {
    const resolvers: ((page: OutlinesPage) => void)[] = []
    const fetch = installApi(() => new Promise((resolve) => resolvers.push(resolve)))
    const store = useOutlinesStore()
    const first = store.load(VIEW, Z)
    const second = store.load({ minLng: 37.7, minLat: 55.7, maxLng: 37.71, maxLat: 55.705 }, Z)
    expect(fetch.mock.calls[0]![2]!.aborted).toBe(true)
    resolvers[1]!({ features: [outline(2)], truncated: false })
    await second
    resolvers[0]!({ features: [outline(1)], truncated: false })
    await first
    expect(store.list.map((o) => o.id)).toEqual([2])
    expect(store.loading).toBe(false)
  })

  it('reports network errors, but not cancellations', async () => {
    let fail: ApiError = new ApiError('network')
    installApi(async () => {
      throw fail
    })
    const store = useOutlinesStore()
    await store.load(VIEW, Z)
    expect(store.error?.code).toBe('network')
    fail = new ApiError('cancelled')
    store.invalidate()
    await store.load(VIEW, Z)
    expect(store.error).toBeNull()
  })

  it('does not hammer the server after a failure (e.g. missing RPC → 404) until retry', async () => {
    const fetch = installApi(async () => {
      throw new ApiError('not_found')
    })
    const store = useOutlinesStore()
    await store.load(VIEW, Z)
    for (let i = 0; i < 5; i++) await store.load({ ...VIEW, minLng: VIEW.minLng + i * 0.02, maxLng: VIEW.maxLng + i * 0.02 }, Z)
    expect(fetch).toHaveBeenCalledTimes(1)
    store.invalidate() // retry button
    await store.load(VIEW, Z)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('handles an empty response', async () => {
    installApi(async () => ({ features: [], truncated: false }))
    const store = useOutlinesStore()
    await store.load(VIEW, Z)
    expect(store.list).toEqual([])
    expect(store.error).toBeNull()
    expect(store.truncated).toBe(false)
  })

  it('does not cache a truncated answer as complete', async () => {
    const fetch = installApi(async () => ({ features: [outline(1, GAME)], truncated: true }))
    const store = useOutlinesStore()
    await store.load(VIEW, Z)
    expect(store.truncated).toBe(true)
    await store.load(VIEW, Z)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('selects only known footprints, marks discoveries and clears everything on reset', async () => {
    const fetch = installApi(() =>
      fetch.mock.calls.length === 1
        ? Promise.resolve({ features: [outline(1), outline(2, GAME)], truncated: false })
        : new Promise<OutlinesPage>(() => undefined), // never settles: only reset() ends it
    )
    const store = useOutlinesStore()
    await store.load(VIEW, Z)
    store.select(99)
    expect(store.selected).toBeNull()
    store.select(2)
    expect(store.selected?.game?.name).toBe('Школа')
    store.markDiscovered('g1', '2026-10-18T10:00:00Z')
    expect(store.selected?.game?.discoveredAt).toBe('2026-10-18T10:00:00Z')

    store.invalidate()
    void store.load(VIEW, Z + 1)
    store.reset()
    expect(fetch.mock.calls[1]![2]!.aborted).toBe(true)
    expect(store.list).toEqual([])
    expect(store.selectedId).toBeNull()
    expect(store.loading).toBe(false)
  })
})

describe('GameApi outlines', () => {
  const page = {
    truncated: false,
    features: [
      {
        type: 'Feature',
        id: 7,
        geometry: { type: 'MultiPolygon', coordinates: [[[[37.62, 55.65], [37.621, 55.65], [37.621, 55.651], [37.62, 55.65]]]] },
        properties: { osmType: 'way', osmId: 1007, address: 'Варшавское шоссе, 1', gameBuildingId: 'g1', gameStatus: 'published', gameName: 'Школа', rarity: 'rare' },
      },
      { type: 'Feature', id: 8, geometry: { type: 'Point', coordinates: [37.63, 55.66] }, properties: { osmType: 'node', osmId: 5 } },
    ],
  }

  function client(result: { data: unknown; error: unknown }) {
    const builder = Object.assign(Promise.resolve(result), { abortSignal: vi.fn() })
    builder.abortSignal.mockReturnValue(builder)
    return { rpc: vi.fn(() => builder), builder }
  }

  it('parses footprints with and without game state and passes the abort signal', async () => {
    const c = client({ data: page, error: null })
    const signal = new AbortController().signal
    const r = await new GameApi(c as unknown as SupabaseClient).getBuildingOutlines(
      { minLng: 37.6, minLat: 55.6, maxLng: 37.65, maxLat: 55.67 },
      16,
      signal,
    )
    expect(c.rpc).toHaveBeenCalledWith('osm_buildings_in_bbox', expect.objectContaining({ p_zoom: 16, p_min_lng: 37.6 }))
    expect(c.builder.abortSignal).toHaveBeenCalledWith(signal)
    expect(r.features[0]).toMatchObject({ id: 7, osmType: 'way', address: 'Варшавское шоссе, 1', game: { id: 'g1', status: 'published', rarity: 'rare', discoveredAt: null } })
    expect(r.features[1]).toMatchObject({ id: 8, game: null, geometry: { type: 'Point' } })
  })

  it('rejects malformed geometry and unknown statuses', async () => {
    const api = (data: unknown) => new GameApi(client({ data, error: null }) as unknown as SupabaseClient)
    const bbox = { minLng: 0, minLat: 0, maxLng: 0.01, maxLat: 0.01 }
    const bad = structuredClone(page)
    bad.features[0]!.geometry = { type: 'LineString', coordinates: [] } as never
    await expect(api(bad).getBuildingOutlines(bbox, 16)).rejects.toMatchObject({ code: 'invalid_response' })
    const badStatus = structuredClone(page)
    badStatus.features[0]!.properties.gameStatus = 'live'
    await expect(api(badStatus).getBuildingOutlines(bbox, 16)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('does not retry a missing RPC function (migration not applied)', async () => {
    const c = client({ data: null, error: { message: 'Could not find the function public.osm_buildings_in_bbox', code: 'PGRST202' } })
    await expect(
      new GameApi(c as unknown as SupabaseClient).getBuildingOutlines({ minLng: 0, minLat: 0, maxLng: 0.01, maxLat: 0.01 }, 16),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(c.rpc).toHaveBeenCalledTimes(1)
  })

  it('maps server errors: forbidden for non-admins, validation for oversized bbox', async () => {
    const forbidden = new GameApi(client({ data: null, error: { message: 'forbidden', code: '42501' } }) as unknown as SupabaseClient)
    await expect(forbidden.saveGameBuilding(1, { name: 'x' })).rejects.toMatchObject({ code: 'forbidden' })
    const tooLarge = new GameApi(client({ data: null, error: { message: 'bbox_too_large', code: '22023' } }) as unknown as SupabaseClient)
    await expect(tooLarge.getBuildingOutlines({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 }, 16)).rejects.toMatchObject({ code: 'validation' })
  })

  it('treats aborted requests as cancelled and does not retry them', async () => {
    const c = client({ data: null, error: { message: 'AbortError: The operation was aborted.', code: '' } })
    const controller = new AbortController()
    controller.abort()
    await expect(
      new GameApi(c as unknown as SupabaseClient).getBuildingOutlines({ minLng: 0, minLat: 0, maxLng: 0.01, maxLat: 0.01 }, 16, controller.signal),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(c.rpc).not.toHaveBeenCalled()
    const late = await new GameApi(c as unknown as SupabaseClient)
      .getBuildingOutlines({ minLng: 0, minLat: 0, maxLng: 0.01, maxLat: 0.01 }, 16)
      .catch((e: unknown) => e)
    expect(late).toMatchObject({ code: 'cancelled' })
    expect(c.rpc).toHaveBeenCalledTimes(1)
  })
})
