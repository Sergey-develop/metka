import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

let t: TestDb
const CONTENT = readFileSync(join(import.meta.dirname, '../../supabase/content/buildings_content.sql'), 'utf8').replaceAll(
  'YOUR-PROJECT',
  'test-project',
)

beforeAll(async () => {
  t = await createTestDb({ seed: true })
}, 120_000)

describe('building photos and catalog content (migration 016, supabase/content)', () => {
  it('creates a public photo bucket that players cannot upload to', async () => {
    const bucket = await t.db.query<{ public: boolean }>(`select public from storage.buckets where id = 'building-photos'`)
    expect(bucket.rows[0]?.public).toBe(true)

    const u = randomUUID()
    await t.createUser(u)
    await expect(
      t.asUser(u, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner) values ('building-photos', 'x.webp', $1)`, [u])),
    ).rejects.toThrow()
  })

  it('fills description, address and photo of the seed landmarks; players see them', async () => {
    await t.db.exec(CONTENT)
    await t.db.exec(CONTENT) // re-running changes nothing

    const u = randomUUID()
    await t.createUser(u)
    const rows = await t.asUser(u, (tx) =>
      tx.query<{ name: string; address: string | null; description: string | null; image_url: string | null }>(
        `select name, address, description, image_url from public.buildings_in_bbox(37.33, 55.56, 37.9, 55.92) order by name`,
      ),
    )
    expect(rows.rows).toHaveLength(10)
    for (const r of rows.rows) {
      expect(r.address).toBeTruthy()
      expect(r.description!.length).toBeGreaterThan(80)
      expect(r.image_url).toMatch(/^https:\/\/test-project\.supabase\.co\/storage\/v1\/object\/public\/building-photos\/[a-z-]+\.webp$/)
    }
    const bolshoi = rows.rows.find((r) => r.name === 'Большой театр')!
    expect(bolshoi.address).toBe('Театральная площадь, 1')
  })
})
