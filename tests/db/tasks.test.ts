import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, SEED, type TestDb } from './harness'

// Migration 020: my_tasks() / claim_task() — tasks of the day and week, seasonal task.

interface Task {
  slug: string
  period: 'day' | 'week'
  kind: string
  target: number
  progress: number
  rewardCoins: number
  claimed: boolean
}
interface Tasks {
  day: { start: string; endsAt: string }
  week: { start: string; endsAt: string }
  tasks: Task[]
  season: { id: string; target: number; progress: number; completed: boolean; claimed: boolean } | null
}

let t: TestDb
const tasks = (u: string) => t.asUser(u, async (tx) => (await tx.query<{ r: Tasks }>(`select public.my_tasks() r`)).rows[0]!.r)
const task = async (u: string, slug: string) => (await tasks(u)).tasks.find((x) => x.slug === slug)!
const claim = (u: string, slug: string) =>
  t.asUser(u, async (tx) => (await tx.query<{ r: { status: string; coins: number } }>(`select public.claim_task($1) r`, [slug])).rows[0]!.r)
const coins = async (u: string) => (await t.db.query<{ c: number }>(`select coins c from public.profiles where id = $1`, [u])).rows[0]!.c

const cellY = (lat: number) => Math.floor((lat + 90) / 0.0001)
const cellX = (lng: number) => Math.floor((lng + 180) / 0.00018)
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
  await t.createUser(id, `t${id.slice(0, 8)}`)
  await t.db.query(`insert into public.location_scan_testers (user_id) values ($1)`, [id])
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

beforeAll(async () => {
  t = await createTestDb({ seed: true })
})

describe('my_tasks', () => {
  it('requires a signed-in player', async () => {
    await expect(t.asUser(null, (tx) => tx.query(`select public.my_tasks()`))).rejects.toThrow(/permission denied|not_authenticated/)
  })

  it('a new player: 4 tasks of the day and 1 of the week, all at zero', async () => {
    const r = await tasks(await player())
    expect(r.tasks.filter((x) => x.period === 'day')).toHaveLength(4)
    expect(r.tasks.filter((x) => x.period === 'week')).toHaveLength(1)
    expect(r.tasks.every((x) => x.progress === 0 && !x.claimed)).toBe(true)
    expect(Date.parse(r.day.endsAt)).toBeGreaterThan(Date.now())
  })

  it('counts only the current period: today’s discoveries, cells and okrugs of the week', async () => {
    const u = await player()
    await unlock(u, SEED.bolshoi)
    await explore(u, 55.75, 37.6)
    await explore(u, 55.751, 37.6)
    await explore(u, 55.76, 37.61, 1) // yesterday: not today's, maybe this week's
    expect((await task(u, 'day-discover')).progress).toBe(1)
    expect((await task(u, 'day-cells')).progress).toBe(2)
    // all cells are in ЦАО: one okrug this week
    expect((await task(u, 'week-districts')).progress).toBe(1)
  })

  it('progress never shows more than the target', async () => {
    const u = await player()
    await unlock(u, SEED.bolshoi)
    await unlock(u, SEED.gum)
    await unlock(u, SEED.historical)
    expect((await task(u, 'day-discover')).progress).toBe(2)
  })
})

describe('claim_task', () => {
  it('refuses an unfinished or unknown task', async () => {
    const u = await player()
    await expect(claim(u, 'day-discover')).rejects.toThrow(/task_not_completed/)
    await expect(claim(u, 'nope')).rejects.toThrow(/task_not_found/)
  })

  it('pays coins once per period', async () => {
    const u = await player()
    await unlock(u, SEED.bolshoi)
    await unlock(u, SEED.gum)
    const before = await coins(u)
    expect(await claim(u, 'day-discover')).toMatchObject({ status: 'claimed', coins: before + 50 })
    expect(await claim(u, 'day-discover')).toMatchObject({ status: 'already_claimed', coins: before + 50 })
    expect(await coins(u)).toBe(before + 50)
    expect((await task(u, 'day-discover')).claimed).toBe(true)
  })

  it('yesterday’s claim does not count for today', async () => {
    const u = await player()
    await unlock(u, SEED.bolshoi)
    await unlock(u, SEED.gum)
    await t.db.query(
      `insert into public.task_claims (user_id, task_slug, period_start, coins)
       values ($1, 'day-discover', (now() at time zone 'Europe/Moscow')::date - 1, 50)`,
      [u],
    )
    expect((await task(u, 'day-discover')).claimed).toBe(false)
    expect((await claim(u, 'day-discover')).status).toBe('claimed')
  })

  it('players cannot write claims themselves', async () => {
    const u = await player()
    await expect(
      t.asUser(u, (tx) => tx.query(`insert into public.task_claims (user_id, task_slug, period_start, coins) values ($1, 'day-cells', current_date, 9999)`, [u])),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('season', () => {
  it('is the active quest with an end date that ends soonest', async () => {
    const u = await player()
    expect((await tasks(u)).season).toBeNull()
    await t.db.query(`update public.quests set ends_at = now() + interval '30 days' where id = $1`, [SEED.questExplorer])
    const s = (await tasks(u)).season
    expect(s).toMatchObject({ id: SEED.questExplorer, completed: false, claimed: false })
    await t.db.query(`update public.quests set ends_at = null where id = $1`, [SEED.questExplorer])
  })
})
