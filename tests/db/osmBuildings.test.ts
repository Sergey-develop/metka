import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { chunk, GeoJsonFormatError, parseOsmGeoJson, type OsmBuildingInput, type Position } from '../../tools/osm-import/geojson.ts'
import { assembleRings, overpassToGeoJson } from '../../tools/osm-import/overpass.ts'
import { createTestDb, type TestDb } from './harness'

// near metro Varshavskaya
const LNG = 37.6196
const LAT = 55.6534

function square(lng: number, lat: number, d = 0.0002): Position[] {
  return [
    [lng, lat],
    [lng + d, lat],
    [lng + d, lat + d],
    [lng, lat + d],
    [lng, lat],
  ]
}

function feature(id: string, ring: Position[] | null, tags: Record<string, string> = { building: 'yes' }, geometry?: unknown) {
  return {
    type: 'Feature',
    id,
    properties: { '@id': id, ...tags },
    geometry: geometry ?? { type: 'Polygon', coordinates: [ring] },
  }
}

const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features })

describe('parseOsmGeoJson', () => {
  it('rejects non-FeatureCollection input', () => {
    expect(() => parseOsmGeoJson({ type: 'Feature' })).toThrow(GeoJsonFormatError)
    expect(() => parseOsmGeoJson(null)).toThrow(GeoJsonFormatError)
  })

  it('accepts polygons and multipolygons and extracts name/address/category/tags', () => {
    const r = parseOsmGeoJson(
      fc([
        feature('way/1', square(LNG, LAT), {
          building: 'apartments',
          name: 'Дом',
          'addr:street': 'Варшавское шоссе',
          'addr:housenumber': '10к2',
        }),
        feature('relation/2', null, { building: 'yes', amenity: 'school' }, {
          type: 'MultiPolygon',
          coordinates: [[square(LNG + 0.001, LAT)], [square(LNG + 0.002, LAT)]],
        }),
      ]),
    )
    expect(r.skipped).toEqual([])
    expect(r.features).toHaveLength(2)
    expect(r.features[0]).toMatchObject({
      osmType: 'way',
      osmId: 1,
      name: 'Дом',
      address: 'Варшавское шоссе, 10к2',
      category: 'apartments',
      tags: { building: 'apartments', name: 'Дом' },
    })
    expect(r.features[0]!.tags).not.toHaveProperty('@id')
    expect(r.features[1]).toMatchObject({ osmType: 'relation', category: 'school', name: null, address: null })
    expect(r.features[1]!.geometry.type).toBe('MultiPolygon')
  })

  it('reads osmtogeojson-style nested tags and ids', () => {
    const r = parseOsmGeoJson(
      fc([{ type: 'Feature', properties: { type: 'way', id: 7, tags: { building: 'yes' } }, geometry: { type: 'Polygon', coordinates: [square(LNG, LAT)] } }]),
    )
    expect(r.features[0]).toMatchObject({ osmType: 'way', osmId: 7, tags: { building: 'yes' } })
  })

  it('validates coordinates and geometry', () => {
    const r = parseOsmGeoJson(
      fc([
        feature('way/1', square(200, LAT)),
        feature('way/2', square(LNG, 95)),
        feature('way/3', [
          [LNG, LAT],
          [LNG + 0.001, LAT],
          [LNG, LAT + 0.001],
        ]),
        feature('way/4', square(LNG, LAT).slice(0, 4).concat([[LNG + 0.1, LAT]])), // not closed
        feature('way/5', null, undefined, { type: 'LineString', coordinates: square(LNG, LAT) }),
        feature('way/6', null, undefined, { type: 'Point', coordinates: [LNG, LAT] }), // a way cannot be a point
        feature('way/7', [[LNG, LAT], [Number.NaN, LAT], [LNG, LAT + 1], [LNG, LAT]]),
      ]),
    )
    expect(r.features).toEqual([])
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'invalid_coordinates',
      'invalid_coordinates',
      'invalid_geometry',
      'invalid_geometry',
      'invalid_geometry',
      'invalid_geometry',
      'invalid_coordinates',
    ])
  })

  it('skips non-buildings and features without an OSM id', () => {
    const r = parseOsmGeoJson(
      fc([
        feature('way/1', square(LNG, LAT), { highway: 'service' }),
        feature('way/2', square(LNG, LAT), { building: 'no' }),
        { type: 'Feature', properties: { building: 'yes' }, geometry: { type: 'Polygon', coordinates: [square(LNG, LAT)] } },
      ]),
    )
    expect(r.skipped.map((s) => s.reason)).toEqual(['not_building', 'not_building', 'invalid_id'])
  })

  it('deduplicates by OSM id (last wins) and by identical footprint', () => {
    const r = parseOsmGeoJson(
      fc([
        feature('way/1', square(LNG, LAT), { building: 'yes', name: 'old' }),
        feature('way/1', square(LNG, LAT), { building: 'yes', name: 'new' }),
        // same footprint, ring starts at another vertex
        feature('relation/9', [...square(LNG, LAT).slice(2, 4), ...square(LNG, LAT).slice(0, 3)]),
      ]),
    )
    expect(r.features).toHaveLength(1)
    expect(r.features[0]!.name).toBe('new')
    expect(r.skipped).toEqual([
      { index: 0, ref: 'way/1', reason: 'duplicate_id' },
      { index: 2, ref: 'relation/9', reason: 'duplicate_geometry' },
    ])
  })

  it('accepts building nodes as points', () => {
    const r = parseOsmGeoJson(fc([feature('node/5', null, undefined, { type: 'Point', coordinates: [LNG, LAT] })]))
    expect(r.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [LNG, LAT] })
  })

  it('chunks batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('overpassToGeoJson', () => {
  it('joins split outer ways (including reversed ones) and attaches inner rings', () => {
    const outerA: Position[] = [
      [0, 0],
      [4, 0],
      [4, 4],
    ]
    const outerB: Position[] = [
      [0, 0],
      [0, 4],
      [4, 4],
    ] // reversed direction
    expect(assembleRings([outerA, outerB])).toHaveLength(1)

    const ll = (r: Position[]) => r.map(([lon, lat]) => ({ lat, lon }))
    const geo = overpassToGeoJson({
      elements: [
        { type: 'way', id: 1, tags: { building: 'yes' }, geometry: ll(square(LNG, LAT)) },
        { type: 'way', id: 2, tags: { highway: 'service' }, geometry: ll(square(LNG, LAT)) },
        {
          type: 'relation',
          id: 3,
          tags: { building: 'yes', type: 'multipolygon' },
          members: [
            { type: 'way', ref: 10, role: 'outer', geometry: ll(outerA) },
            { type: 'way', ref: 11, role: 'outer', geometry: ll(outerB) },
            { type: 'way', ref: 12, role: 'inner', geometry: ll(square(1, 1, 1)) },
          ],
        },
      ],
    })
    expect(geo.features.map((f) => f.id)).toEqual(['way/1', 'relation/3'])
    const parsed = parseOsmGeoJson(geo)
    expect(parsed.skipped).toEqual([])
    expect(parsed.features[1]!.geometry).toMatchObject({ type: 'Polygon' })
    expect((parsed.features[1]!.geometry.coordinates as Position[][]).length).toBe(2) // outer + hole
  })
})

