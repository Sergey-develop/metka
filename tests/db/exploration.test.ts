import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { cellKey, cellOf, corridorCells, type Cell } from '../../src/services/exploration/grid.ts'
import { createTestDb, SEED, type TestDb } from './harness'

let t: TestDb

// near metro Varshavskaya
const LAT = 55.6534
const LNG = 37.6196
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

interface Pt {
  lat: number
  lng: number
  accuracy: number
  t: number
}

/** walk east from (lat, lng): `steps` fixes, `stepM` metres apart, `stepS` seconds apart, ending ~now */
function walk(lat: number, lng: number, steps: number, stepM: number, stepS: number, endAt = Date.now() - 1000): Pt[] {
  return Array.from({ length: steps }, (_, i) => ({
    lat,
    lng: lng + (i * stepM) / mPerDegLng(lat),
    accuracy: 8,
    t: endAt - (steps - 1 - i) * stepS * 1000,
  }))
}

interface Result {
  accepted: number
  rejected: Record<string, number>
  newCells: [number, number][]
  totalCells: number
}

async function record(userId: string | null, points: unknown): Promise<Result> {
  return t.asUser(userId, async (tx) => {
    const r = await tx.query<{ r: Result }>(`select public.record_exploration($1::jsonb) as r`, [JSON.stringify(points)])
    return r.rows[0]!.r
  })
}

async function inBbox(userId: string, bbox = [LNG - 0.01, LAT - 0.01, LNG + 0.01, LAT + 0.01], limit = 20000) {
  return t.asUser(userId, async (tx) => {
    const r = await tx.query<{ r: { cells: [number, number][]; truncated: boolean; totalCells: number } }>(
      `select public.explored_cells_in_bbox($1, $2, $3, $4, $5) as r`,
      [...bbox, limit],
    )
    return r.rows[0]!.r
  })
}

async function newUser(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id)
  return id
}

/** cells the server should reveal for a straight segment (18 m corridor), using the client grid */
function expectedCells(a: Pt, b: Pt): Set<string> {
  return new Set(corridorCells(a, b).map(cellKey))
}

const keys = (cells: readonly Cell[]) => new Set(cells.map(cellKey))

beforeAll(async () => {
  t = await createTestDb()
})

describe('exploration grid parity', () => {
  it('SQL and TypeScript put points into the same cells', async () => {
    const points = Array.from({ length: 300 }, (_, i) => [55.1 + ((i * 7919) % 1000) / 909.1, 36.8 + ((i * 104729) % 1000) / 625.3])
    const r = await t.db.query<{ y: number; x: number }>(
      `select floor((p.lat + 90) / 0.0001)::integer as y, floor((p.lng + 180) / 0.00018)::integer as x
       from jsonb_to_recordset($1::jsonb) as p(lat double precision, lng double precision)`,
      [JSON.stringify(points.map(([lat, lng]) => ({ lat, lng })))],
    )
    expect(r.rows.map((c) => [c.y, c.x])).toEqual(points.map(([lat, lng]) => [...cellOf(lat!, lng!)]))
  })
})

