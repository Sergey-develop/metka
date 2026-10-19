import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, SEED, type TestDb } from './harness'

let t: TestDb

interface Saved {
  memory: { id: string; building_id: string; note: string | null; impression: string | null; is_favorite: boolean; photo_path: string | null }
  previousPhotoPath: string | null
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

async function save(userId: string, buildingId: string, o: { note?: string; impression?: string | null; favorite?: boolean; photo?: string | null; visited?: string | null } = {}) {
  return t.asUser(userId, async (tx) => {
    const r = await tx.query<{ r: Saved }>(`select public.save_memory($1, $2, $3::date, $4, $5, $6) as r`, [
      buildingId,
      o.note ?? 'Было здорово',
      o.visited === undefined ? '2026-10-18' : o.visited,
      o.impression === undefined ? 'wow' : o.impression,
      o.favorite ?? false,
      o.photo ?? null,
    ])
    return r.rows[0]!.r
  })
}

async function upload(userId: string, name = `${userId}/${randomUUID()}.webp`): Promise<string> {
  await t.asUser(userId, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner) values ('memory-photos', $1, $2)`, [name, userId]))
  return name
}

async function progress(userId: string) {
  return t.asUser(userId, async (tx) => (await tx.query<{ r: Record<string, number> }>(`select public.player_progress() as r`)).rows[0]!.r)
}

beforeAll(async () => {
  t = await createTestDb({ seed: true })
})

describe('memories', () => {
  it('can be saved only for an unlocked building', async () => {
    const u = await player()
    await expect(save(u, SEED.gum.id)).rejects.toThrow(/building_locked/)
    await unlock(u, SEED.gum)
    const r = await save(u, SEED.gum.id, { favorite: true })
    expect(r.memory).toMatchObject({ building_id: SEED.gum.id, note: 'Было здорово', impression: 'wow', is_favorite: true })
    expect(r.memory).not.toHaveProperty('user_id')
  })

  it('saving again updates the same memory (no duplicates) and reports the replaced photo', async () => {
    const u = await player()
    await unlock(u, SEED.tsum)
    const first = await upload(u)
    const a = await save(u, SEED.tsum.id, { photo: first })
    const second = await upload(u)
    const b = await save(u, SEED.tsum.id, { photo: second, impression: 'meh', note: '  ' })
    expect(b.memory.id).toBe(a.memory.id)
    expect(b.memory).toMatchObject({ impression: 'meh', note: null, photo_path: second })
    expect(b.previousPhotoPath).toBe(first)
    const count = await t.db.query<{ n: number }>(`select count(*)::int n from public.memories where user_id = $1`, [u])
    expect(count.rows[0]!.n).toBe(1)
  })

  it('validates photo ownership/existence, impression and date', async () => {
    const u = await player()
    const other = await player()
    await unlock(u, SEED.bolshoi)
    const foreign = await upload(other)
    await expect(save(u, SEED.bolshoi.id, { photo: foreign })).rejects.toThrow(/invalid_photo/)
    await expect(save(u, SEED.bolshoi.id, { photo: `${u}/${randomUUID()}.webp` })).rejects.toThrow(/invalid_photo/) // not uploaded
    await expect(save(u, SEED.bolshoi.id, { impression: 'love' })).rejects.toThrow(/invalid_memory/)
    await expect(save(u, SEED.bolshoi.id, { visited: '2999-01-01' })).rejects.toThrow(/invalid_memory/)
    await expect(save(u, SEED.bolshoi.id, { note: 'x'.repeat(2001) })).rejects.toThrow(/invalid_memory/)
  })

  it('are private: no reads of others, no direct writes, photos only in own folder', async () => {
    const u = await player()
    const other = await player()
    await unlock(u, SEED.historical)
    await save(u, SEED.historical.id)
    const seen = await t.asUser(other, (tx) => tx.query(`select * from public.memories`))
    expect(seen.rows).toEqual([])
    await expect(
      t.asUser(u, (tx) => tx.query(`update public.memories set is_favorite = true where user_id = $1`, [u])),
    ).rejects.toThrow(/permission denied/)
    await expect(upload(u, `${other}/${randomUUID()}.webp`)).rejects.toThrow(/row-level security|policy/)
    const own = await upload(u)
    const othersView = await t.asUser(other, (tx) => tx.query(`select name from storage.objects where bucket_id = 'memory-photos' and name = $1`, [own]))
    expect(othersView.rows).toEqual([])
  })

  it('delete returns the photo to remove and fails for unknown memories', async () => {
    const u = await player()
    await unlock(u, SEED.gum)
    const photo = await upload(u)
    await save(u, SEED.gum.id, { photo })
    const path = await t.asUser(u, async (tx) => (await tx.query<{ p: string }>(`select public.delete_memory($1) as p`, [SEED.gum.id])).rows[0]!.p)
    expect(path).toBe(photo)
    await expect(t.asUser(u, (tx) => tx.query(`select public.delete_memory($1)`, [SEED.gum.id]))).rejects.toThrow(/not_found/)
  })
})

describe('player_progress', () => {
  it('counts each thing from its own table; an okrug counts from 50 cells', async () => {
    const u = await player()
    expect(await progress(u)).toMatchObject({ exploredCells: 0, exploredDistricts: 0, unlockedBuildings: 0, memories: 0, favoritePlaces: 0 })

    await unlock(u, SEED.gum)
    await unlock(u, SEED.tsum)
    await save(u, SEED.gum.id, { favorite: true })
    await save(u, SEED.tsum.id, { favorite: false })

    // 49 cells in the centre (ЦАО), then 1 more: the okrug counts only at 50
    const y0 = Math.floor((SEED.gum.lat + 90) / 0.0002)
    const x0 = Math.floor((SEED.gum.lng + 180) / 0.00036)
    const cells = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `('${u}', ${y0}, ${x0 + from + i})`).join(',')
    await t.db.query(`insert into public.explored_cells (user_id, cell_y, cell_x) values ${cells(49)}`)
    expect(await progress(u)).toMatchObject({ exploredCells: 49, exploredDistricts: 0, unlockedBuildings: 2, memories: 2, favoritePlaces: 1 })
    await t.db.query(`insert into public.explored_cells (user_id, cell_y, cell_x) values ${cells(1, 49)}`)
    expect(await progress(u)).toMatchObject({ exploredCells: 50, exploredDistricts: 1 })
  })
})

describe('discovery photo (collection)', () => {
  async function setPhoto(userId: string, buildingId: string, path: string, replace = true) {
    return t.asUser(userId, async (tx) =>
      (await tx.query<{ p: string | null }>(`select public.set_discovery_photo($1, $2, $3) as p`, [buildingId, path, replace])).rows[0]!.p,
    )
  }

  it('links the scan photo to the unlocked building, replaces it, or keeps it on re-scan', async () => {
    const u = await player()
    await expect(setPhoto(u, SEED.gum.id, await upload(u))).rejects.toThrow(/building_locked/)
    await unlock(u, SEED.gum)
    const first = await upload(u)
    expect(await setPhoto(u, SEED.gum.id, first)).toBeNull()
    const second = await upload(u)
    expect(await setPhoto(u, SEED.gum.id, second, false)).toBe(second) // kept the first: delete the new upload
    const third = await upload(u)
    expect(await setPhoto(u, SEED.gum.id, third, true)).toBe(first) // replaced: delete the old one
    const row = await t.asUser(u, (tx) =>
      tx.query<{ photo_path: string }>(`select photo_path from public.player_buildings where building_id = $1`, [SEED.gum.id]),
    )
    expect(row.rows[0]!.photo_path).toBe(third)
  })

  it('accepts only own, existing photos and no direct writes', async () => {
    const u = await player()
    const other = await player()
    await unlock(u, SEED.tsum)
    await expect(setPhoto(u, SEED.tsum.id, await upload(other))).rejects.toThrow(/invalid_photo/)
    await expect(setPhoto(u, SEED.tsum.id, `${u}/${randomUUID()}.webp`)).rejects.toThrow(/invalid_photo/)
    await expect(
      t.asUser(u, (tx) => tx.query(`update public.player_buildings set photo_path = null where user_id = $1`, [u])),
    ).rejects.toThrow(/permission denied/)
  })
})
