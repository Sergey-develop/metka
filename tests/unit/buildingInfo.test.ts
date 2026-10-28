import type { SupabaseClient } from '@supabase/supabase-js'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { services } from '@/app/providers/services'
import BuildingInfoSheet from '@/features/scanner/BuildingInfoSheet.vue'
import { ApiError } from '@/services/api/errors'
import { GameApi } from '@/services/api/gameApi'
import { factsFromOsm, kindLabel, safeWebsite, type OsmBuildingRow } from '@/services/buildings/buildingFacts'
import { useBuildingInfoStore, type InfoEntry } from '@/stores/buildingInfo'
import type { BuildingFacts, BuildingOutline } from '@/types/game'
import { installFakeServices } from './helpers'

const row = (tags: Record<string, unknown>, over: Partial<OsmBuildingRow> = {}): OsmBuildingRow => ({
  id: 7,
  osm_type: 'way',
  osm_id: 24912804,
  name: null,
  address: 'Сивашская улица, 4 к1',
  tags,
  updated_at: '2026-10-18T10:00:00Z',
  ...over,
})

describe('factsFromOsm', () => {
  it('uses real tags only: levels, year, series, flats', () => {
    const f = factsFromOsm(
      row({ building: 'apartments', 'building:levels': '12', start_date: '1976', 'design:ref': 'II-68-03/12Ю', 'building:flats': '171' }),
    )
    expect(f).toMatchObject({ kind: 'Жилой дом', levels: 12, built: '1976', series: 'II-68-03/12Ю', flats: 171 })
    expect(f.phone).toBeNull()
    expect(f.openingHours).toBeNull()
    expect(f.wikidataId).toBeNull()
  })

  it('turns malformed values into null instead of guessing', () => {
    const f = factsFromOsm(row({ building: 'yes', 'building:levels': '5;9', 'building:flats': '-3', wikidata: 'Wiki' }))
    expect(f).toMatchObject({ kind: null, levels: null, flats: null, wikidataId: null, built: null })
  })

  it('prefers a known amenity/shop over the building type', () => {
    expect(kindLabel({ building: 'school', amenity: 'music_school' })).toBe('Музыкальная школа')
    expect(kindLabel({ building: 'school', amenity: 'something_new' })).toBe('Школа')
    expect(kindLabel({ building: 'yes' })).toBeNull()
  })

  it('keeps only http(s) websites', () => {
    expect(safeWebsite('example.ru')).toBe('https://example.ru/')
    expect(safeWebsite('https://shop.example.ru/a')).toBe('https://shop.example.ru/a')
    expect(safeWebsite('javascript:alert(1)')).toBeNull()
    expect(safeWebsite('просто текст')).toBeNull()
  })
})

