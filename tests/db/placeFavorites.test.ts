import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 041: hearts on the Zavidovo place cards, before any visit; each player sees only their own.

let t: TestDb
async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `p${id.slice(0, 8)}`)
  return id
}
const mine = (u: string) =>
  t.asUser(u, async (tx) => (await tx.query<{ place_id: string }>(`select place_id from public.place_favorites order by place_id`)).rows.map((r) => r.place_id))

beforeAll(async () => {
  t = await createTestDb()
})

describe('place favorites', () => {
  it('a player hearts a place not visited yet, sees only their own hearts and removes one', async () => {
    const a = await player()
    const b = await player()
    await t.asUser(a, (tx) => tx.query(`insert into public.place_favorites (place_id) values ('zav-tsarevna')`))
    await t.asUser(b, (tx) => tx.query(`insert into public.place_favorites (place_id) values ('zav-forest-voices')`).catch(() => null))
    expect(await mine(a)).toEqual(['zav-tsarevna'])
    expect(await mine(b)).not.toContain('zav-tsarevna')

    // another player's heart can be neither added nor removed
    await expect(t.asUser(b, (tx) => tx.query(`insert into public.place_favorites (user_id, place_id) values ($1, 'zav-tsarevna')`, [a]))).rejects.toThrow()
    await t.asUser(b, (tx) => tx.query(`delete from public.place_favorites where place_id = 'zav-tsarevna'`))
    expect(await mine(a)).toEqual(['zav-tsarevna'])

    await t.asUser(a, (tx) => tx.query(`delete from public.place_favorites where place_id = 'zav-tsarevna'`))
    expect(await mine(a)).toEqual([])
  })
})
