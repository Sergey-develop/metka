import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { overpassToPois, type OsmPoiInput } from '../../tools/osm-import/pois.ts'
import { createTestDb, type TestDb } from './harness'

const LNG = 37.6196
const LAT = 55.6534
const D = 0.0004

function square(lng: number, lat: number, d = D) {
  return [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]]
}

function poi(osmId: number, lng: number, lat: number, over: Partial<OsmPoiInput> = {}): OsmPoiInput {
  return {
    osmType: 'node',
    osmId,
    lng,
    lat,
    name: `Место ${osmId}`,
    kindKey: 'shop',
    kindValue: 'convenience',
    tags: { shop: 'convenience', name: `Место ${osmId}` },
    hostWayIds: [],
    ...over,
  }
}

interface Report {
  inserted: number
  updated: number
  unchanged: number
  skipped: { osmId: number | null; reason: string }[]
}

describe('overpassToPois', () => {
  it('keeps named organisations, drops benches/unnamed/vacant, passes building ways as explicit hosts', () => {
    const r = overpassToPois({
      elements: [
        { type: 'node', id: 1, lat: LAT, lon: LNG, tags: { amenity: 'cafe', name: 'Кофейня' } },
        { type: 'node', id: 2, lat: LAT, lon: LNG, tags: { amenity: 'bench', name: 'Скамейка' } },
        { type: 'node', id: 3, lat: LAT, lon: LNG, tags: { shop: 'bakery' } },
        { type: 'node', id: 4, lat: LAT, lon: LNG, tags: { shop: 'vacant', name: 'Бывший магазин' } },
        { type: 'node', id: 5, lat: LAT, lon: LNG, tags: { office: 'company', name: 'ООО Ромашка', 'name:ru': 'Ромашка' } },
        { type: 'node', id: 6, lat: 95, lon: LNG, tags: { shop: 'books', name: 'Книги' } },
        { type: 'way', id: 900, nodes: [10, 5, 11] },
      ],
    })
    expect(r.items.map((i) => [i.osmId, i.name, i.kindKey, i.kindValue, i.hostWayIds])).toEqual([
      [1, 'Кофейня', 'amenity', 'cafe', []],
      [5, 'Ромашка', 'office', 'company', [900]],
    ])
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['invalid_coordinates', 'no_name', 'not_an_organisation', 'not_an_organisation'])
  })
})

