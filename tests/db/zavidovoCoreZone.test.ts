import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 027: Zavidovo trimmed to the owner's core zone — places, routes, artifacts, game buildings.

interface Place {
  id: string
  lat: number | null
  lng: number | null
  tags: string[]
  openingHours: string | null
  phone: string | null
  website: string | null
  needsCheck: boolean
}
interface Quests {
  routes: { slug: string; steps: { id: string; kind: string; place: Place | null }[] }[]
  places: Place[]
  collections: { id: string; items: { id: string }[] }[]
}

let t: TestDb
const D = 0.0002
const square = (lng: number, lat: number) => [[[lng, lat], [lng + D, lat], [lng + D, lat + D], [lng, lat + D], [lng, lat]]]
const outline = (osmId: number, lng: number, lat: number, tags: Record<string, string>, name: string | null = null) => ({
  osmType: 'way',
  osmId,
  geometry: { type: 'Polygon', coordinates: square(lng, lat) },
  name,
  address: null,
  tags,
})

async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `c${id.slice(0, 8)}`)
  return id
}
const quests = async (u: string) =>
  t.asUser(u, async (tx) => (await tx.query<{ q: Quests }>(`select public.area_quests('zavidovo') q`)).rows[0]!.q)
const inZone = async (lat: number, lng: number) =>
  (
    await t.db.query<{ v: boolean }>(
      `select extensions.st_covers(boundary, extensions.st_setsrid(extensions.st_makepoint($2, $1), 4326)::extensions.geography) v
         from public.area_zones where id = 'zavidovo-core'`,
      [lat, lng],
    )
  ).rows[0]!.v

beforeAll(async () => {
  // Zavidovo as migration 027 left it; check-ins and «Голоса леса» come in 028 (placeCheckIns.test.ts)
  t = await createTestDb({ stopBefore: '20261027000028' })
})

describe('zavidovo core zone', () => {
  it('the zone holds the resort core: Царевна, Radisson, СырЗавод, Акватория — not the village, the golf or the forest park', async () => {
    expect(await inZone(56.60028, 36.51376)).toBe(true) // Царевна
    expect(await inZone(56.59509, 36.51914)).toBe(true) // Radisson
    expect(await inZone(56.59638, 36.53766)).toBe(true) // СырЗавод
    expect(await inZone(56.59855, 36.5105)).toBe(true) // Акватория лета, on the shore line
    expect(await inZone(56.5297, 36.5303)).toBe(false) // храмовый комплекс
    expect(await inZone(56.58272, 36.55488)).toBe(false) // гольф
    expect(await inZone(56.59711, 36.54742)).toBe(false) // «Ямской лес»
  })

  it('shows only active places, all inside the zone, with categories and contacts', async () => {
    const q = await quests(await player())
    for (const p of q.places) {
      expect(p.lat, p.id).not.toBeNull()
      expect(await inZone(p.lat!, p.lng!), p.id).toBe(true)
    }
    const ids = q.places.map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['zav-bay', 'zav-syrzavod', 'zav-radisson', 'zav-alpaca', 'zav-tennis', 'zav-aqua-spa']))
    expect(ids).not.toEqual(expect.arrayContaining(['zav-temple-complex']))
    expect(ids).not.toContain('zav-golf')
    expect(ids).not.toContain('zav-meridian')
    // every place has at least one map category
    expect(q.places.filter((p) => p.tags.length === 0).map((p) => p.id)).toEqual([])
    const traktir = q.places.find((p) => p.id === 'zav-traktir')!
    expect(traktir.tags).toEqual(['food'])
    expect(traktir.openingHours).toContain('09:00')
    expect(traktir.website).toBe('https://yatraktir.ru')
    // points taken from the Yandex screenshot are marked approximate
    expect(q.places.find((p) => p.id === 'zav-alpaca')!.needsCheck).toBe(true)
  })

  it('keeps the bay and the forest routes (the forest one moved onto the trail), hides the old road and its collection', async () => {
    const q = await quests(await player())
    expect(q.routes.map((r) => r.slug)).toEqual(['zav-catch-wave', 'zav-forest'])
    for (const s of q.routes.flatMap((r) => r.steps)) {
      if (s.place) expect(await inZone(s.place.lat!, s.place.lng!), s.id).toBe(true)
    }
    expect(q.collections.map((c) => c.id)).toEqual(['zav-elements', 'zav-postcards', 'zav-trophies'])
    // every artifact shown can still be earned: the road ones are gone
    const shown = q.collections.flatMap((c) => c.items.map((i) => i.id))
    expect(shown).not.toContain('road-sign')
    expect(shown).toEqual(expect.arrayContaining(['forest-whisper', 'forest-voice', 'explorer-trace', 'pioneer-map']))
  })

  it('a moved forest step is done at its new place', async () => {
    const u = await player()
    const step = (await quests(u)).routes.find((r) => r.slug === 'zav-forest')!.steps[0]!
    expect(step.place!.id).toBe('zav-ant-trail-start')
    const r = await t.asUser(u, async (tx) =>
      (
        await tx.query<{ r: { status: string } }>(`select public.complete_route_step($1, $2, $3, 10, null) r`, [
          step.id,
          step.place!.lat,
          step.place!.lng,
        ])
      ).rows[0]!.r,
    )
    expect(r.status).toBe('done')
  })

  it('publishes the outlines inside the zone and hides bulk-published Zavidovo buildings outside it', async () => {
    await t.asServiceRole((tx) =>
      tx.query(`select public.import_osm_buildings($1)`, [
        JSON.stringify([
          outline(901, 36.51914, 56.59509, { building: 'hotel' }, 'Отель Radisson Resort Zavidovo'),
          outline(902, 36.5193, 56.5953, { building: 'shed' }),
          outline(903, 36.5303, 56.5297, { building: 'church' }, 'Церковь'), // the village: outside
        ]),
      ]),
    )
    // the village church was published in bulk before (migration 022)
    await t.asServiceRole((tx) => tx.query(`select public.publish_osm_buildings_in_bbox(56.52, 36.52, 56.54, 36.54)`))

    const run = () =>
      t.asServiceRole(async (tx) =>
        (await tx.query<{ r: { created: number; hidden: number } }>(`select public.publish_osm_buildings_in_zone('zavidovo-core') r`)).rows[0]!.r,
      )
    expect(await run()).toEqual({ created: 1, hidden: 1 })
    expect(await run()).toEqual({ created: 0, hidden: 0 })
    const rows = await t.db.query<{ name: string; status: string }>(
      `select b.name, b.publish_status status from public.buildings b join public.osm_buildings o on o.id = b.osm_building_id
        where o.osm_id in (901, 902, 903) order by o.osm_id`,
    )
    expect(rows.rows).toEqual([
      { name: 'Отель Radisson Resort Zavidovo', status: 'published' },
      { name: 'Церковь', status: 'hidden' },
    ])
    await expect(
      t.asUser(await player(), (tx) => tx.query(`select public.publish_osm_buildings_in_zone('zavidovo-core')`)),
    ).rejects.toThrow(/permission denied/)
  })
})