describe('record_exploration', () => {
  it('a single fix reveals nothing; a walked segment reveals the cells along it', async () => {
    const u = await newUser()
    const [a, b, c] = walk(LAT, LNG, 3, 15, 10)
    expect(await record(u, [a])).toMatchObject({ accepted: 1, newCells: [], totalCells: 0 })
    const r = await record(u, [b, c])
    expect(r.accepted).toBe(2)
    expect(keys(r.newCells)).toEqual(new Set([...expectedCells(a!, b!), ...expectedCells(b!, c!)]))
    expect(r.totalCells).toBe(r.newCells.length)
  })

  it('walking the same street again adds no duplicates', async () => {
    const u = await newUser()
    const first = await record(u, walk(LAT, LNG, 6, 12, 8, Date.now() - 120_000))
    expect(first.newCells.length).toBeGreaterThan(2)
    const again = await record(u, walk(LAT, LNG, 6, 12, 8))
    expect(again.accepted).toBe(6)
    expect(again.newCells).toEqual([])
    expect(again.totalCells).toBe(first.totalCells)
    const rows = await t.db.query<{ n: number; d: number }>(
      `select count(*)::int n, count(distinct (cell_y, cell_x))::int d from public.explored_cells where user_id = $1`,
      [u],
    )
    expect(rows.rows[0]!.n).toBe(rows.rows[0]!.d)
  })

  it('rejects inaccurate, out-of-area, badly timed and malformed fixes', async () => {
    const u = await newUser()
    const now = Date.now()
    const r = await record(u, [
      { lat: LAT, lng: LNG, accuracy: 60, t: now - 5000 },
      { lat: 59.93, lng: 30.31, accuracy: 5, t: now - 4000 }, // St Petersburg
      { lat: LAT, lng: LNG, accuracy: 5, t: now + 5 * 60_000 }, // future
      { lat: LAT, lng: LNG, accuracy: 5, t: now - 2 * 3600_000 }, // stale
      { lat: 'x', lng: LNG, accuracy: 5, t: now },
    ])
    expect(r.accepted).toBe(0)
    expect(r.rejected).toEqual({ inaccurate: 1, outside_area: 1, bad_time: 2, invalid: 1 })
  })

  it('treats GPS jumps as outliers and never interpolates across them', async () => {
    const u = await newUser()
    const now = Date.now()
    const r = await record(u, [
      { lat: LAT, lng: LNG, accuracy: 5, t: now - 30_000 },
      { lat: LAT + 0.005, lng: LNG, accuracy: 5, t: now - 25_000 }, // 556 m in 5 s
      { lat: LAT, lng: LNG + 0.0002, accuracy: 5, t: now - 20_000 }, // back on track, 12.5 m in 10 s
    ])
    expect(r.rejected).toEqual({ too_fast: 1 })
    // nothing towards the jump (50 rows north): only the 18 m corridor around the east-west walk,
    // i.e. at most two 11 m rows either side of the start row
    const startRow = cellOf(LAT, LNG)[0]
    expect(r.newCells.length).toBeGreaterThan(0)
    expect(r.newCells.every(([y]) => Math.abs(y - startRow) <= 2)).toBe(true)
  })

  it('does not draw a line across a pause, and re-anchors after a long one (bus, metro)', async () => {
    const u = await newUser()
    const now = Date.now()
    const gap = await record(u, [
      { lat: LAT, lng: LNG, accuracy: 5, t: now - 100_000 },
      { lat: LAT, lng: LNG + 0.0006, accuracy: 5, t: now - 60_000 }, // 37.6 m after 40 s: gap
    ])
    expect(gap).toMatchObject({ accepted: 2, newCells: [] })
    const far = await record(u, [
      { lat: LAT + 0.02, lng: LNG, accuracy: 5, t: now - 40_000 }, // 2.2 km in 20 s → outlier
      { lat: LAT + 0.02, lng: LNG, accuracy: 5, t: now + 1000 }, // > 120 s? no: 61 s → still too fast
    ])
    expect(far.rejected).toEqual({ too_fast: 2 })
    expect(far.newCells).toEqual([])
  })

  it('cannot claim more walking time than has passed: fixes before the last accepted one are rejected', async () => {
    const u = await newUser()
    const end = Date.now() - 1000
    await record(u, walk(LAT, LNG, 3, 10, 5, end))
    const replay = await record(u, walk(LAT + 0.001, LNG, 5, 10, 5, end - 1000))
    expect(replay.accepted).toBe(0)
    expect(replay.rejected.out_of_order).toBe(5)
  })

  it('caps new cells per 10 minutes (2000 since migration 014)', async () => {
    const u = await newUser()
    await record(u, [])
    await t.db.query(`update public.exploration_state set window_cells = 1999, window_start = now() where user_id = $1`, [u])
    const r = await record(u, walk(LAT, LNG, 5, 15, 5))
    expect(r.newCells).toHaveLength(1)
  })

  it('requires a signed-in player and validates input', async () => {
    await expect(record(null, [])).rejects.toThrow(/permission denied|not_authenticated/)
    const u = await newUser()
    await expect(record(u, { lat: 1 })).rejects.toThrow(/invalid_input/)
    await expect(record(u, Array.from({ length: 301 }, () => ({})))).rejects.toThrow(/invalid_input/)
  })

  it('players cannot write cells or tracking state directly, nor read other players', async () => {
    const u = await newUser()
    const other = await newUser()
    await record(other, walk(LAT, LNG, 4, 12, 6))
    await expect(
      t.asUser(u, (tx) => tx.query(`insert into public.explored_cells (user_id, cell_y, cell_x) values ($1, 1, 1)`, [u])),
    ).rejects.toThrow(/permission denied/)
    await expect(t.asUser(u, (tx) => tx.query(`select * from public.exploration_state`))).rejects.toThrow(/permission denied/)
    const visible = await t.asUser(u, (tx) => tx.query(`select * from public.explored_cells`))
    expect(visible.rows).toEqual([])
    expect((await inBbox(u)).cells).toEqual([])
  })
})

