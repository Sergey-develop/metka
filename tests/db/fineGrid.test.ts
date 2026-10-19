import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { cellKey, cellOf, corridorCells, CORRIDOR_HALF_WIDTH_M } from '../../src/services/exploration/grid.ts'
import { createTestDb, SEED, type TestDb } from './harness'

// Migration 013: 0.0002 × 0.00036 grid → 0.0001 × 0.00018 grid with an 8 m corridor;
// migration 014: corridor half-width 18 m (at least 3 cells across the route).

const LAT = 55.6534 // near metro Varshavskaya
const LNG = 37.6196
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

interface Pt {
  lat: number
  lng: number
  accuracy: number
  t: number
}
interface Result {
  accepted: number
  rejected: Record<string, number>
  newCells: [number, number][]
  totalCells: number
}

/** walk from (lat, lng) along a bearing: fixes `stepM` apart, `stepS` seconds apart, ending ~now */
function walk(lat: number, lng: number, steps: number, stepM: number, stepS: number, bearingDeg = 90, endAt = Date.now() - 1000): Pt[] {
  const b = (bearingDeg * Math.PI) / 180
  return Array.from({ length: steps }, (_, i) => ({
    lat: lat + (Math.cos(b) * i * stepM) / 111_320,
    lng: lng + (Math.sin(b) * i * stepM) / mPerDegLng(lat),
    accuracy: 8,
    t: endAt - (steps - 1 - i) * stepS * 1000,
  }))
}