describe('osm_buildings import and catalog (PostGIS)', () => {
  let t: TestDb
  let admin: string
  let player: string

  async function importBatch(features: OsmBuildingInput[] | unknown) {
    return t.asServiceRole(async (tx) => {
      const r = await tx.query<{ r: { inserted: number; updated: number; unchanged: number; skipped: { osmId: number; reason: string }[] } }>(
        `select public.import_osm_buildings($1::jsonb) as r`,
        [JSON.stringify(features)],
      )
      return r.rows[0]!.r
    })
  }

  function inputs(n: number, offset = 0): OsmBuildingInput[] {
    return parseOsmGeoJson(
      fc(Array.from({ length: n }, (_, i) => feature(`way/${1000 + offset + i}`, square(LNG + (offset + i) * 0.0005, LAT), { building: 'yes', name: `B${offset + i}` }))),
    ).features
  }

  async function osmRowId(osmId: number): Promise<number> {
    const r = await t.db.query<{ id: number }>(`select id from public.osm_buildings where osm_type = 'way' and osm_id = $1`, [osmId])
    return r.rows[0]!.id
  }

  type FeatureCollectionResult = {
    truncated: boolean
    features: { id: number; geometry: { type: string }; properties: Record<string, unknown> }[]
  }

  async function viewport(userId: string, fn = 'osm_buildings_in_bbox', bbox = [LNG - 0.01, LAT - 0.01, LNG + 0.04, LAT + 0.01], limit?: number) {
    return t.asUser(userId, async (tx) => {
      const r = await tx.query<{ r: FeatureCollectionResult }>(`select public.${fn}($1, $2, $3, $4, 16, $5) as r`, [...bbox, limit ?? 1500])
      return r.rows[0]!.r
    })
  }

  async function adminSave(userId: string, osmBuildingId: number, data: Record<string, unknown>) {
    return t.asUser(userId, async (tx) => {
      const r = await tx.query<{ id: string }>(`select public.admin_save_game_building($1, $2::jsonb) as id`, [osmBuildingId, JSON.stringify(data)])
      return r.rows[0]!.id
    })
  }

  async function setStatus(userId: string, id: string, status: string) {
    return t.asUser(userId, (tx) => tx.query(`select public.admin_set_game_building_status($1, $2)`, [id, status]))
  }

  beforeAll(async () => {
    t = await createTestDb()
    admin = randomUUID()
    player = randomUUID()
    await t.createUser(admin, 'admin')
    await t.createUser(player, 'player')
    await t.db.query(`insert into public.app_admins (user_id) values ($1)`, [admin])
  })

  it('imports polygons and multipolygons, computes a point inside each footprint', async () => {
    const multi = parseOsmGeoJson(
      fc([feature('relation/50', null, { building: 'yes' }, { type: 'MultiPolygon', coordinates: [[square(LNG, LAT + 0.003)], [square(LNG + 0.001, LAT + 0.003)]] })]),
    ).features
    const r = await importBatch([...inputs(3), ...multi])
    expect(r).toEqual({ inserted: 4, updated: 0, unchanged: 0, skipped: [] })
    const rows = await t.db.query<{ inside: boolean; type: string; srid: number }>(
      `select extensions.st_covers(geom, centroid) inside, extensions.geometrytype(geom) type, extensions.st_srid(geom) srid from public.osm_buildings`,
    )
    expect(rows.rows.every((x) => x.inside && x.type === 'MULTIPOLYGON' && x.srid === 4326)).toBe(true)
  })

  it('re-import is idempotent and only updates changed rows', async () => {
    expect(await importBatch(inputs(3))).toEqual({ inserted: 0, updated: 0, unchanged: 3, skipped: [] })
    const changed = inputs(3)
    changed[1]!.name = 'Переименован'
    changed[2]!.tags = { building: 'school' }
    expect(await importBatch([...changed, ...inputs(1, 3)])).toEqual({ inserted: 1, updated: 2, unchanged: 1, skipped: [] })
    const count = await t.db.query<{ n: number }>(`select count(*)::int n from public.osm_buildings where osm_type = 'way'`)
    expect(count.rows[0]!.n).toBe(4)
  })

  it('server rejects invalid input and duplicate footprints under another id', async () => {
    const bowtie: Position[] = [
      [LNG, LAT - 0.002],
      [LNG + 0.001, LAT - 0.001],
      [LNG + 0.001, LAT - 0.002],
      [LNG, LAT - 0.001],
      [LNG, LAT - 0.002],
    ]
    const r = await importBatch([
      { ...inputs(1)[0]!, osmType: 'relation', osmId: 777 }, // same footprint as way/1000
      { osmType: 'way', osmId: 778, geometry: { type: 'Polygon', coordinates: [square(LNG, 91)] }, tags: {} },
      { osmType: 'way', osmId: 779, geometry: { type: 'LineString', coordinates: [[LNG, LAT], [LNG, LAT + 1]] }, tags: {} },
      { osmType: 'way', osmId: -1, geometry: { type: 'Polygon', coordinates: [square(LNG, LAT)] }, tags: {} },
      { osmType: 'way', osmId: 780, geometry: { type: 'Polygon', coordinates: [bowtie] }, tags: {} }, // self-intersecting → repaired
    ])
    expect(r.inserted).toBe(1)
    expect(r.skipped.map((s) => s.reason)).toEqual(['duplicate_geometry', 'invalid_coordinates', 'invalid_geometry', 'invalid_id'])
    const valid = await t.db.query<{ ok: boolean }>(`select extensions.st_isvalid(geom) ok from public.osm_buildings where osm_id = 780`)
    expect(valid.rows[0]!.ok).toBe(true)
  })

  it('clients cannot import or edit geodata', async () => {
    await expect(t.asUser(admin, (tx) => tx.query(`select public.import_osm_buildings('[]'::jsonb)`))).rejects.toThrow(/permission denied/)
    await expect(
      t.asUser(admin, (tx) => tx.query(`update public.osm_buildings set name = 'x'`)),
    ).rejects.toThrow(/permission denied/)
    await expect(
      t.asUser(player, (tx) => tx.query(`delete from public.osm_buildings`)),
    ).rejects.toThrow(/permission denied/)
  })

  it('only admins manage the catalog; drafts are invisible to players', async () => {
    const osmId = await osmRowId(1000)
    await expect(adminSave(player, osmId, { name: 'Взлом' })).rejects.toThrow(/forbidden/)
    await expect(viewport(player, 'admin_catalog_in_bbox')).rejects.toThrow(/forbidden/)
    await expect(t.asUser(player, (tx) => tx.query(`update public.buildings set publish_status = 'published'`))).rejects.toThrow(
      /permission denied/,
    )

    const gameId = await adminSave(admin, osmId, { name: 'Школа №1', rarity: 'rare', description: 'Описание', rewardXp: 120 })
    expect(await adminSave(admin, osmId, { category: 'school' })).toBe(gameId) // same row, no duplicate

    const draft = (await viewport(player)).features.find((f) => f.id === osmId)!
    expect(draft.properties).not.toHaveProperty('gameBuildingId')
    const adminView = (await viewport(admin, 'admin_catalog_in_bbox')).features.find((f) => f.id === osmId)!
    expect(adminView.properties).toMatchObject({ gameBuildingId: gameId, gameStatus: 'draft', gameName: 'Школа №1', rewardXp: 120, gameCategory: 'school' })

    const bboxRows = await t.asUser(player, (tx) =>
      tx.query<{ id: string }>(`select id from public.buildings_in_bbox($1, $2, $3, $4)`, [LNG - 0.01, LAT - 0.01, LNG + 0.04, LAT + 0.01]),
    )
    expect(bboxRows.rows).toEqual([])

    await setStatus(admin, gameId, 'published')
    const published = (await viewport(player)).features.find((f) => f.id === osmId)!
    expect(published.properties).toMatchObject({ gameBuildingId: gameId, gameStatus: 'published', rarity: 'rare' })
    expect(published.properties).not.toHaveProperty('rewardXp') // admin-only fields
    const after = await t.asUser(player, (tx) =>
      tx.query<{ id: string }>(`select id from public.buildings_in_bbox($1, $2, $3, $4)`, [LNG - 0.01, LAT - 0.01, LNG + 0.04, LAT + 0.01]),
    )
    expect(after.rows.map((r) => r.id)).toEqual([gameId])

    await setStatus(admin, gameId, 'unavailable')
    const active = await t.db.query<{ is_active: boolean }>(`select is_active from public.buildings where id = $1`, [gameId])
    expect(active.rows[0]!.is_active).toBe(false) // shown greyed out, not playable
    expect((await viewport(player)).features.find((f) => f.id === osmId)!.properties.gameStatus).toBe('unavailable')
    await setStatus(admin, gameId, 'published')
    await expect(setStatus(admin, gameId, 'live')).rejects.toThrow(/invalid_status/)
    await expect(adminSave(admin, osmId, { imageUrl: 'javascript:alert(1)' })).rejects.toThrow(/invalid_image_url/)
  })

  it('re-import does not change game settings of linked buildings', async () => {
    const osmId = await osmRowId(1000)
    const before = await t.db.query(`select name, description, rarity, reward_xp, publish_status from public.buildings where osm_building_id = $1`, [osmId])
    const moved = inputs(1)
    moved[0]!.name = 'Новое имя в OSM'
    moved[0]!.geometry = { type: 'Polygon', coordinates: [square(LNG, LAT, 0.00025)] }
    expect(await importBatch(moved)).toMatchObject({ updated: 1 })
    const after = await t.db.query(`select name, description, rarity, reward_xp, publish_status from public.buildings where osm_building_id = $1`, [osmId])
    expect(after.rows).toEqual(before.rows)
    expect(after.rows[0]).toMatchObject({ name: 'Школа №1', publish_status: 'published' })
    await expect(t.db.query(`delete from public.osm_buildings where id = $1`, [osmId])).rejects.toThrow(/foreign key/)
  })

  it('filters by viewport, returns an empty collection outside data and rejects huge bboxes', async () => {
    const far = await viewport(player, 'osm_buildings_in_bbox', [30, 50, 30.01, 50.01])
    expect(far).toEqual({ truncated: false, features: [] })
    const narrow = await viewport(player, 'osm_buildings_in_bbox', [LNG + 0.0004, LAT - 0.0001, LNG + 0.0009, LAT + 0.0003])
    expect(narrow.features.map((f) => f.properties.osmId)).toEqual([1001])
    await expect(viewport(player, 'osm_buildings_in_bbox', [LNG, LAT, LNG + 0.5, LAT + 0.01])).rejects.toThrow(/bbox_too_large/)
    await expect(viewport(player, 'osm_buildings_in_bbox', [LNG, LAT, LNG - 0.01, LAT + 0.01])).rejects.toThrow(/invalid_bbox/)
  })

  it('respects the object limit and keeps game buildings when truncating', async () => {
    const r = await viewport(player, 'osm_buildings_in_bbox', undefined, 2)
    expect(r.truncated).toBe(true)
    expect(r.features).toHaveLength(2)
    expect(r.features[0]!.properties.gameBuildingId).toBeTruthy()
  })

  it('returns building nodes as points', async () => {
    await importBatch([{ osmType: 'node', osmId: 99, geometry: { type: 'Point', coordinates: [LNG + 0.03, LAT] }, tags: { building: 'yes' } }])
    const r = await viewport(player)
    expect(r.features.find((f) => f.properties.osmType === 'node')!.geometry.type).toBe('Point')
  })
})
