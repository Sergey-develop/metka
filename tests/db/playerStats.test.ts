import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 015: player_stats() — active days, streak, visited streets, clan level.

interface Stats {
  today: string
  streakDays: number
  activeDays: string[]
  streets: { visited: number; total: number; scope: 'home' | 'all' }
  clan: { level: number; discoveries: number } | null
}

let t: TestDb
const stats = (u: string) => t.asUser(u, async (tx) => (await tx.query<{ s: Stats }>(`select public.player_stats() s`)).rows[0]!.s)

const cellY = (lat: number) => Math.floor((lat + 90) / 0.0001)
const cellX = (lng: number) => Math.floor((lng + 180) / 0.00018)

/** a cell explored `daysAgo` Moscow days back (noon Moscow time, so the day never shifts) */
async function explore(u: string, lat: number, lng: number, daysAgo: number): Promise<void> {
  await t.db.query(
    `insert into public.explored_cells (user_id, cell_y, cell_x, explored_at)
     values ($1, $2, $3, ((now() at time zone 'Europe/Moscow')::date - $4::integer + time '12:00') at time zone 'Europe/Moscow')
     on conflict do nothing`,
    [u, cellY(lat), cellX(lng), daysAgo],
  )
}

let osmId = 900_000_000
async function building(street: string | null, lat: number, lng: number): Promise<void> {
  const tags = street ? { 'addr:street': street, 'addr:housenumber': '1' } : {}
  await t.db.query(
    `insert into public.osm_buildings (osm_type, osm_id, centroid, tags)
     values ('node', $1, extensions.st_setsrid(extensions.st_makepoint($2, $3), 4326), $4)`,
    [osmId++, lng, lat, tags],
  )
}

beforeAll(async () => {
  t = await createTestDb({ seed: true })
})

describe('player_stats', () => {
  it('requires a signed-in player', async () => {
    await expect(t.asUser(null, (tx) => tx.query(`select public.player_stats()`))).rejects.toThrow(/permission denied|not_authenticated/)
  })

  it('a new player has zeros, not invented numbers', async () => {
    const u = randomUUID()
    await t.createUser(u)
    const s = await stats(u)
    expect(s.streakDays).toBe(0)
    expect(s.activeDays).toEqual([])
    expect(s.streets.visited).toBe(0)
    expect(s.clan).toBeNull()
  })

  it('counts the streak up to today and keeps it while today is still open', async () => {
    const u = randomUUID()
    await t.createUser(u)
    // yesterday, 2 and 3 days ago, then a gap, then 5 days ago
    for (const [i, d] of [1, 2, 3, 5].entries()) await explore(u, 55.70 + i * 0.001, 37.60, d)
    let s = await stats(u)
    expect(s.streakDays).toBe(3)
    expect(s.activeDays).toHaveLength(4)
    expect(s.activeDays.at(-1)).not.toBe(s.today)

    await explore(u, 55.71, 37.60, 0)
    s = await stats(u)
    expect(s.streakDays).toBe(4)
    expect(s.activeDays.at(-1)).toBe(s.today)
  })

  it('returns only the last 84 days for the activity grid, but the streak is not capped by it', async () => {
    const u = randomUUID()
    await t.createUser(u)
    for (let d = 0; d < 90; d++) await explore(u, 55.60 + d * 0.0005, 37.50, d)
    const s = await stats(u)
    expect(s.activeDays).toHaveLength(84)
    expect(s.streakDays).toBe(90)
  })

  it('visited streets: a street counts once the player walked within ~22 m of one of its buildings', async () => {
    const u = randomUUID()
    await t.createUser(u)
    const base = { lat: 55.6534, lng: 37.6196 }
    await building('Улица Проверки', base.lat, base.lng)
    await building('Улица Проверки', base.lat + 0.001, base.lng)
    await building('Переулок Далёкий', base.lat + 0.01, base.lng)
    await building(null, base.lat, base.lng + 0.001)

    const before = await stats(u)
    // two cells (~11 m × 2) away from the first building: still counts
    await explore(u, base.lat + 0.0002, base.lng, 0)
    const after = await stats(u)
    expect(after.streets.scope).toBe('all')
    expect(after.streets.total).toBe(before.streets.total)
    expect(after.streets.visited).toBe(before.streets.visited + 1)

    // the same street again does not count twice
    await explore(u, base.lat + 0.001, base.lng, 0)
    expect((await stats(u)).streets.visited).toBe(after.streets.visited)
  })

  it('clan: level from the members’ total XP, discoveries of all members', async () => {
    const owner = randomUUID()
    const member = randomUUID()
    await t.createUser(owner, `own${owner.slice(0, 6)}`)
    await t.createUser(member, `mem${member.slice(0, 6)}`)
    const clanId = await t.asUser(owner, async (tx) => (await tx.query<{ id: string }>(`select public.create_clan('Статистика', 'STA') as id`)).rows[0]!.id)
    await t.asUser(member, (tx) => tx.query(`select public.join_clan($1)`, [clanId]))
    await t.db.query(`update public.profiles set xp = 600 where id = any($1)`, [[owner, member]])

    const [expected] = (await t.db.query<{ l: number }>(`select public.level_for_xp(1200) l`)).rows
    const s = await stats(member)
    expect(s.clan).toEqual({ level: expected!.l, discoveries: 0 })
  })
})
