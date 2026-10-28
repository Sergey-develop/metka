import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 038: the Zavidovo game buildings get names instead of «Здание».

let t: TestDb
const D = 0.0004
const outline = (osmId: number, lng: number, lat: number, tags: Record<string, string>, name: string | null = null) => ({
  osmType: 'way',
  osmId,
  geometry: { type: 'Polygon', coordinates: [[[lng - D, lat - D], [lng + D, lat - D], [lng + D, lat + D], [lng - D, lat + D], [lng - D, lat - D]]] },
  name,
  address: null,
  tags,
})

beforeAll(async () => {
  t = await createTestDb({ stopBefore: '20261028000038' })
  // the restaurant «Царевна»: its footprint is drawn around the place's point
  const p = (
    await t.db.query<{ lat: number; lng: number }>(
      `select extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lng
         from public.area_places where id = 'zav-tsarevna'`,
    )
  ).rows[0]!
  await t.asServiceRole((tx) =>
    tx.query(`select public.import_osm_buildings($1)`, [
      JSON.stringify([
        outline(1453335155, 36.52384, 56.59267, { building: 'yes', 'addr:housenumber': '8' }), // the bay, no name
        outline(9001, p.lng, p.lat, { building: 'yes' }), // around «Царевна»
        outline(9002, 36.535, 56.596, { building: 'yes' }), // just a building of the resort
        outline(9003, 36.51914, 56.59509, { building: 'hotel' }, 'Отель Radisson Resort Zavidovo'),
      ]),
    ]),
  )
  await t.asServiceRole((tx) => tx.query(`select public.publish_osm_buildings_in_zone('zavidovo-core')`))
  await t.applyRemainingMigrations()
})

describe('zavidovo building names', () => {
  it('a corpus from the screenshot, a place inside, the rest of the resort; real names stay', async () => {
    const rows = await t.db.query<{ slug: string; name: string }>(
      `select slug, name from public.buildings where slug in ('osm-w1453335155', 'osm-w9001', 'osm-w9002', 'osm-w9003') order by slug`,
    )
    expect(Object.fromEntries(rows.rows.map((r) => [r.slug, r.name]))).toEqual({
      'osm-w1453335155': 'Эрбелия от Васта',
      'osm-w9001': 'Ресторан «Царевна»',
      'osm-w9002': 'Здание курорта Завидово',
      'osm-w9003': 'Отель Radisson Resort Zavidovo',
    })
  })
})
