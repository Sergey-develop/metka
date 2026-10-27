import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, SEED, type TestDb } from './harness'

// Migration 019: player_public_profile() — another player's profile, clanmates only;
// player_stats() / player_progress() keep working through _player_stats / _player_progress.

interface PublicProfile {
  profile: { id: string; username: string; level: number; homeDistrictId: string | null }
  stats: { streakDays: number; streets: { visited: number; total: number } }
  progress: Record<string, number>
  discoveredByDistrict: Record<string, number>
  achievements: { id: string; progress: number; completedAt: string | null }[]
  bestFinds: { buildingId: string; name: string; rarity: string; imageUrl: string | null }[]
}

let t: TestDb
const view = (viewer: string, target: string) =>
  t.asUser(viewer, async (tx) => (await tx.query<{ p: PublicProfile }>(`select public.player_public_profile($1) p`, [target])).rows[0]!.p)

async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `pp${id.slice(0, 8)}`)
  await t.db.query(`insert into public.location_scan_testers (user_id) values ($1) on conflict do nothing`, [id])
  return id
}

async function unlock(userId: string, b: { id: string; lat: number; lng: number }): Promise<void> {
  const r = await t.asUser(userId, (tx) =>
    tx.query<{ r: { status: string } }>(`select public.submit_building_scan($1, $2, $3, $4, 10, 'location-test-v1', '{}'::real[], $5, null) as r`, [
      randomUUID(),
      b.id,
      b.lat,
      b.lng,
      randomUUID().replace(/-/g, '').padEnd(64, '0'),
    ]),
  )
  expect(r.rows[0]!.r.status).toBe('accepted')
}

let n = 0
async function clanOf(owner: string, ...members: string[]): Promise<void> {
  n++
  const id = await t.asUser(owner, async (tx) => (await tx.query<{ id: string }>(`select public.create_clan($1, $2) as id`, [`Профили ${n}`, `PP${n}`])).rows[0]!.id)
  for (const m of members) await t.asUser(m, (tx) => tx.query(`select public.join_clan($1)`, [id]))
}

beforeAll(async () => {
  t = await createTestDb({ seed: true })
})

describe('player_public_profile', () => {
  it('requires a signed-in player', async () => {
    await expect(t.asUser(null, (tx) => tx.query(`select public.player_public_profile($1)`, [randomUUID()]))).rejects.toThrow(
      /permission denied|not_authenticated/,
    )
  })

  it('a clanmate sees the profile with real numbers', async () => {
    const owner = await player()
    const mate = await player()
    await clanOf(owner, mate)
    await t.db.query(`update public.profiles set home_district_id = $1 where id = $2`, [SEED.districtCao, mate])
    await unlock(mate, SEED.bolshoi)
    await unlock(mate, SEED.gum)

    const p = await view(owner, mate)
    expect(p.profile).toMatchObject({ id: mate, homeDistrictId: SEED.districtCao })
    expect(p.progress.unlockedBuildings).toBe(2)
    expect(p.discoveredByDistrict[SEED.districtCao]).toBe(2)
    expect(p.bestFinds.map((f) => f.buildingId).sort()).toEqual([SEED.bolshoi.id, SEED.gum.id].sort())
    expect(p.stats.streakDays).toBe(1) // two scans today
    const first = p.achievements.find((a) => a.id === SEED.questFirst)
    expect(first?.completedAt).not.toBeNull()
  })

  it('never returns private data: coins, memories, favourites', async () => {
    const owner = await player()
    const mate = await player()
    await clanOf(owner, mate)
    const p = await view(owner, mate)
    const json = JSON.stringify(p)
    expect(json).not.toMatch(/coins|memories|favoritePlaces|photo/i)
  })

  it('players outside the clan (and unknown ids) get the same refusal', async () => {
    const a = await player()
    const b = await player()
    const stranger = await player()
    await clanOf(a, b)
    await clanOf(stranger)
    await expect(view(stranger, a)).rejects.toThrow(/profile_hidden/)
    await expect(view(a, randomUUID())).rejects.toThrow(/profile_hidden/)
    const loner = await player()
    await expect(view(loner, a)).rejects.toThrow(/profile_hidden/)
  })

  it('anyone may open their own profile', async () => {
    const u = await player()
    expect((await view(u, u)).profile.id).toBe(u)
  })

  it('player_stats() and player_progress() still answer for the caller', async () => {
    const u = await player()
    await unlock(u, SEED.tsum)
    const stats = await t.asUser(u, async (tx) => (await tx.query<{ s: { streakDays: number } }>(`select public.player_stats() s`)).rows[0]!.s)
    const progress = await t.asUser(u, async (tx) => (await tx.query<{ p: { unlockedBuildings: number; memories: number } }>(`select public.player_progress() p`)).rows[0]!.p)
    expect(stats.streakDays).toBe(1)
    expect(progress).toMatchObject({ unlockedBuildings: 1, memories: 0 })
  })
})
