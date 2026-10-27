import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, SEED, type TestDb } from './harness'

// Migration 021: style_collections() — OSM style collections (walked past) and rarity counts.

interface Result {
  collections: { id: string; collected: number; total: number }[]
  rarity: { rarity: string; found: number; total: number }[]
}

let t: TestDb
const result = (u: string) => t.asUser(u, async (tx) => (await tx.query<{ r: Result }>(`select public.style_collections() r`)).rows[0]!.r)
const collection = async (u: string, id: string) => (await result(u)).collections.find((c) => c.id === id)!

const cellY = (lat: number) => Math.floor((lat + 90) / 0.0001)
const cellX = (lng: number) => Math.floor((lng + 180) / 0.00018)
async function explore(u: string, lat: number, lng: number): Promise<void> {
  await t.db.query(`insert into public.explored_cells (user_id, cell_y, cell_x) values ($1, $2, $3) on conflict do nothing`, [u, cellY(lat), cellX(lng)])
}

let osmId = 970_000_000
async function building(tags: Record<string, string>, lat: number, lng: number): Promise<void> {
  await t.db.query(
    `insert into public.osm_buildings (osm_type, osm_id, centroid, tags)
     values ('node', $1, extensions.st_setsrid(extensions.st_makepoint($2, $3), 4326), $4)`,
    [osmId++, lng, lat, tags],
  )
}

async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `s${id.slice(0, 8)}`)
  await t.db.query(`insert into public.location_scan_testers (user_id) values ($1) on conflict do nothing`, [id])
  return id
}

beforeAll(async () => {
  t = await createTestDb({ seed: true })
  await building({ building: 'yes', 'building:architecture': 'constructivism' }, 55.70, 37.60)
  await building({ building: 'yes', 'building:architecture': 'constructivism' }, 55.71, 37.60)
  await building({ building: 'yes', 'building:architecture': 'stalinist_neoclassicism' }, 55.72, 37.60)
  await building({ man_made: 'water_tower', building: 'yes' }, 55.73, 37.60)
  await building({ building: 'water_tower' }, 55.74, 37.60)
  await building({ building: 'yes', 'building:architecture': 'modern' }, 55.75, 37.60) // in no collection
})

describe('style_collections', () => {
  it('requires a signed-in player', async () => {
    await expect(t.asUser(null, (tx) => tx.query(`select public.style_collections()`))).rejects.toThrow(/permission denied|not_authenticated/)
  })

  it('totals come from OSM tags; a new player has collected nothing', async () => {
    const r = await result(await player())
    expect(r.collections).toEqual([
      { id: 'constructivism', collected: 0, total: 2 },
      { id: 'stalinist', collected: 0, total: 1 },
      { id: 'water_tower', collected: 0, total: 2 },
    ])
  })

  it('a building counts once the player walked past it (±2 cells)', async () => {
    const u = await player()
    await explore(u, 55.70 + 0.0001, 37.60) // one cell away from the first constructivist building
    await explore(u, 55.74 + 0.001, 37.60) // ~110 m from a water tower: too far
    expect(await collection(u, 'constructivism')).toEqual({ id: 'constructivism', collected: 1, total: 2 })
    expect((await collection(u, 'water_tower')).collected).toBe(0)
  })

  it('rarity: found game buildings out of the active catalog', async () => {
    const u = await player()
    const before = (await result(u)).rarity
    expect(before.map((r) => r.rarity)).toEqual(['rare', 'epic', 'legendary'])
    expect(before.every((r) => r.found === 0)).toBe(true)
    await t.asUser(u, (tx) =>
      tx.query(`select public.submit_building_scan($1, $2, $3, $4, 10, 'location-test-v1', '{}'::real[], $5, null)`, [
        randomUUID(),
        SEED.bolshoi.id,
        SEED.bolshoi.lat,
        SEED.bolshoi.lng,
        randomUUID().replace(/-/g, '').padEnd(64, '0'),
      ]),
    )
    // the Bolshoi is epic in the seed catalog
    const after = (await result(u)).rarity
    expect(after.find((r) => r.rarity === 'epic')!.found).toBe(1)
    expect(after.find((r) => r.rarity === 'rare')!.found).toBe(0)
    expect(after.find((r) => r.rarity === 'epic')!.total).toBeGreaterThanOrEqual(1)
  })
})
