import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 040: game buildings named after their street address get a generic name; real names stay.

let t: TestDb
const D = 0.0002
const outline = (osmId: number, lng: number, lat: number, name: string | null, address: string | null) => ({
  osmType: 'way',
  osmId,
  geometry: { type: 'Polygon', coordinates: [[[lng, lat], [lng + D, lat], [lng + D, lat + D], [lng, lat + D], [lng, lat]]] },
  name,
  address,
  tags: { building: 'yes' },
})

beforeAll(async () => {
  t = await createTestDb({ stopBefore: '20261028000040' })
  await t.asServiceRole((tx) =>
    tx.query(`select public.import_osm_buildings($1)`, [
      JSON.stringify([
        outline(9201, 36.535, 56.596, null, 'улица Тверской бульвар, 4'), // the resort, named by its address
        outline(9202, 36.519, 56.595, 'Отель Radisson Resort Zavidovo', 'Тверской бульвар, 2'), // a real name
      ]),
    ]),
  )
  await t.asServiceRole((tx) => tx.query(`select public.publish_osm_buildings_in_zone('zavidovo-core')`))
  await t.applyRemainingMigrations()
})

describe('building names, not addresses', () => {
  it('an address-named building of the resort is renamed; a real name stays', async () => {
    const rows = await t.db.query<{ slug: string; name: string }>(
      `select slug, name from public.buildings where slug in ('osm-w9201', 'osm-w9202') order by slug`,
    )
    expect(Object.fromEntries(rows.rows.map((r) => [r.slug, r.name]))).toEqual({
      'osm-w9201': 'Здание курорта Завидово',
      'osm-w9202': 'Отель Radisson Resort Zavidovo',
    })
  })
})
