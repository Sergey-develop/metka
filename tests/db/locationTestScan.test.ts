import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, SEED, type TestDb } from './harness'

let t: TestDb

interface Verdict {
  status: 'accepted' | 'rejected' | 'already_discovered'
  reason: string | null
  reward: { xp: number } | null
  profile: { buildingsDiscovered: number }
}

const SHA = () => randomUUID().replace(/-/g, '').padEnd(64, 'a')

async function scan(
  userId: string,
  o: { model?: string | null; lat?: number; lng?: number; accuracy?: number; sha?: string | null; embedding?: number[] } = {},
): Promise<Verdict> {
  return t.asUser(userId, async (tx) => {
    const r = await tx.query<{ r: Verdict }>(`select public.submit_building_scan($1, $2, $3, $4, $5, $6, $7::real[], $8, null) as r`, [
      randomUUID(),
      SEED.gum.id,
      o.lat ?? SEED.gum.lat,
      o.lng ?? SEED.gum.lng,
      o.accuracy ?? 10,
      o.model === undefined ? 'location-test-v1' : o.model,
      o.embedding ?? [],
      o.sha === undefined ? SHA() : o.sha,
    ])
    return r.rows[0]!.r
  })
}

async function user(tester: boolean): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `u${id.slice(0, 8)}`)
  if (tester) await t.db.query(`insert into public.location_scan_testers (user_id) values ($1)`, [id])
  return id
}

beforeAll(async () => {
  // the tester-only scan of migration 009; migration 030 opens it to every player (locationScanForAll.test.ts)
  t = await createTestDb({ seed: true, stopBefore: '20261027000030' })
})

describe('location-only test scans', () => {
  it('discovers the building for a listed tester standing next to it, with the usual reward', async () => {
    const u = await user(true)
    const v = await scan(u)
    expect(v).toMatchObject({ status: 'accepted', reason: null, profile: { buildingsDiscovered: 1 } })
    expect(v.reward?.xp).toBeGreaterThan(0)
    expect((await scan(u)).status).toBe('already_discovered')
    const row = await t.db.query<{ model_version: string }>(
      `select model_version from public.building_scans where user_id = $1 and status = 'accepted'`,
      [u],
    )
    expect(row.rows[0]!.model_version).toBe('location-test-v1') // auditable
  })

  it('is refused for regular players', async () => {
    const u = await user(false)
    expect(await scan(u)).toMatchObject({ status: 'rejected', reason: 'recognition_unavailable' })
  })

  it('still requires presence, a tight GPS fix and a photo', async () => {
    const u = await user(true)
    expect((await scan(u, { lat: SEED.gum.lat + 0.01 })).reason).toBe('too_far')
    expect((await scan(u, { accuracy: 50 })).reason).toBe('location_inaccurate')
    expect((await scan(u, { sha: null })).reason).toBe('invalid_request')
  })

  it('does not let a missing model version skip recognition (NULL must not bypass checks)', async () => {
    const tester = await user(true)
    const player = await user(false)
    for (const u of [tester, player]) {
      expect(await scan(u, { model: null, embedding: [1, 0, 0] })).toMatchObject({ status: 'rejected', reason: 'recognition_unavailable' })
    }
  })

  it('tester status is readable only for oneself and cannot be self-granted', async () => {
    const tester = await user(true)
    const player = await user(false)
    const check = (u: string) => t.asUser(u, async (tx) => (await tx.query<{ ok: boolean }>(`select public.is_location_scan_tester() as ok`)).rows[0]!.ok)
    expect(await check(tester)).toBe(true)
    expect(await check(player)).toBe(false)
    await expect(
      t.asUser(player, (tx) => tx.query(`insert into public.location_scan_testers (user_id) values ($1)`, [player])),
    ).rejects.toThrow(/permission denied/)
  })
})
