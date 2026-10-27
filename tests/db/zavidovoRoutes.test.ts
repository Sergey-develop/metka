import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 026: Zavidovo places, quest routes and artifacts — area_quests, complete_route_step.

interface Step {
  id: string
  ord: number
  kind: 'checkin' | 'photo' | 'question'
  options: string[] | null
  place: { id: string; lat: number | null; lng: number | null; radiusM: number } | null
  doneAt: string | null
}
interface Route {
  id: string
  slug: string
  rewardXp: number
  rewardCoins: number
  completedAt: string | null
  steps: Step[]
}
interface Quests {
  routes: Route[]
  places: { id: string; zone: string; lat: number | null }[]
  collections: { id: string; items: { id: string; earnedAt: string | null }[] }[]
}
interface StepResult {
  status: 'done' | 'already_done' | 'too_far' | 'wrong_answer'
  distanceM?: number
  reward?: { xp: number; coins: number }
  artifacts?: { id: string; title: string }[]
  routeCompleted?: boolean
  profile?: { xp: number; coins: number; level: number }
}

let t: TestDb

async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `z${id.slice(0, 8)}`)
  return id
}
const quests = (u: string) =>
  t.asUser(u, async (tx) => (await tx.query<{ q: Quests }>(`select public.area_quests('zavidovo') q`)).rows[0]!.q)
const complete = (u: string, stepId: string, at: { lat: number; lng: number } | null, answer: number | null = null, accuracy = 10) =>
  t.asUser(u, async (tx) =>
    (
      await tx.query<{ r: StepResult }>(`select public.complete_route_step($1, $2, $3, $4, $5) r`, [
        stepId,
        at?.lat ?? null,
        at?.lng ?? null,
        at ? accuracy : null,
        answer,
      ])
    ).rows[0]!.r,
  )
const at = (s: Step) => ({ lat: s.place!.lat!, lng: s.place!.lng! })
const route = async (u: string, slug: string) => (await quests(u)).routes.find((r) => r.slug === slug)!

beforeAll(async () => {
  // the routes as migration 026 made them; 027 trims Zavidovo to the core zone (zavidovoCoreZone.test.ts)
  t = await createTestDb({ stopBefore: '20261027000027' })
})