describe('GameApi.getBuildingFacts', () => {
  function client(result: { data: unknown; error: unknown }) {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(() => query),
      abortSignal: vi.fn(() => query),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
    }
    return { c: { from: vi.fn(() => query) }, query }
  }

  it('reads one osm_buildings row by id and parses it', async () => {
    const { c, query } = client({
      data: { id: 7, osm_type: 'way', osm_id: 1, name: 'ЦДиК «Южный»', address: null, tags: { building: 'school' }, updated_at: '2026-10-18T10:00:00Z' },
      error: null,
    })
    const facts = await new GameApi(c as unknown as SupabaseClient).getBuildingFacts(7)
    expect(c.from).toHaveBeenCalledWith('osm_buildings')
    expect(query.eq).toHaveBeenCalledWith('id', 7)
    expect(facts).toMatchObject({ osmBuildingId: 7, name: 'ЦДиК «Южный»', kind: 'Школа' })
  })

  it('reports a missing building as not_found', async () => {
    const { c } = client({ data: null, error: null })
    await expect(new GameApi(c as unknown as SupabaseClient).getBuildingFacts(7)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('GameApi.getBuildingOrganizations', () => {
  it('reads proven links only and maps kinds, contacts and safe websites', async () => {
    const rows = [
      { id: 1, name: 'Кофейня', kind_key: 'amenity', kind_value: 'cafe', tags: { opening_hours: 'Mo-Su 08:00-22:00', website: 'cafe.example.ru' }, link_method: 'inside_footprint' },
      { id: 2, name: 'Нечто', kind_key: 'shop', kind_value: 'unknown_kind', tags: { website: 'javascript:alert(1)', 'contact:phone': '+7 495 000-00-00' }, link_method: 'explicit' },
      { id: 3, name: 'Без связи', kind_key: 'shop', kind_value: 'books', tags: {}, link_method: null },
    ]
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    }
    const c = { from: vi.fn(() => query) }
    const orgs = await new GameApi(c as unknown as SupabaseClient).getBuildingOrganizations(7)
    expect(c.from).toHaveBeenCalledWith('osm_pois')
    expect(query.eq).toHaveBeenCalledWith('osm_building_id', 7)
    expect(orgs).toEqual([
      { id: 1, name: 'Кофейня', kind: 'Кафе', openingHours: 'Mo-Su 08:00-22:00', phone: null, website: 'https://cafe.example.ru/', link: 'inside_footprint' },
      { id: 2, name: 'Нечто', kind: null, openingHours: null, phone: '+7 495 000-00-00', website: null, link: 'explicit' },
    ])
  })
})

const FACTS: BuildingFacts = factsFromOsm(
  row({ building: 'apartments', 'building:levels': '12', start_date: '1976', 'design:ref': 'II-68-03/12Ю' }),
)

describe('building info store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    installFakeServices()
  })

  it('loads once even when asked twice, then serves the cache', async () => {
    const get = vi.mocked(services().api.getBuildingFacts).mockResolvedValue(FACTS)
    const store = useBuildingInfoStore()
    await Promise.all([store.load(7), store.load(7)])
    await store.load(7)
    expect(get).toHaveBeenCalledTimes(1)
    expect(store.get(7)).toEqual({ state: 'ready', facts: FACTS })
  })

  it('loads organisations alongside the facts; an organisations error does not hide the facts', async () => {
    vi.mocked(services().api.getBuildingFacts).mockResolvedValue(FACTS)
    vi.mocked(services().api.getBuildingOrganizations).mockRejectedValueOnce(new ApiError('offline'))
    const store = useBuildingInfoStore()
    await store.load(7)
    expect(store.get(7)?.state).toBe('ready')
    expect(store.organizations(7)).toMatchObject({ state: 'error' })
    vi.mocked(services().api.getBuildingOrganizations).mockResolvedValueOnce([])
    await store.load(7, true)
    expect(store.organizations(7)).toEqual({ state: 'ready', data: [] })
  })

  it('keeps the error until an explicit retry', async () => {
    const get = vi.mocked(services().api.getBuildingFacts).mockRejectedValueOnce(new ApiError('offline'))
    const store = useBuildingInfoStore()
    await store.load(7)
    expect(store.get(7)).toMatchObject({ state: 'error', error: { code: 'offline' } })
    await store.load(7)
    expect(get).toHaveBeenCalledTimes(1)
    get.mockResolvedValueOnce(FACTS)
    await store.load(7, true)
    expect(store.get(7)?.state).toBe('ready')
  })
})

const OUTLINE: BuildingOutline = {
  id: 7,
  osmType: 'way',
  osmId: 24912804,
  geometry: { type: 'Point', coordinates: [37.6, 55.66] },
  name: null,
  address: 'Сивашская улица, 4 к1',
  category: 'apartments',
  game: null,
}
const ready: InfoEntry = { state: 'ready', facts: FACTS }

function sheet(props: Partial<InstanceType<typeof BuildingInfoSheet>['$props']> = {}) {
  return mount(BuildingInfoSheet, {
    props: { outline: OUTLINE, info: ready, organizations: null, distanceM: null, expanded: false, ...props },
  })
}

