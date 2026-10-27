import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 033: achievements for finished quest routes and collected artifacts.

let t: TestDb
let before: string

const progress = async (userId: string) =>
  Object.fromEntries(
    (
      await t.db.query<{ slug: string; progress: number; done: boolean }>(
        `select q.slug, pq.progress, pq.completed_at is not null done
           from public.player_quests pq join public.quests q on q.id = pq.quest_id
          where pq.user_id = $1 and q.kind in ('route_count', 'artifact_count')`,
        [userId],
      )
    ).rows.map((r) => [r.slug, { progress: r.progress, done: r.done }]),
  )
const finishRoute = (userId: string, slug: string) =>
  t.db.query(`insert into public.player_routes (user_id, route_id) select $1, id from public.quest_routes where slug = $2`, [userId, slug])
const earn = (userId: string, ...ids: string[]) =>
  t.db.query(`insert into public.player_artifacts (user_id, artifact_id) select $1, unnest($2::text[])`, [userId, ids])

beforeAll(async () => {
  t = await createTestDb({ stopBefore: '20261028000033' })
  // a player who had finished «Поймай волну» and collected 3 artifacts before the migration
  before = randomUUID()
  await t.createUser(before, `b${before.slice(0, 8)}`)
  await finishRoute(before, 'zav-catch-wave')
  await earn(before, 'first-discovery', 'golden-horizon', 'blue-wave')
  await t.applyRemainingMigrations()
})

describe('route and artifact achievements', () => {
  it('what was done before the migration counts', async () => {
    expect(await progress(before)).toEqual({
      'zav-first-route': { progress: 1, done: true },
      'zav-two-routes': { progress: 1, done: false },
      'zav-collector': { progress: 3, done: false },
    })
  })

  it('finishing a route and earning artifacts moves them; a completed one is kept', async () => {
    await finishRoute(before, 'zav-forest')
    await earn(before, 'panorama', 'reflection')
    expect(await progress(before)).toEqual({
      'zav-first-route': { progress: 1, done: true },
      'zav-two-routes': { progress: 2, done: true },
      'zav-collector': { progress: 5, done: true },
    })
  })

  it('a new player starts with nothing until the first route', async () => {
    const u = randomUUID()
    await t.createUser(u, `n${u.slice(0, 8)}`)
    expect(await progress(u)).toEqual({})
    await finishRoute(u, 'zav-catch-wave')
    expect((await progress(u))['zav-first-route']).toEqual({ progress: 1, done: true })
  })
})
