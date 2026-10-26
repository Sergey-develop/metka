import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// migration 022: the Zavidovo game area and the bulk publication of imported outlines
let t: TestDb

const Z_LAT = 56.5934
const Z_LNG = 36.528
const D = 0.0002

function square(lng: number, lat: number, d = D) {
  return [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]]
}

// name and address come pre-parsed, as tools/osm-import/geojson.ts sends them
const outline = (osmId: number, lng: number, lat: number, tags: Record<string, string>, name: string | null = null, address: string | null = null) => ({
  osmType: 'way',
  osmId,
  geometry: { type: 'Polygon', coordinates: square(lng, lat) },
  name,
  address,
  tags,
})

interface PublishResult {
  created: number
  publishedInBbox: number
}
const BBOX = [56.5851, 36.502, 56.6015, 36.5543] as const
const publish = (bbox: readonly number[] = BBOX) =>
  t.asServiceRole(async (tx) =>
    (
      await tx.query<{ r: PublishResult }>(`select public.publish_osm_buildings_in_bbox($1, $2, $3, $4) r`, [...bbox])
    ).rows[0]!.r,
  )

beforeAll(async () => {
  t = await createTestDb()
  await t.asServiceRole((tx) =>
    tx.query(`select public.import_osm_buildings($1)`, [
      JSON.stringify([
        outline(1, Z_LNG, Z_LAT, { building: 'hotel', name: 'Отель Radisson Resort Zavidovo' }, 'Отель Radisson Resort Zavidovo'),
        outline(2, Z_LNG + 3 * D, Z_LAT, { building: 'house', 'addr:street': 'Тверской бульвар', 'addr:housenumber': '4' }, null, 'Тверской бульвар, 4'),
        outline(3, Z_LNG + 6 * D, Z_LAT, { building: 'house' }),
        outline(4, Z_LNG + 9 * D, Z_LAT, { building: 'garage' }),
        outline(5, Z_LNG + 12 * D, Z_LAT, { building: 'shed' }),
        outline(6, Z_LNG + 15 * D, Z_LAT, { building: 'yes' }),
      ]),
    ]),
  )
})

describe('in_game_area', () => {
  it('Moscow and Zavidovo are in, the land between them is not', async () => {
    const r = await t.db.query<{ moscow: boolean; zavidovo: boolean; klin: boolean }>(
      `select public.in_game_area(55.75, 37.62) moscow, public.in_game_area($1, $2) zavidovo, public.in_game_area(56.33, 36.73) klin`,
      [Z_LAT, Z_LNG],
    )
    expect(r.rows[0]).toEqual({ moscow: true, zavidovo: true, klin: false })
  })

  it('exploration in Zavidovo is accepted (was outside_area)', async () => {
    const user = randomUUID()
    await t.createUser(user)
    const now = Date.now() - 1000
    const points = [0, 1, 2].map((i) => ({ lat: Z_LAT, lng: Z_LNG + i * 0.0001, accuracy: 8, t: now - (2 - i) * 5000 }))
    const r = await t.asUser(user, async (tx) =>
      (await tx.query<{ r: { accepted: number; rejected: Record<string, number>; totalCells: number } }>(
        `select public.record_exploration($1::jsonb) r`,
        [JSON.stringify(points)],
      )).rows[0]!.r,
    )
    expect(r.rejected).toEqual({})
    expect(r.accepted).toBe(3)
    expect(r.totalCells).toBeGreaterThan(0)
  })
})

describe('publish_osm_buildings_in_bbox', () => {
  it('only the service role may call it', async () => {
    const user = randomUUID()
    await t.createUser(user)
    await expect(
      t.asUser(user, (tx) => tx.query(`select public.publish_osm_buildings_in_bbox($1, $2, $3, $4)`, [...BBOX])),
    ).rejects.toThrow(/permission denied/)
  })

  it('publishes the outlines of the bbox as game buildings, skipping outhouses; idempotent', async () => {
    expect(await publish()).toEqual({ created: 4, publishedInBbox: 4 })
    const rows = (
      await t.db.query<{ osm_id: number; name: string; status: string; active: boolean; district: string | null }>(
        `select o.osm_id::int, b.name, b.publish_status status, b.is_active active, b.district_id district
           from public.buildings b join public.osm_buildings o on o.id = b.osm_building_id
          order by o.osm_id`,
      )
    ).rows
    expect(rows.map((r) => [r.osm_id, r.name])).toEqual([
      [1, 'Отель Radisson Resort Zavidovo'],
      [2, 'Тверской бульвар, 4'],
      [3, 'Жилой дом'],
      [6, 'Здание'],
    ])
    expect(rows.every((r) => r.status === 'published' && r.active && r.district === null)).toBe(true)
    // a second run creates nothing new
    expect(await publish()).toEqual({ created: 0, publishedInBbox: 4 })
  })

  it('refuses an oversized or inverted bbox', async () => {
    await expect(publish([56.5, 36.4, 56.7, 36.6])).rejects.toThrow(/invalid_bbox/)
    await expect(publish([56.6, 36.5, 56.5, 36.6])).rejects.toThrow(/invalid_bbox/)
  })
})
