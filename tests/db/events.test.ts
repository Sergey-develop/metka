import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, SEED, type TestDb } from './harness'

// Migration 018: player events — create_event, join_event, leave_event, events_feed, event_page.

interface EventJson {
  id: string
  kind: string
  title: string
  description: string | null
  lat: number
  lng: number
  placeName: string | null
  startsAt: string
  maxParticipants: number
  coverPath: string | null
  participants: number
  joined: boolean
  organizer: { userId: string; username: string }
  faces: { userId: string }[]
}

let t: TestDb
// inside the seed ЦАО
const AT = { lat: SEED.bolshoi.lat, lng: SEED.bolshoi.lng }
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

async function player(): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, `e${id.slice(0, 8)}`)
  return id
}

interface Draft {
  kind?: string
  title?: string
  description?: string | null
  lat?: number
  lng?: number
  startsAt?: string
  max?: number
  cover?: string | null
}
function create(u: string, d: Draft = {}): Promise<string> {
  return t.asUser(u, async (tx) => {
    const r = await tx.query<{ id: string }>(`select public.create_event($1, $2, $3, $4, $5, $6, $7, $8) as id`, [
      d.kind ?? 'run',
      d.title ?? 'Утренняя пробежка',
      d.description === undefined ? 'Бежим вместе' : d.description,
      d.lat ?? AT.lat,
      d.lng ?? AT.lng,
      d.startsAt ?? inHours(24),
      d.max ?? 10,
      d.cover ?? null,
    ])
    return r.rows[0]!.id
  })
}
const page = (u: string, id: string) =>
  t.asUser(u, async (tx) => (await tx.query<{ p: EventJson }>(`select public.event_page($1) p`, [id])).rows[0]!.p)
const feed = (u: string) => t.asUser(u, async (tx) => (await tx.query<{ f: EventJson[] }>(`select public.events_feed() f`)).rows[0]!.f)
const join = (u: string, id: string) => t.asUser(u, (tx) => tx.query(`select public.join_event($1)`, [id]))
const leave = (u: string, id: string) => t.asUser(u, (tx) => tx.query(`select public.leave_event($1)`, [id]))

beforeAll(async () => {
  t = await createTestDb({ seed: true })
})

