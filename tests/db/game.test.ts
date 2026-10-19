import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { levelForXp } from '@/features/progression/levels'
import { createTestDb, mockEmbedding, SEED, type TestDb } from './harness'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb({ seed: true })
})

interface ScanResult {
  scanId: string
  status: 'accepted' | 'rejected' | 'already_discovered'
  reason: string | null
  duplicate: boolean
  reward: { xp: number; coins: number; influence: number } | null
  completedQuests: { slug: string }[]
  profile: { level: number; xp: number; coins: number; buildingsDiscovered: number }
  recognition: { targetScore: number | null; bestOtherScore: number | null }
}

interface ScanArgs {
  requestId?: string
  buildingId: string
  lat: number
  lng: number
  accuracy?: number
  model?: string
  embedding: number[]
  sha?: string | null
}

async function submit(userId: string, a: ScanArgs): Promise<ScanResult> {
  return t.asUser(userId, async (tx) => {
    const r = await tx.query<{ r: ScanResult }>(
      `select public.submit_building_scan($1, $2, $3, $4, $5, $6, $7::real[], $8, $9) as r`,
      [
        a.requestId ?? randomUUID(),
        a.buildingId,
        a.lat,
        a.lng,
        a.accuracy ?? 10,
        a.model ?? 'mock-dev-v1',
        a.embedding,
        a.sha ?? null,
        { blurScore: 120 },
      ],
    )
    return r.rows[0]!.r
  })
}

async function newUser(username?: string): Promise<string> {
  const id = randomUUID()
  await t.createUser(id, username)
  return id
}

const atGum = { buildingId: SEED.gum.id, lat: SEED.gum.lat, lng: SEED.gum.lng }
const gumEmbedding = mockEmbedding(SEED.gum.index)

describe('profiles', () => {
  it('creates a profile on sign-up with requested or fallback username', async () => {
    const a = await newUser('Метчик_01')
    const b = await newUser('Метчик_01') // taken -> fallback
    const c = await newUser('x') // invalid -> fallback
    const rows = await t.db.query<{ id: string; username: string; level: number; xp: number }>(
      `select id, username, level, xp from public.profiles where id = any($1::uuid[])`,
      [[a, b, c]],
    )
    const byId = new Map(rows.rows.map((r) => [r.id, r]))
    expect(byId.get(a)?.username).toBe('Метчик_01')
    expect(byId.get(b)?.username).toMatch(/^player_[0-9a-f]{10}$/)
    expect(byId.get(c)?.username).toMatch(/^player_/)
    expect(byId.get(a)).toMatchObject({ level: 1, xp: 0 })
  })

  it('completes profile setup once with a free nickname and a preset avatar', async () => {
    await newUser('Setup_owner')
    const b = await newUser()
    const setup = (u: string, name: string, avatar: string | null) =>
      t.asUser(u, (tx) => tx.query(`select public.complete_profile_setup($1, $2)`, [name, avatar]))

    await expect(setup(b, 'setup_OWNER', 'runner')).rejects.toThrow(/username_taken/)
    await expect(setup(b, 'x', 'runner')).rejects.toThrow(/invalid_profile/)
    await expect(setup(b, 'Велосипедист', 'unicorn')).rejects.toThrow(/invalid_profile/)
    await expect(setup(b, 'Велосипедист', null)).rejects.toThrow(/invalid_profile/)
    await expect(t.asUser(null, (tx) => tx.query(`select public.complete_profile_setup('Anon_1', 'runner')`))).rejects.toThrow()

    await setup(b, '  Велосипедист ', 'cyclist')
    const first = await t.db.query<{ username: string; avatar_key: string; setup_completed_at: Date | null }>(
      `select username, avatar_key, setup_completed_at from public.profiles where id = $1`,
      [b],
    )
    expect(first.rows[0]).toMatchObject({ username: 'Велосипедист', avatar_key: 'cyclist' })
    expect(first.rows[0]?.setup_completed_at).not.toBeNull()

    // completion time is set by the function only, never by a direct update
    await expect(
      t.asUser(b, (tx) => tx.query(`update public.profiles set setup_completed_at = null where id = $1`, [b])),
    ).rejects.toThrow(/permission denied/)
    await t.asUser(b, (tx) => tx.query(`update public.profiles set avatar_key = 'skater' where id = $1`, [b]))
    await expect(
      t.asUser(b, (tx) => tx.query(`update public.profiles set avatar_key = 'unicorn' where id = $1`, [b])),
    ).rejects.toThrow(/check constraint/)
  })
})

