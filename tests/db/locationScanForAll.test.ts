import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, SEED, type TestDb } from './harness'

// Migration 030: the scan by location (009) is open to every player — existing and new ones.

let t: TestDb
let before: string

const SHA = () => randomUUID().replace(/-/g, '').padEnd(64, 'a')
const scan = (userId: string, o: { lat?: number; accuracy?: number } = {}) =>
  t.asUser(userId, async (tx) =>
    (
      await tx.query<{ r: { status: string; reason: string | null } }>(
        `select public.submit_building_scan($1, $2, $3, $4, $5, 'location-test-v1', $6::real[], $7, null) as r`,
        [randomUUID(), SEED.gum.id, o.lat ?? SEED.gum.lat, SEED.gum.lng, o.accuracy ?? 10, [], SHA()],
      )
    ).rows[0]!.r,
  )
const isTester = (userId: string) =>
  t.asUser(userId, async (tx) => (await tx.query<{ v: boolean }>(`select public.is_location_scan_tester() v`)).rows[0]!.v)

beforeAll(async () => {
  t = await createTestDb({ seed: true, stopBefore: '20261027000030' })
  before = randomUUID()
  await t.createUser(before, `b${before.slice(0, 8)}`)
  await t.applyRemainingMigrations()
  // 032 hides the centre's seed landmarks (Moscow is only the Varshavskaya quarter); this test is about 030
  await t.db.query(`update public.buildings set publish_status = 'published' where id = $1`, [SEED.gum.id])
})

describe('scan by location for every player', () => {
  it('a player registered before the migration can open a building standing next to it', async () => {
    expect(await isTester(before)).toBe(true)
    expect(await scan(before)).toMatchObject({ status: 'accepted', reason: null })
  })

  it('a new player is let in automatically', async () => {
    const u = randomUUID()
    await t.createUser(u, `n${u.slice(0, 8)}`)
    expect(await isTester(u)).toBe(true)
    expect((await scan(u)).status).toBe('accepted')
  })

  it('still requires presence and a tight GPS fix', async () => {
    const u = randomUUID()
    await t.createUser(u, `p${u.slice(0, 8)}`)
    expect((await scan(u, { lat: SEED.gum.lat + 0.01 })).reason).toBe('too_far')
    expect((await scan(u, { accuracy: 50 })).reason).toBe('location_inaccurate')
  })
})