describe('zavidovo routes', () => {
  it('requires a signed-in player', async () => {
    await expect(t.asUser(null, (tx) => tx.query(`select public.area_quests('zavidovo')`))).rejects.toThrow(/permission denied|not_authenticated/)
  })

  it('lists three routes, the places of all four zones and four artifact collections', async () => {
    const q = await quests(await player())
    expect(q.routes.map((r) => [r.slug, r.steps.length])).toEqual([
      ['zav-catch-wave', 5],
      ['zav-forest', 4],
      ['zav-tsar-road', 6],
    ])
    expect(new Set(q.places.map((p) => p.zone))).toEqual(new Set(['bay', 'forest', 'village', 'resort']))
    expect(q.collections.map((c) => c.id)).toEqual(['zav-elements', 'zav-two-capitals', 'zav-postcards', 'zav-trophies'])
    // every place a step needs has a point, so every route can be finished
    expect(q.routes.flatMap((r) => r.steps).every((s) => s.place === null || s.place.lat !== null)).toBe(true)
    // the old village is inside the game area now
    const v = await t.db.query<{ v: boolean }>(`select public.in_game_area(56.5297, 36.5303) v`)
    expect(v.rows[0]!.v).toBe(true)
  })

  it('checks in only next to the place, once, with XP and the step artifact', async () => {
    const u = await player()
    const step = (await route(u, 'zav-catch-wave')).steps[0]!
    const far = await complete(u, step.id, { lat: 56.5297, lng: 36.5303 })
    expect(far.status).toBe('too_far')
    expect(far.distanceM).toBeGreaterThan(5000)

    const done = await complete(u, step.id, at(step))
    expect(done.status).toBe('done')
    expect(done.reward).toEqual({ xp: 30, coins: 0 })
    expect(done.artifacts!.map((a) => a.id)).toEqual(['first-discovery'])
    expect(done.profile!.xp).toBe(30)
    expect((await complete(u, step.id, at(step))).status).toBe('already_done')
    expect((await route(u, 'zav-catch-wave')).steps[0]!.doneAt).not.toBeNull()
    // another player is not affected
    expect((await route(await player(), 'zav-catch-wave')).steps[0]!.doneAt).toBeNull()
  })

  it('counts GPS error up to 50 m but not more', async () => {
    const u = await player()
    const step = (await route(u, 'zav-catch-wave')).steps[0]! // bay, radius 150
    const north = (m: number) => ({ lat: step.place!.lat! + m / 111_320, lng: step.place!.lng! })
    expect((await complete(u, step.id, north(190), null, 30)).status).toBe('too_far')
    expect((await complete(u, step.id, north(210), null, 500)).status).toBe('too_far')
    expect((await complete(u, step.id, north(190), null, 45)).status).toBe('done')
  })

  it('checks a quiz answer, and an opinion question takes any answer', async () => {
    const u = await player()
    const road = await route(u, 'zav-tsar-road')
    const quiz = road.steps.find((s) => s.kind === 'question')!
    expect(quiz.place).toBeNull()
    expect((await complete(u, quiz.id, null, 1)).status).toBe('wrong_answer')
    await expect(complete(u, quiz.id, null, 7)).rejects.toThrow(/invalid_answer/)
    const right = await complete(u, quiz.id, null, 0)
    expect(right.status).toBe('done')
    expect(right.artifacts!.map((a) => a.id)).toEqual(['road-sign'])

    const opinion = (await route(u, 'zav-catch-wave')).steps.find((s) => s.kind === 'question')!
    expect((await complete(u, opinion.id, at(opinion), 3)).status).toBe('done')
    // a question at a place still needs the player there
    const forest = (await route(u, 'zav-forest')).steps.find((s) => s.kind === 'question')!
    expect((await complete(u, forest.id, at(opinion), 0)).status).toBe('too_far')
    await expect(complete(u, forest.id, null, 0)).rejects.toThrow(/invalid_location/)
  })

  it('the last step finishes the route once, with its reward, artifact and the explorer artifacts', async () => {
    const u = await player()
    const wave = await route(u, 'zav-catch-wave')
    let last: StepResult | null = null
    const earned: string[] = []
    // any order: from the yacht club back to the bay
    for (const s of [...wave.steps].reverse()) {
      last = await complete(u, s.id, at(s), s.kind === 'question' ? 0 : null)
      expect(last.status).toBe('done')
      earned.push(...last.artifacts!.map((a) => a.id))
      if (s !== wave.steps[0]) expect(last.routeCompleted).toBe(false)
    }
    expect(last!.routeCompleted).toBe(true)
    const stepsXp = 30 + 20 + 30 + 20 + 30
    expect(last!.reward).toEqual({ xp: 30 + wave.rewardXp, coins: wave.rewardCoins })
    expect(last!.profile).toMatchObject({ xp: stepsXp + wave.rewardXp, coins: wave.rewardCoins })
    expect(earned.sort()).toEqual(
      ['blue-wave', 'explorer-trace', 'first-discovery', 'golden-horizon', 'panorama', 'pioneer-map', 'quiet-shore', 'reflection'].sort(),
    )
    const q = await quests(u)
    expect(q.routes.find((r) => r.slug === 'zav-catch-wave')!.completedAt).not.toBeNull()
    const items = q.collections.flatMap((c) => c.items)
    expect(items.filter((i) => i.earnedAt).map((i) => i.id).sort()).toEqual(earned.sort())

    const ledger = await t.db.query<{ n: number }>(
      `select count(*)::int n from public.reward_ledger where user_id = $1 and source_type in ('route', 'route_step')`,
      [u],
    )
    expect(ledger.rows[0]!.n).toBe(wave.steps.length + 1)
  })

  it('rejects an unknown step and a bad position', async () => {
    const u = await player()
    await expect(complete(u, randomUUID(), { lat: 56.59, lng: 36.52 })).rejects.toThrow(/step_not_found/)
    const step = (await route(u, 'zav-catch-wave')).steps[0]!
    await expect(complete(u, step.id, { lat: 95, lng: 36.5 })).rejects.toThrow(/invalid_location/)
    await expect(complete(u, step.id, at(step), null, 0)).rejects.toThrow(/invalid_location/)
  })

  it('keeps the tables closed to clients', async () => {
    const u = await player()
    await expect(t.asUser(u, (tx) => tx.query(`select * from public.route_steps`))).rejects.toThrow(/permission denied/)
    await expect(t.asUser(u, (tx) => tx.query(`insert into public.player_artifacts values ($1, 'blue-wave', now())`, [u]))).rejects.toThrow(
      /permission denied/,
    )
  })
})