describe('create_event', () => {
  it('requires a signed-in player', async () => {
    await expect(t.asUser(null, (tx) => tx.query(`select public.events_feed()`))).rejects.toThrow(/permission denied|not_authenticated/)
  })

  it('creates an event, signs the creator up and derives the place from the nearest address', async () => {
    await t.db.query(
      `insert into public.osm_buildings (osm_type, osm_id, centroid, address, tags)
       values ('node', 990000001, extensions.st_setsrid(extensions.st_makepoint($1, $2), 4326), 'Театральная площадь, 1', '{}')`,
      [AT.lng + 0.0003, AT.lat],
    )
    const u = await player()
    const id = await create(u, { title: '  Пробежка у театра  ' })
    const e = await page(u, id)
    expect(e).toMatchObject({ kind: 'run', title: 'Пробежка у театра', participants: 1, joined: true, maxParticipants: 10 })
    expect(e.placeName).toBe('Театральная площадь, 1')
    expect(e.organizer.userId).toBe(u)
    expect(e.lat).toBeCloseTo(AT.lat, 6)
  })

  it('rejects invalid input', async () => {
    const u = await player()
    await expect(create(u, { kind: 'party' })).rejects.toThrow(/invalid_event/)
    await expect(create(u, { title: 'ab' })).rejects.toThrow(/invalid_event/)
    await expect(create(u, { description: 'x'.repeat(501) })).rejects.toThrow(/invalid_event/)
    await expect(create(u, { max: 1 })).rejects.toThrow(/invalid_event/)
    await expect(create(u, { max: 101 })).rejects.toThrow(/invalid_event/)
    await expect(create(u, { startsAt: inHours(0.1) })).rejects.toThrow(/invalid_event/) // 6 minutes ahead
    await expect(create(u, { startsAt: inHours(24 * 91) })).rejects.toThrow(/invalid_event/)
    // outside every game area (Saint Petersburg)
    await expect(create(u, { lat: 59.93, lng: 30.31 })).rejects.toThrow(/invalid_location/)
  })

  it('an event can be made in Zavidovo too (migration 035), not only in a Moscow okrug', async () => {
    const u = await player()
    const id = await create(u, { lat: 56.5937, lng: 36.5187 }) // the main bay
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('accepts only the creator’s own uploaded cover', async () => {
    const u = await player()
    const other = await player()
    const own = `${u}/${randomUUID()}.webp`
    const foreign = `${other}/${randomUUID()}.webp`
    await t.db.query(`insert into storage.objects (bucket_id, name) values ('event-covers', $1), ('event-covers', $2)`, [own, foreign])
    await expect(create(u, { cover: foreign })).rejects.toThrow(/invalid_photo/)
    await expect(create(u, { cover: `${u}/${randomUUID()}.webp` })).rejects.toThrow(/invalid_photo/) // not uploaded
    const id = await create(u, { cover: own })
    expect((await page(u, id)).coverPath).toBe(own)
  })

  it('limits a player to 5 upcoming events', async () => {
    const u = await player()
    for (let i = 0; i < 5; i++) await create(u)
    await expect(create(u)).rejects.toThrow(/too_many_events/)
  })

  it('clients cannot write the tables directly', async () => {
    const u = await player()
    await expect(
      t.asUser(u, (tx) =>
        tx.query(
          `insert into public.events (creator_id, kind, title, location, starts_at, max_participants)
           values ($1, 'run', 'Взлом', extensions.st_makepoint(37.6, 55.75)::extensions.geography, now() + interval '1 day', 5)`,
          [u],
        ),
      ),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('join_event / leave_event', () => {
  it('signs up once, respects the limit and lets participants leave', async () => {
    const owner = await player()
    const a = await player()
    const b = await player()
    const id = await create(owner, { max: 2 })

    await join(a, id)
    await join(a, id) // idempotent
    expect((await page(a, id)).participants).toBe(2)
    await expect(join(b, id)).rejects.toThrow(/event_full/)

    await leave(a, id)
    expect((await page(a, id)).joined).toBe(false)
    await join(b, id)
    expect((await page(owner, id)).faces.map((f) => f.userId)).toEqual([owner, b])
  })

  it('the creator cannot leave; nobody joins or leaves after the start', async () => {
    const owner = await player()
    const a = await player()
    const id = await create(owner)
    await join(a, id)
    await expect(leave(owner, id)).rejects.toThrow(/event_creator/)

    await t.db.query(`update public.events set starts_at = now() - interval '1 minute' where id = $1`, [id])
    await expect(join(await player(), id)).rejects.toThrow(/event_started/)
    await expect(leave(a, id)).rejects.toThrow(/event_started/)
  })

  it('unknown event', async () => {
    await expect(join(await player(), randomUUID())).rejects.toThrow(/event_not_found/)
  })
})

describe('events_feed', () => {
  it('lists upcoming and running events by start time, hides those that ended', async () => {
    const owner = await player()
    const later = await create(owner, { startsAt: inHours(48) })
    const sooner = await create(owner, { startsAt: inHours(2) })
    const running = await create(owner)
    const old = await create(owner)
    await t.db.query(`update public.events set starts_at = now() - interval '1 hour' where id = $1`, [running])
    await t.db.query(`update public.events set starts_at = now() - interval '4 hours' where id = $1`, [old])

    const ids = (await feed(owner)).map((e) => e.id)
    expect(ids).not.toContain(old)
    const mine = ids.filter((id) => [later, sooner, running].includes(id))
    expect(mine).toEqual([running, sooner, later])
  })
})