describe('BuildingInfoSheet', () => {
  it('compact: kind, title; no street address; no distance unless given; no invented description', () => {
    const w = sheet()
    expect(w.find('.info__kind').text()).toBe('Жилой дом')
    // buildings go by their names only: no name → «Здание», never the street address
    expect(w.find('.info__title').text()).toBe('Здание')
    expect(w.text()).not.toContain('Сивашская')
    expect(w.find('.info__desc').exists()).toBe(false)
    expect(w.find('.info__facts').exists()).toBe(false)
    expect(sheet({ distanceM: 42 }).find('.info__distance').text()).toContain('≈40 м')
  })

  it('compact: an "interesting fact" strip from real data only; the chevron expands', async () => {
    const w = sheet()
    expect(w.find('.info__fact').text()).toBe('Интересный факт: здание построено в 1976 году.')
    expect(sheet({ info: { state: 'ready', facts: { ...FACTS, built: null, series: null, levels: 5 } } }).find('.info__fact').exists()).toBe(false)
    await w.find('.info__more').trigger('click')
    expect(w.emitted('update:expanded')).toEqual([[true]])
    expect(w.find('.info__close').exists()).toBe(false) // closing is a tap on the camera view
  })

  it('expanded: real facts, empty organisations explained, OSM source with date', async () => {
    const w = sheet({ expanded: true })
    const facts = w.findAll('.info__facts div').map((d) => d.text())
    expect(facts).toEqual(['Этажей12', 'Построено1976', 'СерияII-68-03/12Ю'])
    expect(w.find('.info__orgs').text()).toContain('Информация пока не добавлена')
    expect(w.find('.info__source').text()).toContain('© OpenStreetMap')
    expect(w.find('.info__source').text()).toContain('18 октября 2026')
  })

  it('lists organisations and shows their count in the compact card', () => {
    const orgs = [
      { id: 1, name: 'Кофейня', kind: 'Кафе', openingHours: 'Mo-Su 08:00-22:00', phone: null, website: null, link: 'inside_footprint' as const },
      { id: 2, name: 'Аптека №1', kind: 'Аптека', openingHours: null, phone: '+7 495 000-00-00', website: null, link: 'explicit' as const },
    ]
    expect(sheet({ organizations: orgs }).find('.info__meta').text()).toBe('2 организации внутри')
    const items = sheet({ organizations: orgs, expanded: true }).findAll('.info__orgs li').map((li) => li.text())
    expect(items[0]).toContain('Кофейня')
    expect(items[0]).toContain('Mo-Su 08:00-22:00')
    expect(items[1]).toContain('+7 495 000-00-00')
  })

  it('loading and error states; retry is emitted', async () => {
    expect(sheet({ info: { state: 'loading' } }).find('.info__loading').exists()).toBe(true)
    const w = sheet({ info: { state: 'error', error: new ApiError('offline') } })
    expect(w.find('.info__error').text()).toContain('Нет сети')
    await w.find('.info__link').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('game action: scan for a published locked building, memory once discovered, nothing for plain buildings', async () => {
    const game = { id: 'g1', status: 'published' as const, name: 'Башня Вулыха', description: 'Описание из каталога', category: null, rarity: 'rare' as const, imageUrl: null, discoveredAt: null }
    const locked = sheet({ outline: { ...OUTLINE, game } })
    expect(locked.find('.info__title').text()).toBe('Башня Вулыха')
    const open = locked.findAll('button').find((b) => b.text() === 'Открыть здание')
    await open!.trigger('click')
    expect(locked.emitted('scan')).toEqual([['g1']])

    const done = sheet({ outline: { ...OUTLINE, game: { ...game, discoveredAt: '2026-10-18T10:00:00Z' } } })
    expect(done.find('.info__done').exists()).toBe(true)
    expect(done.findAll('button').some((b) => b.text() === 'Открыть здание')).toBe(false)

    expect(sheet().findAll('button').some((b) => b.text() === 'Открыть здание')).toBe(false)
  })
})
