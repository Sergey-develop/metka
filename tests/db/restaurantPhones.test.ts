import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 034: the phones the restaurant pages call for «Забронировать».

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})

describe('restaurant phones', () => {
  it('the restaurants have the phones found in public sources; the gastrobar has none', async () => {
    const rows = await t.db.query<{ id: string; phone: string | null; website: string | null }>(
      `select id, phone, website from public.area_places
        where id in ('zav-tsarevna', 'zav-syrzavod', 'zav-barhan', 'zav-traktir', 'zav-zhukovka', 'zav-gastrobar')
        order by id`,
    )
    expect(Object.fromEntries(rows.rows.map((r) => [r.id, r.phone]))).toEqual({
      'zav-barhan': '+7 916 335-07-76',
      'zav-gastrobar': null,
      'zav-syrzavod': '+7 958 118-77-88',
      'zav-traktir': '+7 920 680-45-80',
      'zav-tsarevna': '+7 495 191-25-25',
      'zav-zhukovka': '+7 499 226-22-59',
    })
    // the old site of «Трактиръ» no longer exists
    expect(rows.rows.find((r) => r.id === 'zav-traktir')!.website).toBe('https://yamskaya.zavidovo.com/restaurants/')
  })

  it('migration 036: approximate places have a check-in radius of at least 150 m; precise ones keep theirs', async () => {
    const r = await t.db.query<{ id: string; radius_m: number }>(
      `select id, radius_m from public.area_places where id in ('zav-bridge', 'zav-beach') order by id`,
    )
    expect(Object.fromEntries(r.rows.map((x) => [x.id, x.radius_m]))).toEqual({ 'zav-beach': 120, 'zav-bridge': 150 })
    const small = await t.db.query(`select id from public.area_places where needs_check and is_active and radius_m < 150`)
    expect(small.rows).toEqual([])
  })

  it('migration 037: the forest route’s artifact «Голос леса» is in the collection «Голоса леса»', async () => {
    const r = await t.db.query<{ collection_id: string; title: string }>(
      `select a.collection_id, c.title from public.artifacts a join public.artifact_collections c on c.id = a.collection_id where a.id = 'forest-voice'`,
    )
    expect(r.rows[0]).toEqual({ collection_id: 'zav-forest-voices', title: 'Голоса леса' })
  })
})
