import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 023: landmark collections — landmark_collections, mark_landmark.

interface CollectionJson {
  id: string
  title: string
  items: { id: string; name: string; marked: boolean }[]
}
interface MarkJson {
  marked: { id: string; name: string } | null
  nearest: { name: string; distance_m: number } | null
}

let t: TestDb
// Триумфальная площадь: the Mayakovsky monument and the «Маяковская» metro hall are next to each other
const MAYAKOVSKY = { lat: 55.7698, lng: 37.5958 }

async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `l${id.slice(0, 8)}`)
  return id
}
const list = (u: string) =>
  t.asUser(u, async (tx) => (await tx.query<{ c: CollectionJson[] }>(`select public.landmark_collections() c`)).rows[0]!.c)
const mark = (u: string, collection: string, at: { lat: number; lng: number }, accuracy = 15) =>
  t.asUser(u, async (tx) =>
    (await tx.query<{ m: MarkJson }>(`select public.mark_landmark($1, $2, $3, $4) m`, [collection, at.lat, at.lng, accuracy])).rows[0]!.m,
  )

beforeAll(async () => {
  t = await createTestDb()
})

describe('landmark collections', () => {
  it('requires a signed-in player', async () => {
    await expect(t.asUser(null, (tx) => tx.query(`select public.landmark_collections()`))).rejects.toThrow(/permission denied|not_authenticated/)
  })

  it('lists the four collections of the mockup, nothing marked yet', async () => {
    const c = await list(await player())
    expect(c.map((x) => [x.id, x.items.length])).toEqual([
      ['skyscrapers', 7],
      ['old_trees', 7],
      ['monuments', 6],
      ['metro', 5],
    ])
    expect(c.flatMap((x) => x.items).some((i) => i.marked)).toBe(false)
  })

  it('marks the place the player stands at, only in the asked collection and only once', async () => {
    const u = await player()
    expect((await mark(u, 'monuments', MAYAKOVSKY)).marked?.id).toBe('mayakovsky')
    const c = await list(u)
    expect(c.find((x) => x.id === 'monuments')!.items.filter((i) => i.marked).map((i) => i.id)).toEqual(['mayakovsky'])
    expect(c.find((x) => x.id === 'metro')!.items.some((i) => i.marked)).toBe(false)
    // the monument is marked: the next nearest monument is far away
    const again = await mark(u, 'monuments', MAYAKOVSKY)
    expect(again.marked).toBeNull()
    expect(again.nearest!.distance_m).toBeGreaterThan(500)
    // another player is not affected
    expect((await list(await player())).flatMap((x) => x.items).some((i) => i.marked)).toBe(false)
  })

  it('reports the nearest place and its distance when nothing is in reach', async () => {
    const r = await mark(await player(), 'skyscrapers', MAYAKOVSKY)
    expect(r.marked).toBeNull()
    expect(r.nearest!.name).toBe('Высотка на Кудринской площади')
    expect(r.nearest!.distance_m).toBeGreaterThan(1000)
  })

  it('rejects an invalid position or an unknown collection', async () => {
    const u = await player()
    await expect(mark(u, 'monuments', { lat: 95, lng: 37 })).rejects.toThrow(/invalid_location/)
    await expect(mark(u, 'monuments', MAYAKOVSKY, 0)).rejects.toThrow(/invalid_location/)
    await expect(mark(u, 'castles', MAYAKOVSKY)).rejects.toThrow(/collection_not_found/)
  })

  it('players cannot read or write the tables directly', async () => {
    const u = await player()
    const rows = await t.asUser(u, async (tx) => (await tx.query(`select * from public.landmarks`)).rows)
    expect(rows).toHaveLength(0)
    await expect(
      t.asUser(u, (tx) => tx.query(`insert into public.player_landmarks (user_id, landmark_id) values ($1, 'mumu')`, [u])),
    ).rejects.toThrow(/row-level security|permission denied/)
  })
})