describe('explored_cells_in_bbox', () => {
  it('returns the caller’s cells in the viewport, empty elsewhere, and truncates at the limit', async () => {
    const u = await newUser()
    const r = await record(u, walk(LAT, LNG, 6, 14, 6))
    const all = await inBbox(u)
    expect(keys(all.cells)).toEqual(keys(r.newCells))
    expect(all).toMatchObject({ truncated: false, totalCells: r.totalCells })
    expect((await inBbox(u, [37.0, 55.2, 37.01, 55.21])).cells).toEqual([])
    const limited = await inBbox(u, undefined, 2)
    expect(limited.cells).toHaveLength(2)
    expect(limited.truncated).toBe(true)
    await expect(inBbox(u, [37.0, 55.2, 37.5, 55.3])).rejects.toThrow(/bbox_too_large/)
  })
})

describe('repeated and concurrent submissions', () => {
  it('re-sending the same batch (lost response) changes nothing', async () => {
    const u = await newUser()
    const batch = walk(LAT, LNG, 5, 12, 6)
    const first = await record(u, batch)
    const again = await record(u, batch)
    expect(again).toMatchObject({ accepted: 0, newCells: [], totalCells: first.totalCells })
    expect(again.rejected.out_of_order).toBe(5)
  })

  it('concurrent batches never duplicate cells (row lock + unique key); PGlite serialises, Postgres blocks on FOR UPDATE', async () => {
    const u = await newUser()
    const batch = walk(LAT, LNG + 0.002, 5, 12, 6)
    const results = await Promise.all([record(u, batch), record(u, batch), record(u, batch)])
    const rows = await t.db.query<{ n: number; d: number }>(
      `select count(*)::int n, count(distinct (cell_y, cell_x))::int d from public.explored_cells where user_id = $1`,
      [u],
    )
    expect(rows.rows[0]!.n).toBe(rows.rows[0]!.d)
    expect(results.reduce((sum, r) => sum + r.newCells.length, 0)).toBe(rows.rows[0]!.n)
  })
})

describe('territory is independent from buildings', () => {
  it('walking around a catalog building reveals cells but never discovers the building', async () => {
    const db = await createTestDb({ seed: true })
    const u = randomUUID()
    await db.createUser(u, 'walker')
    const now = Date.now() - 1000
    const around = Array.from({ length: 8 }, (_, i) => ({
      lat: SEED.gum.lat,
      lng: SEED.gum.lng - 0.0008 + i * 0.0002,
      accuracy: 6,
      t: now - (7 - i) * 6000,
    }))
    const r = await db.asUser(u, async (tx) =>
      (await tx.query<{ r: Result }>(`select public.record_exploration($1::jsonb) as r`, [JSON.stringify(around)])).rows[0]!.r,
    )
    expect(r.newCells.length).toBeGreaterThan(3)
    const discovered = await db.db.query<{ n: number }>(`select count(*)::int n from public.player_buildings where user_id = $1`, [u])
    expect(discovered.rows[0]!.n).toBe(0)
    const profile = await db.db.query<{ buildings_discovered: number; xp: number }>(
      `select buildings_discovered, xp from public.profiles where id = $1`,
      [u],
    )
    expect(profile.rows[0]).toEqual({ buildings_discovered: 0, xp: 0 })
  })
})
