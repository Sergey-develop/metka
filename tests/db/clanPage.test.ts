import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, SEED, type TestDb } from './harness'

// Migration 017: clan_page() — weekly goal and leaders, owned districts, metrics, members, chronicle.

interface Page {
  clan: { id: string; name: string; tag: string; ownerId: string; members: number; maxMembers: number }
  week: { daysLeft: number; goal: { target: number; progress: number; districtId: string | null; districtName: string | null } }
  members: { userId: string; username: string; role: 'owner' | 'member'; weekCells: number }[]
  ownedDistricts: string[]
  metrics: { level: number; exploredCells: number; discoveries: number }
  chronicle: { kind: 'discovery' | 'joined'; at: string; username: string; buildingName?: string; rarity?: string }[]
}

let t: TestDb
const page = (u: string) => t.asUser(u, async (tx) => (await tx.query<{ p: Page | null }>(`select public.clan_page() p`)).rows[0]!.p)

const cellY = (lat: number) => Math.floor((lat + 90) / 0.0001)
const cellX = (lng: number) => Math.floor((lng + 180) / 0.00018)

/** a cell explored `daysAgo` Moscow days back (noon Moscow time) */
async function explore(u: string, lat: number, lng: number, daysAgo = 0): Promise<void> {
  await t.db.query(
    `insert into public.explored_cells (user_id, cell_y, cell_x, explored_at)
     values ($1, $2, $3, ((now() at time zone 'Europe/Moscow')::date - $4::integer + time '12:00') at time zone 'Europe/Moscow')
     on conflict do nothing`,
    [u, cellY(lat), cellX(lng), daysAgo],
  )
}

async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `p${id.slice(0, 8)}`)
  await t.db.query(`insert into public.location_scan_testers (user_id) values ($1)`, [id])
  return id
}

/** unlock a seed building through the real scan path (test-mode location scan, migration 009) */
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
async function clan(owner: string): Promise<string> {
  n++
  return t.asUser(owner, async (tx) => (await tx.query<{ id: string }>(`select public.create_clan($1, $2) as id`, [`Клан тест ${n}`, `CP${n}`])).rows[0]!.id)
}

beforeAll(async () => {
  t = await createTestDb({ seed: true })
})

describe('clan_page', () => {
  it('requires a signed-in player', async () => {
    await expect(t.asUser(null, (tx) => tx.query(`select public.clan_page()`))).rejects.toThrow(/permission denied|not_authenticated/)
  })

  it('is null for a player without a clan', async () => {
    expect(await page(await player())).toBeNull()
  })

  it('a new clan has zeros, not invented numbers', async () => {
    const owner = await player()
    const id = await clan(owner)
    const p = (await page(owner))!
    expect(p.clan).toMatchObject({ id, ownerId: owner, members: 1, maxMembers: 50 })
    expect(p.week.goal).toEqual({ target: 200, progress: 0, districtId: null, districtName: null })
    expect(p.week.daysLeft).toBeGreaterThanOrEqual(1)
    expect(p.week.daysLeft).toBeLessThanOrEqual(7)
    expect(p.members).toEqual([expect.objectContaining({ userId: owner, role: 'owner', weekCells: 0 })])
    expect(p.ownedDistricts).toEqual([])
    expect(p.metrics).toMatchObject({ exploredCells: 0, discoveries: 0 })
    expect(p.chronicle).toEqual([expect.objectContaining({ kind: 'joined' })])
  })

  it('weekly goal counts only this week and only the owner’s home district; leaders count everywhere', async () => {
    const owner = await player()
    const member = await player()
    const id = await clan(owner)
    await t.asUser(member, (tx) => tx.query(`select public.join_clan($1)`, [id]))
    await t.db.query(`update public.profiles set home_district_id = $1 where id = $2`, [SEED.districtCao, owner])

    // inside ЦАО this week: 2 by the owner, 1 by the member
    await explore(owner, SEED.bolshoi.lat, SEED.bolshoi.lng)
    await explore(owner, SEED.gum.lat, SEED.gum.lng)
    await explore(member, SEED.tsum.lat, SEED.tsum.lng)
    // outside ЦАО this week (far south) — a leader cell, not a goal cell
    await explore(member, 55.55, 37.6)
    // inside ЦАО but 8 days ago — neither
    await explore(owner, SEED.historical.lat, SEED.historical.lng, 8)

    const p = (await page(member))!
    expect(p.week.goal).toMatchObject({ target: 400, progress: 3, districtId: SEED.districtCao })
    expect(p.week.goal.districtName).toBeTruthy()
    const cells = Object.fromEntries(p.members.map((m) => [m.userId, m.weekCells]))
    expect(cells).toEqual({ [owner]: 2, [member]: 2 })
    expect(p.metrics.exploredCells).toBe(5)
  })

  it('owns a district only while its influence there is above every other clan’s', async () => {
    const a = await player()
    const b = await player()
    await clan(a)
    await clan(b)

    await unlock(a, SEED.bolshoi)
    let pa = (await page(a))!
    expect(pa.ownedDistricts).toContain(SEED.districtCao)
    expect(pa.metrics.discoveries).toBe(1)
    expect(pa.chronicle[0]).toMatchObject({ kind: 'discovery', buildingName: expect.any(String) })

    // the other clan catches up: a tie is nobody's
    await unlock(b, SEED.bolshoi)
    pa = (await page(a))!
    const pb = (await page(b))!
    expect(pa.ownedDistricts).not.toContain(SEED.districtCao)
    expect(pb.ownedDistricts).not.toContain(SEED.districtCao)

    await unlock(b, SEED.gum)
    expect((await page(b))!.ownedDistricts).toContain(SEED.districtCao)
    expect((await page(a))!.ownedDistricts).not.toContain(SEED.districtCao)
  })

  it('chronicle: newest first, at most 5 entries, only this clan', async () => {
    const owner = await player()
    const stranger = await player()
    await clan(owner)
    await clan(stranger)
    await unlock(stranger, SEED.historical)
    for (const b of [SEED.bolshoi, SEED.gum, SEED.historical, SEED.tsum]) await unlock(owner, b)
    // push the join into the past so the order is deterministic
    await t.db.query(`update public.clan_members set joined_at = now() - interval '1 day' where user_id = $1`, [owner])

    const c = (await page(owner))!.chronicle
    expect(c).toHaveLength(5)
    expect(c.every((e) => e.username === c[0]!.username)).toBe(true)
    const times = c.map((e) => Date.parse(e.at))
    expect([...times].sort((x, y) => y - x)).toEqual(times)
    expect(c.at(-1)!.kind).toBe('joined')
  })

  it('chronicle: discoveries made before joining the clan are not in it (migration 024)', async () => {
    const owner = await player()
    const newcomer = await player()
    const id = await clan(owner)
    await unlock(newcomer, SEED.gum)
    await t.asUser(newcomer, (tx) => tx.query(`select public.join_clan($1)`, [id]))
    await unlock(newcomer, SEED.tsum)

    const c = (await page(owner))!.chronicle.filter((e) => e.username === `p${newcomer.slice(0, 8)}`)
    expect(c.map((e) => e.kind)).toEqual(['discovery', 'joined'])
  })
})