describe('migration 013: converting existing progress', () => {
  let t: TestDb
  let walker: string
  let centre: string
  let other: string
  const oldCells = new Map<string, Set<string>>()
  let progressBefore: { exploredCells: number; exploredDistricts: number }

  const record = (u: string, points: unknown) =>
    t.asUser(u, async (tx) => (await tx.query<{ r: Result }>(`select public.record_exploration($1::jsonb) r`, [JSON.stringify(points)])).rows[0]!.r)
  const progress = (u: string) =>
    t.asUser(u, async (tx) => (await tx.query<{ p: { exploredCells: number; exploredDistricts: number; districtMinCells: number } }>(`select public.player_progress() p`)).rows[0]!.p)

  beforeAll(async () => {
    t = await createTestDb({ stopBefore: '20261019000013', seed: true })
    walker = randomUUID()
    centre = randomUUID()
    other = randomUUID()
    for (const u of [walker, centre, other]) await t.createUser(u)

    // real old-grid progress through the old record_exploration (migration 008)
    await record(walker, walk(LAT, LNG, 40, 12, 8))
    // 60 old cells in ЦАО: an explored okrug under the old threshold (50)
    const y0 = Math.floor((SEED.gum.lat + 90) / 0.0002)
    const x0 = Math.floor((SEED.gum.lng + 180) / 0.00036)
    await t.db.query(
      `insert into public.explored_cells (user_id, cell_y, cell_x, explored_at)
       select $1, $2, $3 + i, now() - make_interval(days => i) from generate_series(0, 59) i`,
      [centre, y0, x0],
    )
    await t.db.query(`insert into public.explored_cells (user_id, cell_y, cell_x) values ($1, $2, $3)`, [other, y0 + 5, x0])

    const rows = await t.db.query<{ user_id: string; cell_y: number; cell_x: number }>(`select user_id, cell_y, cell_x from public.explored_cells`)
    for (const r of rows.rows) {
      const set = oldCells.get(r.user_id) ?? new Set<string>()
      set.add(`${r.cell_y}:${r.cell_x}`)
      oldCells.set(r.user_id, set)
    }
    progressBefore = await progress(centre)
    expect(progressBefore.exploredDistricts).toBe(1)
    expect(oldCells.get(walker)!.size).toBeGreaterThan(10)

    await t.applyRemainingMigrations()
  })

  it('every old cell becomes exactly its four new cells; nothing else is added', async () => {
    for (const [user, cells] of oldCells) {
      const expected = new Set<string>()
      for (const k of cells) {
        const [y, x] = k.split(':').map(Number) as [number, number]
        for (const dy of [0, 1]) for (const dx of [0, 1]) expected.add(`${2 * y + dy}:${2 * x + dx}`)
      }
      const rows = await t.db.query<{ cell_y: number; cell_x: number }>(`select cell_y, cell_x from public.explored_cells where user_id = $1`, [user])
      expect(new Set(rows.rows.map((r) => `${r.cell_y}:${r.cell_x}`))).toEqual(expected)
    }
  })

  it('keeps explored_at and the old table as a backup without client access', async () => {
    const r = await t.db.query<{ mismatched: number; v1: number; v2: number }>(
      `select (select count(*)::int from public.explored_cells n
                join public.explored_cells_v1 o
                  on o.user_id = n.user_id and o.cell_y = n.cell_y / 2 and o.cell_x = n.cell_x / 2
               where o.explored_at <> n.explored_at) as mismatched,
              (select count(*)::int from public.explored_cells_v1) as v1,
              (select count(*)::int from public.explored_cells) as v2`,
    )
    expect(r.rows[0]).toEqual({ mismatched: 0, v1: r.rows[0]!.v1, v2: r.rows[0]!.v1 * 4 })
    await expect(t.asUser(walker, (tx) => tx.query(`select * from public.explored_cells_v1`))).rejects.toThrow(/permission denied/)
  })

  it('the four new cells cover the old cell exactly: no gaps, no overlaps (PostGIS)', async () => {
    const r = await t.db.query<{ bad: number; checked: number }>(
      `with old as (select distinct cell_y, cell_x from public.explored_cells_v1),
       cmp as (
         select o.cell_y, o.cell_x,
                extensions.st_makeenvelope(o.cell_x * 0.00036 - 180, o.cell_y * 0.0002 - 90,
                                           (o.cell_x + 1) * 0.00036 - 180, (o.cell_y + 1) * 0.0002 - 90, 4326) as parent,
                (select extensions.st_union(extensions.st_makeenvelope(
                          (2 * o.cell_x + dx) * 0.00018 - 180, (2 * o.cell_y + dy) * 0.0001 - 90,
                          (2 * o.cell_x + dx + 1) * 0.00018 - 180, (2 * o.cell_y + dy + 1) * 0.0001 - 90, 4326))
                   from (values (0, 0), (0, 1), (1, 0), (1, 1)) d (dy, dx)) as children,
                (select sum(extensions.st_area(extensions.st_makeenvelope(
                          (2 * o.cell_x + dx) * 0.00018 - 180, (2 * o.cell_y + dy) * 0.0001 - 90,
                          (2 * o.cell_x + dx + 1) * 0.00018 - 180, (2 * o.cell_y + dy + 1) * 0.0001 - 90, 4326)))
                   from (values (0, 0), (0, 1), (1, 0), (1, 1)) d (dy, dx)) as area_sum
         from old o
       )
       select count(*) filter (where not extensions.st_equals(parent, children)
                                  or abs(area_sum - extensions.st_area(parent)) > 1e-15)::int as bad,
              count(*)::int as checked
       from cmp`,
    )
    expect(r.rows[0]!.checked).toBeGreaterThan(50)
    expect(r.rows[0]!.bad).toBe(0)
  })

  it('a point keeps its old cell: new index / 2 = old index (SQL and TypeScript)', async () => {
    const points = Array.from({ length: 2000 }, (_, i) => ({ lat: 55.1 + ((i * 7919) % 10007) / 9097.3, lng: 36.8 + ((i * 104729) % 10007) / 6254.4 }))
    // exact old-grid boundaries are the risky case for floating point
    for (let i = 0; i < 200; i++) points.push({ lat: (728250 + i) * 0.0002 - 90, lng: (603300 + i) * 0.00036 - 180 })
    const r = await t.db.query<{ oy: number; ox: number; ny: number; nx: number }>(
      `select floor((p.lat + 90) / 0.0002)::int oy, floor((p.lng + 180) / 0.00036)::int ox,
              floor((p.lat + 90) / 0.0001)::int ny, floor((p.lng + 180) / 0.00018)::int nx
       from jsonb_to_recordset($1::jsonb) p(lat double precision, lng double precision)`,
      [JSON.stringify(points)],
    )
    r.rows.forEach((row, i) => {
      expect([Math.floor(row.ny / 2), Math.floor(row.nx / 2)]).toEqual([row.oy, row.ox])
      expect(cellOf(points[i]!.lat, points[i]!.lng)).toEqual([row.ny, row.nx])
    })
  })

  it('nobody loses progress: cells ×4, explored okrugs kept (threshold 130 ≤ 4 × 50)', async () => {
    const after = await progress(centre)
    expect(after.exploredCells).toBe(progressBefore.exploredCells * 4)
    expect(after.exploredDistricts).toBeGreaterThanOrEqual(progressBefore.exploredDistricts)
    expect(after.districtMinCells).toBe(130)
  })

  it('players still see only their own cells, in the new grid', async () => {
    const mine = await t.asUser(walker, (tx) =>
      tx.query<{ r: { cells: [number, number][]; totalCells: number } }>(`select public.explored_cells_in_bbox($1, $2, $3, $4) r`, [
        LNG - 0.01,
        LAT - 0.01,
        LNG + 0.01,
        LAT + 0.01,
      ]),
    )
    expect(mine.rows[0]!.r.totalCells).toBe(oldCells.get(walker)!.size * 4)
    expect(mine.rows[0]!.r.cells).toHaveLength(oldCells.get(walker)!.size * 4)
    const seen = await t.asUser(walker, (tx) => tx.query<{ user_id: string }>(`select distinct user_id from public.explored_cells`))
    expect(seen.rows.map((r) => r.user_id)).toEqual([walker])
  })

  it('tracking continues from the last fix saved before the migration', async () => {
    const before = await t.db.query<{ last_lat: number; last_lng: number }>(`select last_lat, last_lng from public.exploration_state where user_id = $1`, [walker])
    const anchor = before.rows[0]!
    const next = { lat: anchor.last_lat, lng: anchor.last_lng + 12 / mPerDegLng(anchor.last_lat), accuracy: 8, t: Date.now() - 500 }
    const r = await record(walker, [next])
    const expected = new Set(corridorCells({ lat: anchor.last_lat, lng: anchor.last_lng }, next).map(cellKey))
    for (const c of r.newCells) expect(expected.has(cellKey(c))).toBe(true)
  })
})

