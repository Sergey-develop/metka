import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 028: standalone check-ins at Zavidovo places, «Голоса леса», partner visits.

interface CheckIn {
  status: 'done' | 'already_done' | 'too_far'
  distanceM?: number
  reward?: { xp: number; coins: number }
  artifacts?: { id: string }[]
  profile?: { xp: number; coins: number }
}
interface Quests {
  places: { id: string; lat: number; lng: number; rewardXp: number; rewardCoins: number; isPartner: boolean }[]
  visits: { placeId: string; visitedAt: string }[]
  collections: { id: string; items: { id: string; earnedAt: string | null }[] }[]
}

let t: TestDb
async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `p${id.slice(0, 8)}`)
  return id
}
const quests = (u: string) =>
  t.asUser(u, async (tx) => (await tx.query<{ q: Quests }>(`select public.area_quests('zavidovo') q`)).rows[0]!.q)
const checkIn = (u: string, placeId: string, at: { lat: number; lng: number }, accuracy = 10) =>
  t.asUser(u, async (tx) =>
    (await tx.query<{ r: CheckIn }>(`select public.check_in_place($1, $2, $3, $4) r`, [placeId, at.lat, at.lng, accuracy])).rows[0]!.r,
  )
const place = async (u: string, id: string) => (await quests(u)).places.find((p) => p.id === id)!

beforeAll(async () => {
  t = await createTestDb()
})

describe('place check-ins', () => {
  it('checks in only next to the place, once, with the reward and the forest sign', async () => {
    const u = await player()
    const bay = await place(u, 'zav-bay')
    expect(bay.rewardXp).toBe(10)
    const far = await checkIn(u, 'zav-bay', { lat: 56.5297, lng: 36.5303 })
    expect(far.status).toBe('too_far')

    const done = await checkIn(u, 'zav-bay', bay)
    expect(done.status).toBe('done')
    expect(done.reward).toEqual({ xp: 10, coins: 0 })
    expect(done.artifacts!.map((a) => a.id)).toEqual(['sign-bay'])
    expect(done.profile!.xp).toBe(10)
    expect((await checkIn(u, 'zav-bay', bay)).status).toBe('already_done')

    const q = await quests(u)
    expect(q.visits.map((v) => v.placeId)).toEqual(['zav-bay'])
    const voices = q.collections.find((c) => c.id === 'zav-forest-voices')!
    expect(voices.items.filter((i) => i.earnedAt).map((i) => i.id)).toEqual(['sign-bay'])
    expect((await quests(await player())).visits).toEqual([])
  })

  it('a partner gives coins too and counts as a confirmed visit', async () => {
    const u = await player()
    const cafe = await place(u, 'zav-syrzavod')
    expect(cafe).toMatchObject({ isPartner: true, rewardXp: 20, rewardCoins: 10 })
    expect((await checkIn(u, 'zav-syrzavod', cafe)).reward).toEqual({ xp: 20, coins: 10 })

    const admin = await player()
    await t.db.query(`insert into public.app_admins (user_id) values ($1)`, [admin])
    const visits = await t.asUser(admin, async (tx) =>
      (await tx.query<{ v: { placeId: string; visits: number }[] }>(`select public.partner_visits('zavidovo') v`)).rows[0]!.v,
    )
    expect(visits.find((v) => v.placeId === 'zav-syrzavod')!.visits).toBe(1)
    await expect(t.asUser(u, (tx) => tx.query(`select public.partner_visits('zavidovo')`))).rejects.toThrow(/forbidden/)
  })

  it('three different places — by check-ins and route steps together — give «След исследователя»', async () => {
    const u = await player()
    const step = await t.asUser(u, async (tx) =>
      (await tx.query<{ q: { routes: { slug: string; steps: { id: string; place: { lat: number; lng: number } | null }[] }[] } }>(
        `select public.area_quests('zavidovo') q`,
      )).rows[0]!.q.routes.find((r) => r.slug === 'zav-catch-wave')!.steps[0]!,
    )
    await t.asUser(u, (tx) => tx.query(`select public.complete_route_step($1, $2, $3, 10, null)`, [step.id, step.place!.lat, step.place!.lng]))
    const tennis = await place(u, 'zav-tennis')
    expect((await checkIn(u, 'zav-tennis', tennis)).artifacts).toEqual([])
    const beach = await place(u, 'zav-beach')
    expect((await checkIn(u, 'zav-beach', beach)).artifacts!.map((a) => a.id).sort()).toEqual(['explorer-trace', 'sign-shore'])
  })

  it('rejects an inactive or unknown place and a bad position', async () => {
    const u = await player()
    await expect(checkIn(u, 'zav-golf', { lat: 56.58272, lng: 36.55488 })).rejects.toThrow(/place_not_found/)
    await expect(checkIn(u, 'nope', { lat: 56.59, lng: 36.52 })).rejects.toThrow(/place_not_found/)
    await expect(checkIn(u, 'zav-bay', { lat: 95, lng: 36.5 })).rejects.toThrow(/invalid_location/)
  })
})
