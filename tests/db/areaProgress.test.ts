import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, SEED, type TestDb } from './harness'

// Migration 025: area_progress() — game buildings of a game area and how many the player discovered.

let t: TestDb
const ZAVIDOVO = { lat: 56.595, lng: 36.52 }

async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `a${id.slice(0, 8)}`)
  await t.db.query(`insert into public.location_scan_testers (user_id) values ($1)`, [id])
  return id
}
const progress = (u: string | null, area: string) =>
  t.asUser(u, async (tx) => (await tx.query<{ p: { total: number; discovered: number } }>(`select public.area_progress($1) p`, [area])).rows[0]!.p)

beforeAll(async () => {
  t = await createTestDb({ seed: true })
  // one seed building moved to Zavidovo
  await t.db.query(
    `update public.buildings set location = extensions.st_setsrid(extensions.st_makepoint($2, $3), 4326)::extensions.geography where id = $1`,
    [SEED.tsum.id, ZAVIDOVO.lng, ZAVIDOVO.lat],
  )
})

describe('area_progress', () => {
  it('requires a signed-in player and a known area', async () => {
    await expect(progress(null, 'moscow')).rejects.toThrow(/permission denied|not_authenticated/)
    await expect(progress(await player(), 'paris')).rejects.toThrow(/area_not_found/)
  })

  it('counts the buildings inside each area and the player’s discoveries there', async () => {
    const u = await player()
    const moscow = await progress(u, 'moscow')
    expect(moscow.total).toBeGreaterThan(0)
    expect(moscow.discovered).toBe(0)
    expect(await progress(u, 'zavidovo')).toEqual({ total: 1, discovered: 0 })

    const r = await t.asUser(u, (tx) =>
      tx.query<{ r: { status: string } }>(`select public.submit_building_scan($1, $2, $3, $4, 10, 'location-test-v1', '{}'::real[], $5, null) as r`, [
        randomUUID(),
        SEED.tsum.id,
        ZAVIDOVO.lat,
        ZAVIDOVO.lng,
        randomUUID().replace(/-/g, '').padEnd(64, '0'),
      ]),
    )
    expect(r.rows[0]!.r.status).toBe('accepted')
    expect(await progress(u, 'zavidovo')).toEqual({ total: 1, discovered: 1 })
    expect((await progress(u, 'moscow')).discovered).toBe(0)
  })
})