describe('migration 013: re-run and data guards', () => {
  const MIGRATION = readFileSync('supabase/migrations/20261019000013_fine_exploration_grid.sql', 'utf8')
  const snapshot = async (t: TestDb) =>
    (
      await t.db.query<{ cells: number; v1: string | null; corridor: string | null }>(
        `select (select count(*)::int from public.explored_cells) cells,
                to_regclass('public.explored_cells_v1')::text v1,
                to_regprocedure('public._corridor_cells(double precision,double precision,double precision,double precision,double precision)')::text corridor`,
      )
    ).rows[0]!
  // the migration in one explicit transaction, as in the SQL Editor; on error roll back like the editor
  const applyAgain = async (t: TestDb) => {
    try {
      await t.db.exec(`begin;
${MIGRATION}
commit;`)
    } finally {
      await t.db.exec('rollback').catch(() => undefined)
    }
  }

  it('a second run stops with a clear message and changes nothing', async () => {
    const t = await createTestDb()
    const u = randomUUID()
    await t.createUser(u)
    await t.db.query(`insert into public.explored_cells (user_id, cell_y, cell_x) values ($1, 1456534, 1208997)`, [u])
    const before = await snapshot(t)
    await expect(applyAgain(t)).rejects.toThrow(/migration 013 is already applied: public.explored_cells_v1 exists/)
    expect(await snapshot(t)).toEqual(before)
  })

  it('still refuses after explored_cells_v1 is dropped later (would split cells twice)', async () => {
    const t = await createTestDb()
    const u = randomUUID()
    await t.createUser(u)
    await t.db.query(`insert into public.explored_cells (user_id, cell_y, cell_x) values ($1, 1456534, 1208997)`, [u])
    await t.db.exec('drop table public.explored_cells_v1')
    const before = await snapshot(t)
    await expect(applyAgain(t)).rejects.toThrow(/migration 013 is already applied: public.explored_cells is on the fine grid/)
    expect(await snapshot(t)).toEqual(before)
  })

  it('refuses old cells that have no place in the new grid, before changing anything', async () => {
    const t = await createTestDb({ stopBefore: '20261019000013' })
    const u = randomUUID()
    await t.createUser(u)
    // lat exactly 90°: allowed by the old check, never accepted by the server (Moscow only)
    await t.db.query(`insert into public.explored_cells (user_id, cell_y, cell_x) values ($1, 900000, 5)`, [u])
    const before = await snapshot(t)
    await expect(applyAgain(t)).rejects.toThrow(/outside the convertible range/)
    expect(await snapshot(t)).toEqual(before)
    expect(before.v1).toBeNull()
  })
})