describe('RLS and privileges', () => {
  it('lets a user edit cosmetic profile fields only', async () => {
    const u = await newUser()
    await t.asUser(u, (tx) => tx.query(`update public.profiles set username = 'Renamed_${u.slice(0, 4)}' where id = $1`, [u]))
    await expect(
      t.asUser(u, (tx) => tx.query(`update public.profiles set xp = 999999 where id = $1`, [u])),
    ).rejects.toThrow(/permission denied/)
    await expect(
      t.asUser(u, (tx) => tx.query(`update public.profiles set coins = 999999, level = 50 where id = $1`, [u])),
    ).rejects.toThrow(/permission denied/)
    const p = await t.db.query<{ xp: number; username: string }>(`select xp, username from public.profiles where id = $1`, [u])
    expect(p.rows[0]).toMatchObject({ xp: 0, username: `Renamed_${u.slice(0, 4)}` })
  })

  it("cannot update another player's profile", async () => {
    const a = await newUser()
    const b = await newUser()
    const r = await t.asUser(a, (tx) => tx.query(`update public.profiles set username = 'hijacked' where id = $1`, [b]))
    expect(r.affectedRows).toBe(0)
  })

  it('blocks direct writes to game state tables', async () => {
    const u = await newUser()
    await expect(
      t.asUser(u, (tx) =>
        tx.query(`insert into public.reward_ledger (user_id, source_type, source_id, xp) values ($1, 'quest', $2, 1000)`, [
          u,
          SEED.questFirst,
        ]),
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(
      t.asUser(u, (tx) =>
        tx.query(`insert into public.player_influence (user_id, district_id, points) values ($1, $2, 1000)`, [u, SEED.districtCao]),
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(
      t.asUser(u, (tx) => tx.query(`update public.buildings set reward_xp = 10000`)),
    ).rejects.toThrow(/permission denied/)
    await expect(
      t.asUser(u, (tx) => tx.query(`insert into public.clan_members (clan_id, user_id) values ($1, $2)`, [randomUUID(), u])),
    ).rejects.toThrow(/permission denied/)
  })

  it('hides reference embeddings and recognition config from clients', async () => {
    const u = await newUser()
    await expect(
      t.asUser(u, (tx) => tx.query(`select * from public.building_reference_embeddings`)),
    ).rejects.toThrow(/permission denied/)
    await expect(t.asUser(u, (tx) => tx.query(`select * from public.recognition_models`))).rejects.toThrow(
      /permission denied/,
    )
  })

  it('denies internal functions and all access for anon', async () => {
    const u = await newUser()
    await expect(
      t.asUser(u, (tx) =>
        tx.query(`select public._advance_quests($1, b) from public.buildings b limit 1`, [u]),
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(t.asUser(null, (tx) => tx.query(`select * from public.buildings`))).rejects.toThrow(/permission denied/)
    await expect(
      t.asUser(null, (tx) =>
        tx.query(`select public.submit_building_scan($1, $2, 55.75, 37.62, 10, 'mock-dev-v1', '{1}'::real[])`, [
          randomUUID(),
          SEED.gum.id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it("does not expose other players' scans or collection", async () => {
    const a = await newUser()
    const b = await newUser()
    await submit(a, { ...atGum, embedding: gumEmbedding })
    const scans = await t.asUser(b, (tx) => tx.query(`select * from public.building_scans where user_id = $1`, [a]))
    const coll = await t.asUser(b, (tx) => tx.query(`select * from public.player_buildings where user_id = $1`, [a]))
    expect(scans.rows).toHaveLength(0)
    expect(coll.rows).toHaveLength(0)
  })
})

describe('submit_building_scan', () => {
  it('accepts a valid scan and grants rewards, influence and quest progress once', async () => {
    const u = await newUser()
    const r = await submit(u, { ...atGum, embedding: gumEmbedding })
    expect(r.status).toBe('accepted')
    expect(r.reason).toBeNull()
    expect(r.reward).toEqual({ xp: 120, coins: 30, influence: 25 })
    expect(r.profile).toMatchObject({ xp: 120, coins: 30, buildingsDiscovered: 1, level: levelForXp(120) })
    expect(r.completedQuests.map((q) => q.slug)).toContain('first-mark')

    const inf = await t.db.query<{ points: number }>(
      `select points from public.player_influence where user_id = $1 and district_id = $2`,
      [u, SEED.districtCao],
    )
    expect(inf.rows[0]?.points).toBe(25)
  })

  it('is idempotent for a repeated request id', async () => {
    const u = await newUser()
    const requestId = randomUUID()
    const first = await submit(u, { ...atGum, requestId, embedding: gumEmbedding })
    const second = await submit(u, { ...atGum, requestId, embedding: gumEmbedding })
    expect(first.status).toBe('accepted')
    expect(second.duplicate).toBe(true)
    expect(second.scanId).toBe(first.scanId)
    const ledger = await t.db.query(`select 1 from public.reward_ledger where user_id = $1`, [u])
    expect(ledger.rows).toHaveLength(1)
  })

  it('does not reward an already discovered building again', async () => {
    const u = await newUser()
    await submit(u, { ...atGum, embedding: gumEmbedding })
    const again = await submit(u, { ...atGum, embedding: gumEmbedding })
    expect(again.status).toBe('already_discovered')
    expect(again.reward).toBeNull()
    expect(again.profile.xp).toBe(120)
  })

  it('rejects when the player is too far', async () => {
    const u = await newUser()
    const r = await submit(u, { ...atGum, lat: SEED.gum.lat + 0.01, embedding: gumEmbedding })
    expect(r).toMatchObject({ status: 'rejected', reason: 'too_far', reward: null })
  })

  it('rejects inaccurate location fixes', async () => {
    const u = await newUser()
    const r = await submit(u, { ...atGum, accuracy: 250, embedding: gumEmbedding })
    expect(r.reason).toBe('location_inaccurate')
  })

  it('rejects unknown buildings and inactive models', async () => {
    const u = await newUser()
    expect((await submit(u, { ...atGum, buildingId: randomUUID(), embedding: gumEmbedding })).reason).toBe(
      'building_not_found',
    )
    expect((await submit(u, { ...atGum, model: 'no-such-model', embedding: gumEmbedding })).reason).toBe(
      'recognition_unavailable',
    )
  })

  it('rejects a photo of a neighbouring building', async () => {
    const u = await newUser()
    const r = await submit(u, { ...atGum, embedding: mockEmbedding(SEED.historical.index) })
    expect(r.reason).toBe('other_building')
  })

  it('rejects unrecognised and malformed embeddings', async () => {
    const u = await newUser()
    const unrelated = Array.from({ length: 16 }, (_, i) => (i === 15 ? 1 : 0))
    expect((await submit(u, { ...atGum, embedding: unrelated })).reason).toBe('not_recognized')
    expect((await submit(u, { ...atGum, embedding: [1, 0, 0] })).reason).toBe('invalid_embedding')
    expect((await submit(u, { ...atGum, embedding: new Array<number>(16).fill(0) })).reason).toBe('invalid_embedding')
  })

  it('rejects a replayed reference embedding', async () => {
    const u = await newUser()
    const exact = mockEmbedding(SEED.gum.index, 0)
    expect((await submit(u, { ...atGum, embedding: exact })).reason).toBe('suspicious_embedding')
  })

  it('rejects an image hash already used in an accepted scan', async () => {
    const a = await newUser()
    const b = await newUser()
    const sha = 'a'.repeat(64)
    expect((await submit(a, { ...atGum, embedding: gumEmbedding, sha })).status).toBe('accepted')
    expect((await submit(b, { ...atGum, embedding: gumEmbedding, sha })).reason).toBe('duplicate_image')
  })

  it('rate limits bursts of scans', async () => {
    const u = await newUser()
    const far = { ...atGum, lat: SEED.gum.lat + 0.01, embedding: gumEmbedding }
    for (let i = 0; i < 10; i++) await submit(u, far)
    expect((await submit(u, far)).reason).toBe('rate_limited')
  })

  it('records every attempt in building_scans', async () => {
    const u = await newUser()
    await submit(u, { ...atGum, accuracy: 500, embedding: gumEmbedding })
    const rows = await t.asUser(u, (tx) =>
      tx.query<{ status: string; reject_reason: string }>(`select status, reject_reason from public.building_scans`),
    )
    expect(rows.rows).toEqual([{ status: 'rejected', reject_reason: 'location_inaccurate' }])
  })
})

describe('quests', () => {
  it('claims a completed quest reward exactly once', async () => {
    const u = await newUser()
    await submit(u, { ...atGum, embedding: gumEmbedding })
    const claim = () =>
      t.asUser(u, async (tx) => (await tx.query<{ r: { status: string } }>(`select public.claim_quest_reward($1) as r`, [SEED.questFirst])).rows[0]!.r)
    expect((await claim()).status).toBe('claimed')
    expect((await claim()).status).toBe('already_claimed')
    const p = await t.db.query<{ xp: number; coins: number }>(`select xp, coins from public.profiles where id = $1`, [u])
    expect(p.rows[0]).toEqual({ xp: 120 + 50, coins: 30 + 20 })
  })

  it('refuses to claim an incomplete quest', async () => {
    const u = await newUser()
    await submit(u, { ...atGum, embedding: gumEmbedding })
    await expect(
      t.asUser(u, (tx) => tx.query(`select public.claim_quest_reward($1)`, [SEED.questExplorer])),
    ).rejects.toThrow(/quest_not_completed/)
  })
})

describe('clans', () => {
  it('creates, joins and transfers ownership on leave', async () => {
    const owner = await newUser()
    const member = await newUser()
    const clanId = await t.asUser(owner, async (tx) =>
      (await tx.query<{ id: string }>(`select public.create_clan('Северные', 'SEV') as id`)).rows[0]!.id,
    )
    await expect(
      t.asUser(owner, (tx) => tx.query(`select public.create_clan('Другой', 'OTH')`)),
    ).rejects.toThrow(/already_in_clan/)
    await t.asUser(member, (tx) => tx.query(`select public.join_clan($1)`, [clanId]))
    await expect(t.asUser(member, (tx) => tx.query(`select public.join_clan($1)`, [clanId]))).rejects.toThrow(
      /already_in_clan/,
    )

    await t.asUser(owner, (tx) => tx.query(`select public.leave_clan()`))
    const clan = await t.db.query<{ owner_id: string }>(`select owner_id from public.clans where id = $1`, [clanId])
    expect(clan.rows[0]?.owner_id).toBe(member)

    await t.asUser(member, (tx) => tx.query(`select public.leave_clan()`))
    const gone = await t.db.query(`select 1 from public.clans where id = $1`, [clanId])
    expect(gone.rows).toHaveLength(0)
  })

  it('rejects duplicate clan names', async () => {
    const a = await newUser()
    const b = await newUser()
    await t.asUser(a, (tx) => tx.query(`select public.create_clan('Дубль', 'DUB')`))
    await expect(t.asUser(b, (tx) => tx.query(`select public.create_clan('дубль', 'DB2')`))).rejects.toThrow(/clan_taken/)
  })

  describe('avatars', () => {
    const upload = (userId: string, name: string) =>
      t.asUser(userId, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name, owner) values ('clan-avatars', $1, $2)`, [name, userId]),
      )
    const setAvatar = (userId: string, path: string | null) =>
      t.asUser(userId, async (tx) => (await tx.query<{ old: string | null }>(`select public.set_clan_avatar($1) as old`, [path])).rows[0]!.old)

    async function clanWithMember(): Promise<{ owner: string; member: string; clanId: string }> {
      const owner = await newUser()
      const member = await newUser()
      const tag = `A${Math.floor(Math.random() * 9000 + 1000)}`
      const clanId = await t.asUser(owner, async (tx) =>
        (await tx.query<{ id: string }>(`select public.create_clan($1, $2) as id`, [`Клан ${tag}`, tag])).rows[0]!.id,
      )
      await t.asUser(member, (tx) => tx.query(`select public.join_clan($1)`, [clanId]))
      return { owner, member, clanId }
    }

    it('lets only the owner upload into the clan folder and set the avatar', async () => {
      const { owner, member, clanId } = await clanWithMember()
      const first = `${clanId}/${randomUUID()}.webp`
      await upload(owner, first)
      expect(await setAvatar(owner, first)).toBeNull()

      const second = `${clanId}/${randomUUID()}.jpg`
      await upload(owner, second)
      expect(await setAvatar(owner, second)).toBe(first) // old path returned for cleanup

      // a plain member can neither upload nor point the clan at a file
      await expect(upload(member, `${clanId}/${randomUUID()}.webp`)).rejects.toThrow(/row-level security/)
      await expect(setAvatar(member, second)).rejects.toThrow(/not_clan_owner/)

      const row = await t.db.query<{ avatar_path: string }>(`select avatar_path from public.clans where id = $1`, [clanId])
      expect(row.rows[0]?.avatar_path).toBe(second)
    })

    it("rejects other clans' folders, missing files and odd paths", async () => {
      const a = await clanWithMember()
      const b = await clanWithMember()
      await expect(upload(a.owner, `${b.clanId}/${randomUUID()}.webp`)).rejects.toThrow(/row-level security/)
      await expect(upload(a.owner, `${randomUUID()}.webp`)).rejects.toThrow(/row-level security/)

      const foreign = `${b.clanId}/${randomUUID()}.webp`
      await upload(b.owner, foreign)
      await expect(setAvatar(a.owner, foreign)).rejects.toThrow(/invalid_avatar/)
      await expect(setAvatar(a.owner, `${a.clanId}/${randomUUID()}.webp`)).rejects.toThrow(/invalid_avatar/) // not uploaded
      await expect(setAvatar(a.owner, `${a.clanId}/../x.webp`)).rejects.toThrow(/invalid_avatar/)
      await expect(t.asUser(null, (tx) => tx.query(`select public.set_clan_avatar(null)`))).rejects.toThrow(/permission denied/)
    })

    it('owner can delete files; others cannot see or delete them; leaderboard shows the avatar', async () => {
      const { owner, member, clanId } = await clanWithMember()
      const path = `${clanId}/${randomUUID()}.webp`
      await upload(owner, path)
      await setAvatar(owner, path)

      const deletedByMember = await t.asUser(member, (tx) =>
        tx.query(`delete from storage.objects where bucket_id = 'clan-avatars' and name = $1`, [path]),
      )
      expect(deletedByMember.affectedRows).toBe(0)

      const board = await t.asUser(member, (tx) =>
        tx.query<{ avatar_path: string | null }>(`select avatar_path from public.clan_leaderboard(null, 100) where clan_id = $1`, [clanId]),
      )
      expect(board.rows[0]?.avatar_path).toBe(path)

      expect(await setAvatar(owner, null)).toBe(path)
      const deletedByOwner = await t.asUser(owner, (tx) =>
        tx.query(`delete from storage.objects where bucket_id = 'clan-avatars' and name = $1`, [path]),
      )
      expect(deletedByOwner.affectedRows).toBe(1)
    })
  })
})

describe('profile avatars', () => {
  const upload = (userId: string, name: string) =>
    t.asUser(userId, (tx) =>
      tx.query(`insert into storage.objects (bucket_id, name, owner) values ('profile-avatars', $1, $2)`, [name, userId]),
    )
  const setAvatar = (userId: string, path: string | null) =>
    t.asUser(userId, async (tx) => (await tx.query<{ old: string | null }>(`select public.set_profile_avatar($1) as old`, [path])).rows[0]!.old)

  it('lets a player upload into their own folder and replace the avatar', async () => {
    const u = await newUser()
    const first = `${u}/${randomUUID()}.webp`
    await upload(u, first)
    expect(await setAvatar(u, first)).toBeNull()

    const second = `${u}/${randomUUID()}.jpg`
    await upload(u, second)
    expect(await setAvatar(u, second)).toBe(first) // old path returned for cleanup

    const row = await t.db.query<{ avatar_path: string }>(`select avatar_path from public.profiles where id = $1`, [u])
    expect(row.rows[0]?.avatar_path).toBe(second)

    expect(await setAvatar(u, null)).toBe(second)
    const cleared = await t.db.query<{ avatar_path: string | null }>(`select avatar_path from public.profiles where id = $1`, [u])
    expect(cleared.rows[0]?.avatar_path).toBeNull()
  })

  it("rejects other players' folders, missing files and odd paths", async () => {
    const a = await newUser()
    const b = await newUser()
    await expect(upload(a, `${b}/${randomUUID()}.webp`)).rejects.toThrow(/row-level security/)
    await expect(upload(a, `${randomUUID()}.webp`)).rejects.toThrow(/row-level security/)

    const foreign = `${b}/${randomUUID()}.webp`
    await upload(b, foreign)
    await expect(setAvatar(a, foreign)).rejects.toThrow(/invalid_avatar/)
    await expect(setAvatar(a, `${a}/${randomUUID()}.webp`)).rejects.toThrow(/invalid_avatar/) // not uploaded
    await expect(setAvatar(a, `${a}/../x.webp`)).rejects.toThrow(/invalid_avatar/)
    await expect(t.asUser(null, (tx) => tx.query(`select public.set_profile_avatar(null)`))).rejects.toThrow(/permission denied/)

    const deletedByOther = await t.asUser(a, (tx) =>
      tx.query(`delete from storage.objects where bucket_id = 'profile-avatars' and name = $1`, [foreign]),
    )
    expect(deletedByOther.affectedRows).toBe(0)
    const deletedByOwner = await t.asUser(b, (tx) =>
      tx.query(`delete from storage.objects where bucket_id = 'profile-avatars' and name = $1`, [foreign]),
    )
    expect(deletedByOwner.affectedRows).toBe(1)
  })

  it('does not let the client write the avatar path or an external URL directly', async () => {
    const u = await newUser()
    const path = `${u}/${randomUUID()}.webp`
    await upload(u, path)
    await expect(
      t.asUser(u, (tx) => tx.query(`update public.profiles set avatar_path = $1 where id = $2`, [path, u])),
    ).rejects.toThrow(/permission denied/)
    const cols = await t.db.query(
      `select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_url'`,
    )
    expect(cols.rows).toHaveLength(0)
  })
})

describe('map queries', () => {
  it('returns buildings in a bbox with the caller discovery flag', async () => {
    const u = await newUser()
    await submit(u, { ...atGum, embedding: gumEmbedding })
    const rows = await t.asUser(u, (tx) =>
      tx.query<{ id: string; discovered_at: string | null; lat: number }>(
        `select id, discovered_at, lat from public.buildings_in_bbox(37.60, 55.74, 37.63, 55.77)`,
      ),
    )
    const gum = rows.rows.find((r) => r.id === SEED.gum.id)
    const bolshoi = rows.rows.find((r) => r.id === SEED.bolshoi.id)
    expect(gum?.discovered_at).not.toBeNull()
    expect(bolshoi?.discovered_at).toBeNull()
    expect(gum?.lat).toBeCloseTo(SEED.gum.lat, 4)
    expect(rows.rows.some((r) => r.id === '00000000-0000-4000-b000-000000000008')).toBe(false)
  })

  it('rejects oversized bbox requests', async () => {
    const u = await newUser()
    await expect(
      t.asUser(u, (tx) => tx.query(`select * from public.buildings_in_bbox(30, 50, 40, 60)`)),
    ).rejects.toThrow(/bbox_too_large/)
  })

  it('returns district overview with GeoJSON and personal progress', async () => {
    const u = await newUser()
    await submit(u, { ...atGum, embedding: gumEmbedding })
    const rows = await t.asUser(u, (tx) =>
      tx.query<{ id: string; boundary: { type: string }; total_buildings: number; discovered_buildings: number; my_influence: number }>(
        `select * from public.districts_overview()`,
      ),
    )
    const cao = rows.rows.find((r) => r.id === SEED.districtCao)
    expect(cao?.boundary.type).toBe('MultiPolygon')
    expect(cao).toMatchObject({ total_buildings: 5, discovered_buildings: 1, my_influence: 25 })
  })

  it('loads the 12 Moscow okrugs and assigns buildings by real boundaries', async () => {
    const d = await t.db.query<{ n: number; valid: boolean }>(
      `select count(*)::int as n, bool_and(extensions.st_isvalid(boundary::extensions.geometry)) as valid from public.districts`,
    )
    expect(d.rows[0]).toEqual({ n: 12, valid: true })
    const b = await t.db.query<{ slug: string; okrug: string }>(
      `select b.slug, d.short_name as okrug from public.buildings b join public.districts d on d.id = b.district_id order by b.slug`,
    )
    expect(Object.fromEntries(b.rows.map((r) => [r.slug, r.okrug]))).toEqual({
      'bolshoi-theatre': 'ЦАО',
      gum: 'ЦАО',
      'historical-museum': 'ЦАО',
      'pashkov-house': 'ЦАО',
      tsum: 'ЦАО',
      'kievsky-station': 'ЗАО',
      'hotel-ukraina': 'ЗАО',
      'msu-main': 'ЗАО',
      'ras-presidium': 'ЮЗАО',
      'gagarin-monument': 'ЮЗАО',
    })
  })

  it('ranks candidate buildings near the player without exposing references', async () => {
    const u = await newUser()
    const rows = await t.asUser(u, (tx) =>
      tx.query<{ building_id: string; score: number }>(
        `select * from public.match_building_candidates($1::real[], 'mock-dev-v1', $2, $3)`,
        [gumEmbedding, SEED.gum.lat, SEED.gum.lng],
      ),
    )
    expect(rows.rows[0]?.building_id).toBe(SEED.gum.id)
    expect(rows.rows[0]!.score).toBeGreaterThan(0.9)
  })
})

describe('progression formula', () => {
  it('SQL level_for_xp matches the client mirror', async () => {
    const samples = [0, 1, 99, 100, 101, 299, 300, 599, 600, 999, 1000, 4500, 4999, 5000, 123456, 2_000_000]
    const r = await t.db.query<{ xp: number; level: number }>(
      `select x as xp, public.level_for_xp(x) as level from unnest($1::int[]) as x`,
      [samples],
    )
    for (const row of r.rows) expect(row.level, `xp=${row.xp}`).toBe(levelForXp(row.xp))
  })
})
