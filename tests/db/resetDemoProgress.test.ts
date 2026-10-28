import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// supabase/content/reset_demo_progress.sql: the demo account walks the quest again from the start;
// nobody else is touched.

let t: TestDb
const script = (email: string) =>
  readFileSync(join(__dirname, '../../supabase/content/reset_demo_progress.sql'), 'utf8').replace("'demo@example.com'", `'${email}'`)

async function walkedQuest(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `u${id.slice(0, 8)}`)
  await t.db.query(`insert into public.player_route_steps (user_id, step_id)
                    select $1, s.id from public.route_steps s join public.quest_routes r on r.id = s.route_id
                     where r.slug = 'zav-catch-wave'`, [id])
  await t.db.query(`insert into public.player_routes (user_id, route_id) select $1, id from public.quest_routes where slug = 'zav-catch-wave'`, [id])
  await t.db.query(`insert into public.player_artifacts (user_id, artifact_id) values ($1, 'blue-wave'), ($1, 'first-discovery')`, [id])
  await t.db.query(`insert into public.reward_ledger (user_id, source_type, source_id, xp, coins)
                    select $1, 'route', id, 50, 100 from public.quest_routes where slug = 'zav-catch-wave'`, [id])
  return id
}
const count = async (table: string, userId: string) =>
  (await t.db.query<{ n: number }>(`select count(*)::int n from public.${table} where user_id = $1`, [userId])).rows[0]!.n

beforeAll(async () => {
  t = await createTestDb()
})

describe('reset demo progress', () => {
  it('clears the demo account’s quest progress, rewards and route achievements; others keep theirs', async () => {
    const demo = await walkedQuest()
    const other = await walkedQuest()
    expect(await count('player_quests', demo)).toBeGreaterThan(0) // «Первый маршрут» by trigger (migration 033)
    await t.db.exec(script(`${demo}@test.local`))
    for (const table of ['player_route_steps', 'player_routes', 'player_artifacts', 'reward_ledger', 'player_quests']) {
      expect(await count(table, demo), table).toBe(0)
      expect(await count(table, other), table).toBeGreaterThan(0)
    }
  })

  it('a wrong email changes nothing and says so', async () => {
    await expect(t.db.exec(script('nobody@test.local'))).rejects.toThrow(/no account with email/)
  })
})