describe('fine grid and corridor (migration 013)', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await createTestDb()
  })
  const record = (u: string, points: unknown) =>
    t.asUser(u, async (tx) => (await tx.query<{ r: Result }>(`select public.record_exploration($1::jsonb) r`, [JSON.stringify(points)])).rows[0]!.r)
  const newUser = async () => {
    const id = randomUUID()
    await t.createUser(id)
    return id
  }

  it('cells are ≈11 m on the ground across the game area (PostGIS geodesic)', async () => {
    const r = await t.db.query<{ lat: number; h: number; w: number }>(
      `select lat,
              extensions.st_distance(extensions.st_makepoint(37.6, lat)::extensions.geography,
                                     extensions.st_makepoint(37.6, lat + 0.0001)::extensions.geography) h,
              extensions.st_distance(extensions.st_makepoint(37.6, lat)::extensions.geography,
                                     extensions.st_makepoint(37.60018, lat)::extensions.geography) w
       from unnest(array[55.1, 55.75, 56.2]::double precision[]) lat`,
    )
    for (const row of r.rows) {
      expect(row.h).toBeGreaterThan(11.0)
      expect(row.h).toBeLessThan(11.2)
      expect(row.w).toBeGreaterThan(11.0)
      expect(row.w).toBeLessThan(11.6)
    }
  })

  it('SQL corridor = TypeScript corridor for random segments', async () => {
    const segs = Array.from({ length: 60 }, (_, i) => {
      const a = { lat: 55.6 + ((i * 37) % 100) / 1000, lng: 37.5 + ((i * 53) % 100) / 1000 }
      const d = 3 + ((i * 17) % 150)
      const bearing = ((i * 47) % 360) * (Math.PI / 180)
      return { a, b: { lat: a.lat + (Math.cos(bearing) * d) / 111_320, lng: a.lng + (Math.sin(bearing) * d) / mPerDegLng(a.lat) } }
    })
    for (const w of [8, CORRIDOR_HALF_WIDTH_M]) {
      for (const { a, b } of segs) {
        const r = await t.db.query<{ cell_y: number; cell_x: number }>(`select * from public._corridor_cells($1, $2, $3, $4, $5)`, [a.lat, a.lng, b.lat, b.lng, w])
        expect(new Set(r.rows.map((c) => `${c.cell_y}:${c.cell_x}`))).toEqual(new Set(corridorCells(a, b, w).map(cellKey)))
      }
    }
  })

  it('the corridor follows the route: no gaps, at least 3 cells across, nothing beyond 18 m, no street 40 m away', async () => {
    const u = await newUser()
    const pts = walk(LAT, LNG, 20, 10, 6, 63) // 190 m north-east
    const r = await record(u, pts)
    const opened = new Set(r.newCells.map(([y, x]) => `${y}:${x}`))
    // every point of the walked line lies in an opened cell
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k <= 10; k++) {
        const lat = pts[i]!.lat + ((pts[i + 1]!.lat - pts[i]!.lat) * k) / 10
        const lng = pts[i]!.lng + ((pts[i + 1]!.lng - pts[i]!.lng) * k) / 10
        expect(opened.has(cellKey(cellOf(lat, lng)))).toBe(true)
        // and its neighbours across the route (it runs mostly east, so across = north/south)
        const [y, x] = cellOf(lat, lng)
        if (i > 0 && i < pts.length - 2) {
          expect(opened.has(cellKey([y - 1, x]))).toBe(true)
          expect(opened.has(cellKey([y + 1, x]))).toBe(true)
        }
      }
    }
    // a parallel street 40 m away gets nothing (the corridor never reaches beyond ≈26 m)
    for (const p of pts) {
      const side = { lat: p.lat - (40 * Math.sin((63 * Math.PI) / 180)) / 111_320, lng: p.lng + (40 * Math.cos((63 * Math.PI) / 180)) / mPerDegLng(p.lat) }
      expect(opened.has(cellKey(cellOf(side.lat, side.lng)))).toBe(false)
    }
    // all opened cell centres are within the half-width of the route
    const ky = 111_320
    const kx = mPerDegLng(LAT)
    for (const key of opened) {
      const [y, x] = key.split(':').map(Number) as [number, number]
      const c = { lat: (y + 0.5) * 0.0001 - 90, lng: (x + 0.5) * 0.00018 - 180 }
      let best = Infinity
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = (c.lng - pts[i]!.lng) * kx
        const ay = (c.lat - pts[i]!.lat) * ky
        const ex = (pts[i + 1]!.lng - pts[i]!.lng) * kx
        const ey = (pts[i + 1]!.lat - pts[i]!.lat) * ky
        const tt = Math.max(0, Math.min(1, (ax * ex + ay * ey) / (ex * ex + ey * ey)))
        best = Math.min(best, Math.hypot(ax - tt * ex, ay - tt * ey))
      }
      expect(best).toBeLessThanOrEqual(CORRIDOR_HALF_WIDTH_M + 1e-6)
    }
  })

  it('≈1 km of walking opens ≈290–300 cells (18 m corridor), within the 10-minute cap', async () => {
    const u = await newUser()
    const r = await record(u, walk(LAT, LNG, 201, 5, 3, 30)) // 1 km at 1.7 m/s
    expect(r.rejected).toEqual({})
    expect(r.newCells.length).toBeGreaterThan(270)
    expect(r.newCells.length).toBeLessThan(320)
  })

  it('a single fix, a pause or a jump still reveals nothing', async () => {
    const u = await newUser()
    const now = Date.now()
    expect((await record(u, [{ lat: LAT, lng: LNG, accuracy: 5, t: now - 90_000 }])).newCells).toEqual([])
    const pause = await record(u, [{ lat: LAT, lng: LNG + 40 / mPerDegLng(LAT), accuracy: 5, t: now - 30_000 }]) // 60 s later
    expect(pause.newCells).toEqual([])
    const jump = await record(u, [{ lat: LAT + 0.004, lng: LNG, accuracy: 5, t: now - 25_000 }]) // 450 m in 5 s
    expect(jump.rejected).toEqual({ too_fast: 1 })
    expect(jump.newCells).toEqual([])
  })
})