describe('osm_pois (migration 012)', () => {
  let t: TestDb
  let player: string
  let a: number // building A (way 100)
  let b: number // building B (way 200), right of A

  const importPois = (items: unknown[]) =>
    t.asServiceRole(async (tx) => (await tx.query<{ r: Report }>(`select public.import_osm_pois($1) r`, [JSON.stringify(items)])).rows[0]!.r)
  const linkOf = async (osmId: number) =>
    (
      await t.db.query<{ building: number | null; method: string | null }>(
        `select osm_building_id::int building, link_method method from public.osm_pois where osm_id = $1`,
        [osmId],
      )
    ).rows[0]

  beforeAll(async () => {
    t = await createTestDb()
    player = randomUUID()
    await t.createUser(player, 'player')
    await t.asServiceRole((tx) =>
      tx.query(`select public.import_osm_buildings($1)`, [
        JSON.stringify([
          { osmType: 'way', osmId: 100, geometry: { type: 'Polygon', coordinates: square(LNG, LAT) }, tags: { building: 'yes' } },
          { osmType: 'way', osmId: 200, geometry: { type: 'Polygon', coordinates: square(LNG + 2 * D, LAT) }, tags: { building: 'yes' } },
          // two overlapping footprints further north (e.g. building + building:part mapped as building)
          { osmType: 'way', osmId: 300, geometry: { type: 'Polygon', coordinates: square(LNG, LAT + 4 * D) }, tags: { building: 'yes' } },
          { osmType: 'way', osmId: 301, geometry: { type: 'Polygon', coordinates: square(LNG + D / 2, LAT + 4 * D) }, tags: { building: 'retail' } },
        ]),
      ]),
    )
    const ids = await t.db.query<{ id: number; osm_id: number }>(`select id::int, osm_id::int from public.osm_buildings`)
    a = ids.rows.find((r) => r.osm_id === 100)!.id
    b = ids.rows.find((r) => r.osm_id === 200)!.id
  })

  it('links a point inside exactly one footprint; never by proximity alone', async () => {
    const r = await importPois([
      poi(1, LNG + D / 2, LAT + D / 2), // inside A
      poi(2, LNG + 1.5 * D, LAT + D / 2), // in the gap between A and B, a few metres from both
      poi(3, LNG + D * 0.75, LAT + 4.5 * D), // inside two overlapping footprints
    ])
    expect(r).toEqual({ inserted: 3, updated: 0, unchanged: 0, skipped: [] })
    expect(await linkOf(1)).toEqual({ building: a, method: 'inside_footprint' })
    expect(await linkOf(2)).toEqual({ building: null, method: null })
    expect(await linkOf(3)).toEqual({ building: null, method: null })
  })

  it('an explicit vertex link wins over the footprint test', async () => {
    // mapped on B's outline but its coordinates fall inside A (bad data): the explicit link is used
    await importPois([poi(4, LNG + D / 2, LAT + D / 2, { hostWayIds: [200] })])
    expect(await linkOf(4)).toEqual({ building: b, method: 'explicit' })
    // vertex of two building ways: not explicit, falls back to the footprint test
    await importPois([poi(5, LNG + 1.5 * D, LAT + D / 2, { hostWayIds: [100, 200] })])
    expect(await linkOf(5)).toEqual({ building: null, method: null })
  })

  it('re-import is idempotent and updates only changed rows; invalid items are skipped with a reason', async () => {
    const again = await importPois([poi(1, LNG + D / 2, LAT + D / 2)])
    expect(again).toEqual({ inserted: 0, updated: 0, unchanged: 1, skipped: [] })
    const moved = await importPois([poi(1, LNG + 2.5 * D, LAT + D / 2)]) // moved into B
    expect(moved.updated).toBe(1)
    expect(await linkOf(1)).toEqual({ building: b, method: 'inside_footprint' })

    const bad = await importPois([
      poi(10, LNG, LAT, { name: '  ' }),
      poi(11, LNG, 91),
      poi(12, LNG, LAT, { kindKey: 'highway' as never }),
      poi(13, LNG, LAT, { kindValue: 'Bad Value' }),
      { ...poi(14, LNG, LAT), osmType: 'way' },
      poi(15, LNG, LAT, { hostWayIds: ['x', -1, 1.5] as never }),
    ])
    expect(bad.skipped.map((s) => s.reason)).toEqual(['no_name', 'invalid_coordinates', 'invalid_kind', 'invalid_kind', 'invalid_id'])
    expect(bad.inserted).toBe(1) // 15: junk host ids ignored
  })

  it('relink_osm_pois follows changed footprints', async () => {
    await importPois([poi(20, LNG + 1.5 * D, LAT + D / 2)]) // in the gap: unlinked
    await t.asServiceRole((tx) =>
      tx.query(`select public.import_osm_buildings($1)`, [
        JSON.stringify([{ osmType: 'way', osmId: 100, geometry: { type: 'Polygon', coordinates: square(LNG, LAT, 1.7 * D) }, tags: { building: 'yes' } }]),
      ]),
    )
    const changed = await t.asServiceRole(async (tx) => (await tx.query<{ n: number }>(`select public.relink_osm_pois() n`)).rows[0]!.n)
    expect(changed).toBeGreaterThanOrEqual(1)
    expect(await linkOf(20)).toEqual({ building: a, method: 'inside_footprint' })
  })

  it('players read organisations of a building; nobody but the importer writes', async () => {
    const rows = await t.asUser(player, (tx) =>
      tx.query<{ name: string }>(`select name from public.osm_pois where osm_building_id = $1 order by name`, [b]),
    )
    expect(rows.rows.length).toBeGreaterThan(0)
    await expect(t.asUser(player, (tx) => tx.query(`update public.osm_pois set name = 'x'`))).rejects.toThrow(/permission denied/)
    await expect(
      t.asUser(player, (tx) => tx.query(`select public.import_osm_pois($1)`, [JSON.stringify([poi(30, LNG, LAT)])])),
    ).rejects.toThrow(/permission denied/)
    await expect(t.asUser(player, (tx) => tx.query(`select public.relink_osm_pois()`))).rejects.toThrow(/permission denied/)
    await expect(t.asUser(null, (tx) => tx.query(`select name from public.osm_pois`))).rejects.toThrow(/permission denied/)
  })
})
