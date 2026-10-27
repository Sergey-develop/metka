import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 032: in Moscow only the Varshavskaya quarter stays; the rest is hidden, nothing is deleted.

let t: TestDb

beforeAll(async () => {
  // the 10 dev-seed landmarks of the centre come from seed.sql
  t = await createTestDb({ seed: true, stopBefore: '20261027000032' })
  await t.db.exec(`
    insert into public.buildings (slug, name, location, publish_status) values
      ('osm-w32611573', 'Театр «Шалом»', 'SRID=4326;POINT(37.6205 55.6535)', 'published'),
      ('osm-w1', 'Склад у Варшавки', 'SRID=4326;POINT(37.6100 55.6600)', 'unavailable'),
      ('osm-w2', 'Дом в Бутово', 'SRID=4326;POINT(37.5500 55.5600)', 'published'),
      ('osm-w3', 'Radisson', 'SRID=4326;POINT(36.51914 56.59509)', 'published');
  `)
  await t.applyRemainingMigrations()
})

describe('moscow only varshavskaya', () => {
  it('hides the centre landmarks and the rest of Moscow, keeps the quarter and Zavidovo', async () => {
    const rows = await t.db.query<{ slug: string; status: string }>(
      `select slug, publish_status status from public.buildings order by slug`,
    )
    const status = Object.fromEntries(rows.rows.map((r) => [r.slug, r.status]))
    expect(status['bolshoi-theatre']).toBe('hidden')
    expect(status['msu-main']).toBe('hidden')
    expect(rows.rows.filter((r) => r.slug.indexOf('osm-') !== 0).every((r) => r.status === 'hidden')).toBe(true)
    expect(status['osm-w2']).toBe('hidden')
    expect(status['osm-w32611573']).toBe('published')
    expect(status['osm-w1']).toBe('unavailable')
    expect(status['osm-w3']).toBe('published')
    // hidden, not deleted
    expect(rows.rows).toHaveLength(14)
  })
})
