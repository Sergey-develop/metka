import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 039: the footprints of «Ямская слобода» move 10 m south onto the basemap; elsewhere they stay.

let t: TestDb
const D = 0.0002
const outline = (osmId: number, lng: number, lat: number) => ({
  osmType: 'way',
  osmId,
  geometry: { type: 'Polygon', coordinates: [[[lng, lat], [lng + D, lat], [lng + D, lat + D], [lng, lat + D], [lng, lat]]] },
  name: null,
  address: null,
  tags: { building: 'yes' },
})
const centroidLat = async (osmId: number) =>
  (
    await t.db.query<{ lat: number }>(`select extensions.st_y(centroid) lat from public.osm_buildings where osm_id = $1`, [osmId])
  ).rows[0]!.lat
const buildingLat = async (osmId: number) =>
  (
    await t.db.query<{ lat: number }>(
      `select extensions.st_y(b.location::extensions.geometry) lat from public.buildings b where b.slug = $1`,
      [`osm-w${osmId}`],
    )
  ).rows[0]!.lat

let before: Record<number, number>

beforeAll(async () => {
  t = await createTestDb({ stopBefore: '20261028000039' })
  await t.asServiceRole((tx) =>
    tx.query(`select public.import_osm_buildings($1)`, [JSON.stringify([outline(799781255, 36.5370, 56.5953), outline(9100, 36.5190, 56.5950)])]),
  )
  await t.asServiceRole((tx) => tx.query(`select public.publish_osm_buildings_in_zone('zavidovo-core')`))
  before = { 799781255: await centroidLat(799781255), 9100: await centroidLat(9100) }
  await t.applyRemainingMigrations()
})

describe('yamskaya outline offset', () => {
  it('a house of the quarter and its game point move 10 m south; one by the bay stays', async () => {
    expect(before[799781255]! - (await centroidLat(799781255))).toBeCloseTo(0.00009, 7)
    expect(await buildingLat(799781255)).toBeCloseTo(await centroidLat(799781255), 6)
    expect(await centroidLat(9100)).toBeCloseTo(before[9100]!, 9)
  })
})
