import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 031: Тверской бульвар 6 and 12 (built, still building=construction in OSM) become game buildings.

let t: TestDb
const D = 0.0002
const square = (lng: number, lat: number) => [[[lng, lat], [lng + D, lat], [lng + D, lat + D], [lng, lat + D], [lng, lat]]]
const outline = (osmType: string, osmId: number, lng: number, lat: number, address: string) => ({
  osmType,
  osmId,
  geometry: { type: 'Polygon', coordinates: square(lng, lat) },
  name: null,
  address,
  category: 'construction',
  tags: { building: 'construction' },
})

beforeAll(async () => {
  t = await createTestDb({ stopBefore: '20261027000031' })
  await t.asServiceRole((tx) =>
    tx.query(`select public.import_osm_buildings($1)`, [
      JSON.stringify([
        outline('relation', 14440980, 36.51985, 56.59032, 'Тверской бульвар, 12'),
        outline('way', 1084410864, 36.52285, 56.59394, 'улица Тверской бульвар, 6'),
        outline('way', 976900759, 36.5145, 56.5975, 'улица Чистый Плёс, 2'), // not checked: stays plain
      ]),
    ]),
  )
  await t.applyRemainingMigrations()
})

describe('zavidovo built construction', () => {
  it('publishes Аква & SPA and Тверской бульвар 6, drops «Строится», leaves other construction sites alone', async () => {
    const rows = await t.db.query<{ osm_id: string; category: string | null; building: string; name: string | null; status: string | null }>(
      `select o.osm_id::text, o.category, o.tags ->> 'building' building, b.name, b.publish_status status
         from public.osm_buildings o left join public.buildings b on b.osm_building_id = o.id
        order by o.osm_id`,
    )
    expect(rows.rows).toEqual([
      { osm_id: '14440980', category: null, building: 'yes', name: 'Завидово Аква & SPA', status: 'published' },
      { osm_id: '976900759', category: 'construction', building: 'construction', name: null, status: null },
      { osm_id: '1084410864', category: null, building: 'yes', name: 'улица Тверской бульвар, 6', status: 'published' },
    ])
  })
})
