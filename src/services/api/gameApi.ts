import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExplorationResult } from '../exploration/explorationTracker'
import type { Cell } from '../exploration/grid'
import type { TrackPoint } from '../exploration/trackFilter'
import type { GameAreaId } from '@/utils/gameAreas'
import { factsFromOsm, organizationFromOsm } from '../buildings/buildingFacts'
import type { CandidateMatcher, RecognitionCandidate } from '../recognition/types'
import {
  AVATAR_KEYS,
  EVENT_KINDS,
  STYLE_COLLECTIONS,
  TASK_KINDS,
  type AdminGameInfo,
  type AvatarKey,
  type Bbox,
  type BuildingFacts,
  type BuildingOrganization,
  type BuildingOutline,
  type GameBuildingDraft,
  type GameBuildingStatus,
  type OutlineGameInfo,
  type OutlinesPage,
  type PlayerProgress,
  type PlayerStats,
  type ClaimResult,
  type Clan,
  type ClanMembership,
  type ClanPage,
  type ClanRanking,
  type EventDraft,
  type EventPerson,
  type GameEvent,
  type LandmarkCollection,
  type CollectionItem,
  type DistrictOverview,
  type MapBuilding,
  type PlayerRanking,
  type Profile,
  type ProfileStats,
  type PublicProfile,
  type QuestView,
  type Rarity,
  type ScanDecision,
  type ScanRejectReason,
  type ScanSubmission,
  type StyleCollections,
  type TasksState,
} from '@/types/game'
import { ApiError, toApiError, withRetry } from './errors'
import { arr, bool, num, numOrNull, obj, oneOf, str, strOrNull, type Json } from './parse'

const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const satisfies readonly Rarity[]
const GAME_STATUSES = ['draft', 'published', 'unavailable', 'hidden'] as const satisfies readonly GameBuildingStatus[]
const REJECT_REASONS = [
  'rate_limited',
  'invalid_location',
  'building_not_found',
  'location_inaccurate',
  'too_far',
  'recognition_unavailable',
  'invalid_embedding',
  'invalid_request',
  'duplicate_image',
  'suspicious_embedding',
  'other_building',
  'not_recognized',
  'ambiguous',
] as const satisfies readonly ScanRejectReason[]

interface SupabaseResult {
  data: unknown
  error: unknown
}

async function unwrap(request: PromiseLike<SupabaseResult>): Promise<unknown> {
  let result: SupabaseResult
  try {
    result = await request
  } catch (error) {
    throw toApiError(error)
  }
  if (result.error) throw toApiError(result.error)
  return result.data
}

function parseProfileStats(value: unknown): ProfileStats | null {
  if (value === null || value === undefined) return null
  const o = obj(value, 'profile')
  return { level: num(o, 'level'), xp: num(o, 'xp'), coins: num(o, 'coins'), buildingsDiscovered: num(o, 'buildingsDiscovered') }
}

export function parseScanDecision(value: unknown): ScanDecision {
  const o = obj(value, 'scan')
  const reason = o.reason === null || o.reason === undefined ? null : oneOf(o, 'reason', REJECT_REASONS)
  const reward = o.reward === null || o.reward === undefined ? null : obj(o.reward, 'reward')
  return {
    scanId: str(o, 'scanId'),
    status: oneOf(o, 'status', ['accepted', 'rejected', 'already_discovered'] as const),
    reason,
    duplicate: o.duplicate === true,
    buildingId: strOrNull(o, 'buildingId'),
    distanceM: numOrNull(o, 'distanceM'),
    reward: reward ? { xp: num(reward, 'xp'), coins: num(reward, 'coins'), influence: num(reward, 'influence') } : null,
    completedQuests: arr(o.completedQuests ?? [], 'completedQuests').map((q) => {
      const qo = obj(q, 'quest')
      return { questId: str(qo, 'questId'), slug: str(qo, 'slug'), title: str(qo, 'title') }
    }),
    profile: parseProfileStats(o.profile),
  }
}

function parseBuilding(row: unknown): MapBuilding {
  const o = obj(row, 'building')
  return {
    id: str(o, 'id'),
    slug: str(o, 'slug'),
    name: str(o, 'name'),
    description: strOrNull(o, 'description'),
    address: strOrNull(o, 'address'),
    districtId: strOrNull(o, 'district_id'),
    lat: num(o, 'lat'),
    lng: num(o, 'lng'),
    scanRadiusM: num(o, 'scan_radius_m'),
    rarity: oneOf(o, 'rarity', RARITIES),
    reward: { xp: num(o, 'reward_xp'), coins: num(o, 'reward_coins'), influence: num(o, 'reward_influence') },
    imageUrl: strOrNull(o, 'image_url'),
    isDevSeed: bool(o, 'is_dev_seed'),
    discoveredAt: strOrNull(o, 'discovered_at'),
  }
}

function parseMultiPolygon(value: unknown): GeoJSON.MultiPolygon {
  const o = obj(value, 'boundary')
  if (o.type !== 'MultiPolygon') throw new ApiError('invalid_response', 'boundary: expected MultiPolygon')
  const coordinates = arr(o.coordinates, 'coordinates').map((polygon) =>
    arr(polygon, 'polygon').map((ring) =>
      arr(ring, 'ring').map((point) => {
        const p = arr(point, 'point')
        const [lng, lat] = p
        if (typeof lng !== 'number' || typeof lat !== 'number') throw new ApiError('invalid_response', 'boundary point')
        return [lng, lat]
      }),
    ),
  )
  return { type: 'MultiPolygon', coordinates }
}

function parsePosition(value: unknown): GeoJSON.Position {
  const [lng, lat] = arr(value, 'position')
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat))
    throw new ApiError('invalid_response', 'position: expected [lng, lat]')
  return [lng, lat]
}
const parseRing = (value: unknown) => arr(value, 'ring').map(parsePosition)
const parsePolygon = (value: unknown) => arr(value, 'polygon').map(parseRing)

function parseOutlineGeometry(value: unknown): BuildingOutline['geometry'] {
  const o = obj(value, 'geometry')
  switch (o.type) {
    case 'Polygon':
      return { type: 'Polygon', coordinates: parsePolygon(o.coordinates) }
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: arr(o.coordinates, 'coordinates').map(parsePolygon) }
    case 'Point':
      return { type: 'Point', coordinates: parsePosition(o.coordinates) }
    default:
      throw new ApiError('invalid_response', 'geometry: expected Polygon|MultiPolygon|Point')
  }
}

/** Game fields of an outline feature; null when the footprint is not in the (visible) catalog. */
function parseGameInfo(p: Json): OutlineGameInfo | null {
  if (p.gameBuildingId === undefined || p.gameBuildingId === null) return null
  return {
    id: str(p, 'gameBuildingId'),
    status: oneOf(p, 'gameStatus', GAME_STATUSES),
    name: str(p, 'gameName'),
    description: strOrNull(p, 'description'),
    category: strOrNull(p, 'gameCategory'),
    rarity: oneOf(p, 'rarity', RARITIES),
    imageUrl: strOrNull(p, 'imageUrl'),
    discoveredAt: strOrNull(p, 'discoveredAt'),
  }
}

function parseAdminGameInfo(p: Json): AdminGameInfo | null {
  const base = parseGameInfo(p)
  if (!base) return null
  return {
    ...base,
    reward: { xp: num(p, 'rewardXp'), coins: num(p, 'rewardCoins'), influence: num(p, 'rewardInfluence') },
    scanRadiusM: num(p, 'scanRadiusM'),
    unlockConditions: p.unlockConditions === undefined ? {} : obj(p.unlockConditions, 'unlockConditions'),
  }
}

function parseOutlinesPage<G extends OutlineGameInfo>(value: unknown, game: (p: Json) => G | null): OutlinesPage<G> {
  const o = obj(value, 'outlines')
  return {
    truncated: o.truncated === true,
    features: arr(o.features, 'features').map((raw): BuildingOutline<G> => {
      const f = obj(raw, 'feature')
      const p = obj(f.properties, 'properties')
      return {
        id: num(f, 'id'),
        osmType: oneOf(p, 'osmType', ['node', 'way', 'relation'] as const),
        osmId: num(p, 'osmId'),
        geometry: parseOutlineGeometry(f.geometry),
        name: strOrNull(p, 'name'),
        address: strOrNull(p, 'address'),
        category: strOrNull(p, 'category'),
        game: game(p),
      }
    }),
  }
}

function parseCells(value: unknown): Cell[] {
  return arr(value, 'cells').map((c) => {
    const [y, x] = arr(c, 'cell')
    if (!Number.isInteger(y) || !Number.isInteger(x)) throw new ApiError('invalid_response', 'cell: expected [y, x]')
    return [y as number, x as number] as const
  })
}

function parseCounts(value: unknown): Record<string, number> {
  const o = obj(value ?? {}, 'rejected')
  return Object.fromEntries(Object.keys(o).map((k) => [k, num(o, k)]))
}

function parsePlayerStats(value: unknown): PlayerStats {
  const o = obj(value, 'stats')
  const streets = obj(o.streets, 'stats.streets')
  const clan = o.clan === null || o.clan === undefined ? null : obj(o.clan, 'stats.clan')
  return {
    today: str(o, 'today'),
    streakDays: num(o, 'streakDays'),
    activeDays: arr(o.activeDays, 'stats.activeDays').map((d) => {
      if (typeof d !== 'string') throw new ApiError('invalid_response', 'stats.activeDays: expected strings')
      return d
    }),
    streets: { visited: num(streets, 'visited'), total: num(streets, 'total'), scope: oneOf(streets, 'scope', ['home', 'all'] as const) },
    clan: clan ? { level: num(clan, 'level'), discoveries: num(clan, 'discoveries') } : null,
  }
}

export interface ExploredCellsPage {
  cells: Cell[]
  truncated: boolean
  totalCells: number
}

const PROFILE_COLUMNS =
  'id, username, avatar_path, avatar_key, setup_completed_at, level, xp, coins, buildings_discovered, home_district_id'

function parseProfile(row: unknown, avatarUrl: (path: string | null) => string | null): Profile {
  const o = obj(row, 'profile')
  return {
    id: str(o, 'id'),
    username: str(o, 'username'),
    avatarUrl: avatarUrl(strOrNull(o, 'avatar_path')),
    avatarKey: o.avatar_key === null || o.avatar_key === undefined ? null : oneOf(o, 'avatar_key', AVATAR_KEYS),
    setupCompleted: strOrNull(o, 'setup_completed_at') !== null,
    level: num(o, 'level'),
    xp: num(o, 'xp'),
    coins: num(o, 'coins'),
    buildingsDiscovered: num(o, 'buildings_discovered'),
    homeDistrictId: strOrNull(o, 'home_district_id'),
  }
}

const CLAN_AVATAR_BUCKET = 'clan-avatars'
const PROFILE_AVATAR_BUCKET = 'profile-avatars'
/** private player photos (album + discovery photos), owner-only — migrations 010/011 */
const PLAYER_PHOTO_BUCKET = 'memory-photos'
const EVENT_COVER_BUCKET = 'event-covers'

/** Typed access to the METKA backend (PostgREST tables + RPC functions). */
export class GameApi implements CandidateMatcher {
  constructor(private readonly client: SupabaseClient) {}

  private clanAvatarUrl(path: string | null): string | null {
    return path ? this.client.storage.from(CLAN_AVATAR_BUCKET).getPublicUrl(path).data.publicUrl : null
  }

  private readonly profileAvatarUrl = (path: string | null): string | null =>
    path ? this.client.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(path).data.publicUrl : null

  private parseClan(o: Json): Clan {
    return {
      id: str(o, 'id'),
      name: str(o, 'name'),
      tag: str(o, 'tag'),
      ownerId: str(o, 'owner_id'),
      avatarUrl: this.clanAvatarUrl(strOrNull(o, 'avatar_path')),
    }
  }

  async getBuildingsInBbox(bbox: Bbox): Promise<MapBuilding[]> {
    const data = await withRetry(() =>
      unwrap(
        this.client.rpc('buildings_in_bbox', {
          p_min_lng: bbox.minLng,
          p_min_lat: bbox.minLat,
          p_max_lng: bbox.maxLng,
          p_max_lat: bbox.maxLat,
          p_limit: 500,
        }),
      ),
    )
    return arr(data).map(parseBuilding)
  }

  /** Footprints (OSM) in the viewport with their game state; bbox span ≤ 0.1°. */
  async getBuildingOutlines(bbox: Bbox, zoom: number, signal?: AbortSignal): Promise<OutlinesPage> {
    const data = await this.outlinesRpc('osm_buildings_in_bbox', bbox, zoom, signal)
    return parseOutlinesPage(data, (o) => parseGameInfo(o))
  }

  /** Card facts of one OSM building (osm_buildings is readable by signed-in players, RLS). */
  async getBuildingFacts(osmBuildingId: number, signal?: AbortSignal): Promise<BuildingFacts> {
    const data = await withRetry(() => {
      if (signal?.aborted) throw new ApiError('cancelled')
      const request = this.client
        .from('osm_buildings')
        .select('id, osm_type, osm_id, name, address, tags, updated_at')
        .eq('id', osmBuildingId)
      return unwrap((signal ? request.abortSignal(signal) : request).maybeSingle())
    })
    if (data === null) throw new ApiError('not_found', 'osm building not found')
    const o = obj(data, 'osm_building')
    const tags = o.tags !== null && typeof o.tags === 'object' && !Array.isArray(o.tags) ? (o.tags as Json) : {}
    return factsFromOsm({
      id: num(o, 'id'),
      osm_type: oneOf(o, 'osm_type', ['node', 'way', 'relation'] as const),
      osm_id: num(o, 'osm_id'),
      name: strOrNull(o, 'name'),
      address: strOrNull(o, 'address'),
      tags,
      updated_at: str(o, 'updated_at'),
    })
  }

  /** Organisations linked to an OSM building (osm_pois, migration 012; only proven links). */
  async getBuildingOrganizations(osmBuildingId: number): Promise<BuildingOrganization[]> {
    const data = await withRetry(() =>
      unwrap(
        this.client
          .from('osm_pois')
          .select('id, name, kind_key, kind_value, tags, link_method')
          .eq('osm_building_id', osmBuildingId)
          .order('name')
          .limit(100),
      ),
    )
    return arr(data).flatMap((row) => {
      const o = obj(row, 'osm_poi')
      const link = o.link_method
      if (link !== 'explicit' && link !== 'inside_footprint') return []
      const tags = o.tags !== null && typeof o.tags === 'object' && !Array.isArray(o.tags) ? (o.tags as Json) : {}
      return [organizationFromOsm({ id: num(o, 'id'), name: str(o, 'name'), kindValue: str(o, 'kind_value'), tags, link })]
    })
  }

  /** Sends filtered GPS fixes; the server derives and stores explored cells. Not retried here. */
  async recordExploration(points: TrackPoint[]): Promise<ExplorationResult> {
    const o = obj(await unwrap(this.client.rpc('record_exploration', { p_points: points })), 'exploration')
    return {
      accepted: num(o, 'accepted'),
      rejected: parseCounts(o.rejected),
      newCells: parseCells(o.newCells),
      totalCells: num(o, 'totalCells'),
    }
  }

  /** The player's most recently explored cells, newest first (own rows only, RLS). */
  async getRecentExploredCells(limit = 300): Promise<Cell[]> {
    const data = await withRetry(() =>
      unwrap(this.client.from('explored_cells').select('cell_y, cell_x').order('explored_at', { ascending: false }).limit(limit)),
    )
    return arr(data).map((row) => {
      const o = obj(row, 'explored_cell')
      const y = num(o, 'cell_y')
      const x = num(o, 'cell_x')
      if (!Number.isInteger(y) || !Number.isInteger(x)) throw new ApiError('invalid_response', 'explored_cell: expected integers')
      return [y, x] as const
    })
  }

  /** The player's explored cells in the viewport (bbox span ≤ 0.2°). */
  async getExploredCells(bbox: Bbox, signal?: AbortSignal): Promise<ExploredCellsPage> {
    const data = await withRetry(() => {
      if (signal?.aborted) throw new ApiError('cancelled')
      const request = this.client.rpc('explored_cells_in_bbox', {
        p_min_lng: bbox.minLng,
        p_min_lat: bbox.minLat,
        p_max_lng: bbox.maxLng,
        p_max_lat: bbox.maxLat,
      })
      return unwrap(signal ? request.abortSignal(signal) : request)
    })
    const o = obj(data, 'explored')
    return { cells: parseCells(o.cells), truncated: o.truncated === true, totalCells: num(o, 'totalCells') }
  }

  /** TEST ONLY (migration 009): account may scan by location without recognition. */
  async isLocationScanTester(): Promise<boolean> {
    return (await unwrap(this.client.rpc('is_location_scan_tester'))) === true
  }

  async getProgress(): Promise<PlayerProgress> {
    const o = obj(await withRetry(() => unwrap(this.client.rpc('player_progress'))), 'progress')
    return {
      exploredCells: num(o, 'exploredCells'),
      exploredDistricts: num(o, 'exploredDistricts'),
      districtMinCells: num(o, 'districtMinCells'),
      unlockedBuildings: num(o, 'unlockedBuildings'),
      memories: num(o, 'memories'),
      favoritePlaces: num(o, 'favoritePlaces'),
    }
  }

  async getPlayerStats(): Promise<PlayerStats> {
    return parsePlayerStats(await withRetry(() => unwrap(this.client.rpc('player_stats'))))
  }

  /** player_public_profile() (migration 019): a clanmate's profile; 'profile_hidden' otherwise. */
  async getPublicProfile(userId: string): Promise<PublicProfile> {
    const o = obj(await withRetry(() => unwrap(this.client.rpc('player_public_profile', { p_user_id: userId }))), 'public_profile')
    const p = obj(o.profile, 'public_profile.profile')
    const progress = obj(o.progress, 'public_profile.progress')
    return {
      profile: {
        id: str(p, 'id'),
        username: str(p, 'username'),
        avatarUrl: this.profileAvatarUrl(strOrNull(p, 'avatarPath')),
        avatarKey: p.avatarKey === null || p.avatarKey === undefined ? null : oneOf(p, 'avatarKey', AVATAR_KEYS),
        level: num(p, 'level'),
        xp: num(p, 'xp'),
        buildingsDiscovered: num(p, 'buildingsDiscovered'),
        homeDistrictId: strOrNull(p, 'homeDistrictId'),
      },
      stats: parsePlayerStats(o.stats),
      progress: {
        exploredCells: num(progress, 'exploredCells'),
        exploredDistricts: num(progress, 'exploredDistricts'),
        districtMinCells: num(progress, 'districtMinCells'),
        unlockedBuildings: num(progress, 'unlockedBuildings'),
      },
      discoveredByDistrict: parseCounts(o.discoveredByDistrict),
      achievements: arr(o.achievements, 'public_profile.achievements').map((row) => {
        const q = obj(row, 'public_profile.achievement')
        return {
          id: str(q, 'id'),
          slug: str(q, 'slug'),
          title: str(q, 'title'),
          description: str(q, 'description'),
          kind: oneOf(q, 'kind', ['discover_count', 'discover_in_district', 'discover_rarity'] as const),
          target: num(q, 'target'),
          progress: num(q, 'progress'),
          completedAt: strOrNull(q, 'completedAt'),
        }
      }),
      bestFinds: arr(o.bestFinds, 'public_profile.bestFinds').map((row) => {
        const f = obj(row, 'public_profile.find')
        return { buildingId: str(f, 'buildingId'), name: str(f, 'name'), rarity: oneOf(f, 'rarity', RARITIES), imageUrl: strOrNull(f, 'imageUrl') }
      }),
    }
  }

  async isAdmin(): Promise<boolean> {
    return (await unwrap(this.client.rpc('is_admin'))) === true
  }

  /** Same as getBuildingOutlines but with drafts/hidden entries and admin fields; admins only. */
  async getAdminCatalog(bbox: Bbox, zoom: number, signal?: AbortSignal): Promise<OutlinesPage<AdminGameInfo>> {
    const data = await this.outlinesRpc('admin_catalog_in_bbox', bbox, zoom, signal)
    return parseOutlinesPage(data, parseAdminGameInfo)
  }

  /** Creates the game building for a footprint (as a draft) or updates it; returns its id. Not retried. */
  async saveGameBuilding(osmBuildingId: number, draft: GameBuildingDraft): Promise<string> {
    const data = await unwrap(this.client.rpc('admin_save_game_building', { p_osm_building_id: osmBuildingId, p_data: draft }))
    if (typeof data !== 'string') throw new ApiError('invalid_response', 'admin_save_game_building: expected id')
    return data
  }

  async setGameBuildingStatus(buildingId: string, status: GameBuildingStatus): Promise<void> {
    await unwrap(this.client.rpc('admin_set_game_building_status', { p_building_id: buildingId, p_status: status }))
  }

  private outlinesRpc(fn: string, bbox: Bbox, zoom: number, signal?: AbortSignal): Promise<unknown> {
    return withRetry(() => {
      if (signal?.aborted) throw new ApiError('cancelled')
      const request = this.client.rpc(fn, {
        p_min_lng: bbox.minLng,
        p_min_lat: bbox.minLat,
        p_max_lng: bbox.maxLng,
        p_max_lat: bbox.maxLat,
        p_zoom: zoom,
      })
      return unwrap(signal ? request.abortSignal(signal) : request)
    })
  }

  /** area_progress() (migration 025): game buildings of a game area and how many the player found */
  async getAreaProgress(area: GameAreaId): Promise<{ total: number; discovered: number }> {
    const o = obj(await withRetry(() => unwrap(this.client.rpc('area_progress', { p_area: area }))), 'area_progress')
    return { total: num(o, 'total'), discovered: num(o, 'discovered') }
  }

  async getDistrictsOverview(): Promise<DistrictOverview[]> {
    const data = await withRetry(() => unwrap(this.client.rpc('districts_overview')))
    return arr(data).map((row) => {
      const o = obj(row, 'district')
      return {
        id: str(o, 'id'),
        slug: str(o, 'slug'),
        name: str(o, 'name'),
        shortName: str(o, 'short_name'),
        boundary: parseMultiPolygon(o.boundary),
        totalBuildings: num(o, 'total_buildings'),
        discoveredBuildings: num(o, 'discovered_buildings'),
        myInfluence: num(o, 'my_influence'),
      }
    })
  }

  /** CandidateMatcher: server ranks nearby buildings; reference embeddings stay on the server. */
  async match(
    query: { embedding: Float32Array; modelVersion: string; lat: number; lng: number },
    signal?: AbortSignal,
  ): Promise<RecognitionCandidate[]> {
    let request = this.client.rpc('match_building_candidates', {
      p_embedding: Array.from(query.embedding),
      p_model_version: query.modelVersion,
      p_lat: query.lat,
      p_lng: query.lng,
      p_limit: 5,
    })
    if (signal) request = request.abortSignal(signal)
    const data = await unwrap(request)
    return arr(data).map((row) => {
      const o = obj(row, 'candidate')
      return { buildingId: str(o, 'building_id'), name: str(o, 'name'), score: num(o, 'score'), distanceM: num(o, 'distance_m') }
    })
  }

  /** Idempotent thanks to clientRequestId, so network failures are retried safely. */
  async submitScan(s: ScanSubmission): Promise<ScanDecision> {
    const data = await withRetry(() =>
      unwrap(
        this.client.rpc('submit_building_scan', {
          p_client_request_id: s.clientRequestId,
          p_building_id: s.buildingId,
          p_lat: s.lat,
          p_lng: s.lng,
          p_accuracy_m: s.accuracyM,
          p_model_version: s.modelVersion,
          p_embedding: Array.from(s.embedding),
          p_image_sha256: s.imageSha256,
          p_quality: s.quality,
        }),
      ),
    )
    return parseScanDecision(data)
  }

  async getProfile(userId: string): Promise<Profile> {
    const data = await withRetry(() =>
      unwrap(
        this.client
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .eq('id', userId)
          .single(),
      ),
    )
    return parseProfile(data, this.profileAvatarUrl)
  }

  async updateProfile(
    userId: string,
    patch: { username?: string; avatarKey?: AvatarKey },
  ): Promise<Profile> {
    const update: Record<string, string | null> = {}
    if (patch.username !== undefined) update.username = patch.username
    if (patch.avatarKey !== undefined) update.avatar_key = patch.avatarKey
    const data = await unwrap(
      this.client
        .from('profiles')
        .update(update)
        .eq('id', userId)
        .select(PROFILE_COLUMNS)
        .single(),
    )
    return parseProfile(data, this.profileAvatarUrl)
  }

  /** Registration step "game profile". Raises username_taken / invalid_profile. */
  async completeProfileSetup(username: string, avatarKey: AvatarKey): Promise<void> {
    await unwrap(this.client.rpc('complete_profile_setup', { p_username: username, p_avatar_key: avatarKey }))
  }

  /**
   * Uploads a prepared (re-encoded, ≤512 KB) image as the player's avatar and makes it current.
   * Storage RLS and set_profile_avatar() both restrict writes to the caller's own folder.
   */
  async setProfileAvatar(userId: string, image: Blob): Promise<void> {
    const ext = image.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${userId}/${crypto.randomUUID()}.${ext}`
    const bucket = this.client.storage.from(PROFILE_AVATAR_BUCKET)
    const { error } = await bucket.upload(path, image, { contentType: image.type, upsert: false, cacheControl: '31536000' })
    if (error) throw toApiError(error)
    let previous: unknown
    try {
      previous = await unwrap(this.client.rpc('set_profile_avatar', { p_path: path }))
    } catch (e) {
      await bucket.remove([path]) // don't leave an orphan behind
      throw e
    }
    // best effort: a leftover old file only costs storage
    if (typeof previous === 'string') await bucket.remove([previous])
  }

  async removeProfileAvatar(): Promise<void> {
    const previous = await unwrap(this.client.rpc('set_profile_avatar', { p_path: null }))
    if (typeof previous === 'string') await this.client.storage.from(PROFILE_AVATAR_BUCKET).remove([previous])
  }

  /**
   * Stores the photo of the unlocking scan for the collection (private bucket, migration 011).
   * `image` must already be re-encoded (EXIF stripped). replace = false keeps an existing photo.
   */
  async setDiscoveryPhoto(userId: string, buildingId: string, image: Blob, replace: boolean): Promise<void> {
    const path = `${userId}/${crypto.randomUUID()}.${image.type === 'image/webp' ? 'webp' : 'jpg'}`
    const bucket = this.client.storage.from(PLAYER_PHOTO_BUCKET)
    const { error } = await bucket.upload(path, image, { contentType: image.type, upsert: false })
    if (error) throw toApiError(error)
    let unused: unknown
    try {
      unused = await unwrap(this.client.rpc('set_discovery_photo', { p_building_id: buildingId, p_photo_path: path, p_replace: replace }))
    } catch (e) {
      await bucket.remove([path]) // no orphan
      throw e
    }
    if (typeof unused === 'string') await bucket.remove([unused]) // replaced or not needed
  }

  async getCollection(): Promise<CollectionItem[]> {
    const data = await withRetry(() =>
      unwrap(
        this.client
          .from('player_buildings')
          .select('building_id, discovered_at, photo_path, buildings(name, rarity, image_url, district_id)')
          .order('discovered_at', { ascending: false }),
      ),
    )
    return arr(data).flatMap((row) => {
      const o = obj(row, 'collection')
      if (o.buildings === null) return [] // building deactivated
      const b = obj(o.buildings, 'buildings')
      return [
        {
          buildingId: str(o, 'building_id'),
          discoveredAt: str(o, 'discovered_at'),
          name: str(b, 'name'),
          rarity: oneOf(b, 'rarity', RARITIES),
          imageUrl: strOrNull(b, 'image_url'),
          districtId: strOrNull(b, 'district_id'),
          photoPath: strOrNull(o, 'photo_path'),
        },
      ]
    })
  }

  async getQuests(): Promise<QuestView[]> {
    const [questsData, progressData] = await withRetry(() =>
      Promise.all([
        unwrap(
          this.client
            .from('quests')
            .select('id, slug, title, description, kind, target, reward_xp, reward_coins, ends_at')
            .order('target'),
        ),
        unwrap(this.client.from('player_quests').select('quest_id, progress, completed_at, claimed_at')),
      ]),
    )
    const progress = new Map(
      arr(progressData).map((row) => {
        const o = obj(row, 'player_quest')
        return [str(o, 'quest_id'), o] as const
      }),
    )
    return arr(questsData).map((row) => {
      const o = obj(row, 'quest')
      const p = progress.get(str(o, 'id'))
      return {
        id: str(o, 'id'),
        slug: str(o, 'slug'),
        title: str(o, 'title'),
        description: str(o, 'description'),
        kind: oneOf(o, 'kind', ['discover_count', 'discover_in_district', 'discover_rarity'] as const),
        target: num(o, 'target'),
        progress: p ? num(p, 'progress') : 0,
        reward: { xp: num(o, 'reward_xp'), coins: num(o, 'reward_coins') },
        completedAt: p ? strOrNull(p, 'completed_at') : null,
        claimedAt: p ? strOrNull(p, 'claimed_at') : null,
        endsAt: strOrNull(o, 'ends_at'),
      }
    })
  }

  /** Idempotent on the server (reward ledger UNIQUE), safe to retry. */
  async claimQuest(questId: string): Promise<ClaimResult> {
    const data = await withRetry(() => unwrap(this.client.rpc('claim_quest_reward', { p_quest_id: questId })))
    const o = obj(data, 'claim')
    return {
      status: oneOf(o, 'status', ['claimed', 'already_claimed'] as const),
      questId: str(o, 'questId'),
      profile: parseProfileStats(o.profile),
    }
  }

  async getMyClan(userId: string): Promise<ClanMembership | null> {
    const data = await withRetry(() =>
      unwrap(
        this.client
          .from('clan_members')
          .select('role, clans(id, name, tag, owner_id, avatar_path)')
          .eq('user_id', userId)
          .maybeSingle(),
      ),
    )
    if (data === null) return null
    const o = obj(data, 'membership')
    const clan = this.parseClan(obj(o.clans, 'clans'))
    const membersData = await withRetry(() =>
      unwrap(
        this.client
          .from('clan_members')
          .select('user_id, role, joined_at, profiles(username, level, avatar_path, avatar_key)')
          .eq('clan_id', clan.id)
          .order('joined_at'),
      ),
    )
    return {
      clan,
      role: oneOf(o, 'role', ['owner', 'member'] as const),
      members: arr(membersData).map((row) => {
        const m = obj(row, 'member')
        const p = obj(m.profiles, 'profiles')
        return {
          userId: str(m, 'user_id'),
          role: oneOf(m, 'role', ['owner', 'member'] as const),
          username: str(p, 'username'),
          level: num(p, 'level'),
          avatarUrl: this.profileAvatarUrl(strOrNull(p, 'avatar_path')),
          avatarKey: p.avatar_key === null || p.avatar_key === undefined ? null : oneOf(p, 'avatar_key', AVATAR_KEYS),
        }
      }),
    }
  }

  /** clan_page() (migration 017): the screen of the player's own clan; null — not in a clan. */
  async getClanPage(): Promise<ClanPage | null> {
    const data = await withRetry(() => unwrap(this.client.rpc('clan_page')))
    if (data === null) return null
    const o = obj(data, 'clan_page')
    const c = obj(o.clan, 'clan_page.clan')
    const week = obj(o.week, 'clan_page.week')
    const goal = obj(week.goal, 'clan_page.week.goal')
    const metrics = obj(o.metrics, 'clan_page.metrics')
    return {
      clan: {
        id: str(c, 'id'),
        name: str(c, 'name'),
        tag: str(c, 'tag'),
        ownerId: str(c, 'ownerId'),
        avatarUrl: this.clanAvatarUrl(strOrNull(c, 'avatarPath')),
        members: num(c, 'members'),
        maxMembers: num(c, 'maxMembers'),
      },
      week: {
        daysLeft: num(week, 'daysLeft'),
        goal: {
          target: num(goal, 'target'),
          progress: num(goal, 'progress'),
          districtId: strOrNull(goal, 'districtId'),
          districtName: strOrNull(goal, 'districtName'),
        },
      },
      members: arr(o.members, 'clan_page.members').map((row) => {
        const m = obj(row, 'clan_page.member')
        return {
          userId: str(m, 'userId'),
          username: str(m, 'username'),
          level: num(m, 'level'),
          role: oneOf(m, 'role', ['owner', 'member'] as const),
          avatarUrl: this.profileAvatarUrl(strOrNull(m, 'avatarPath')),
          avatarKey: m.avatarKey === null || m.avatarKey === undefined ? null : oneOf(m, 'avatarKey', AVATAR_KEYS),
          weekCells: num(m, 'weekCells'),
        }
      }),
      ownedDistrictIds: arr(o.ownedDistricts, 'clan_page.ownedDistricts').map((id) => {
        if (typeof id !== 'string') throw new ApiError('invalid_response', 'clan_page.ownedDistricts: expected strings')
        return id
      }),
      metrics: { level: num(metrics, 'level'), exploredCells: num(metrics, 'exploredCells'), discoveries: num(metrics, 'discoveries') },
      chronicle: arr(o.chronicle, 'clan_page.chronicle').map((row) => {
        const e = obj(row, 'clan_page.chronicle')
        const base = { at: str(e, 'at'), username: str(e, 'username') }
        return oneOf(e, 'kind', ['discovery', 'joined'] as const) === 'discovery'
          ? { kind: 'discovery' as const, ...base, buildingName: str(e, 'buildingName'), rarity: oneOf(e, 'rarity', RARITIES) }
          : { kind: 'joined' as const, ...base }
      }),
    }
  }

  private parsePerson(row: unknown, label: string): EventPerson {
    const o = obj(row, label)
    return {
      userId: str(o, 'userId'),
      username: str(o, 'username'),
      avatarUrl: this.profileAvatarUrl(strOrNull(o, 'avatarPath')),
      avatarKey: o.avatarKey === null || o.avatarKey === undefined ? null : oneOf(o, 'avatarKey', AVATAR_KEYS),
    }
  }

  private parseEvent(row: unknown): GameEvent {
    const o = obj(row, 'event')
    const cover = strOrNull(o, 'coverPath')
    return {
      id: str(o, 'id'),
      kind: oneOf(o, 'kind', EVENT_KINDS),
      title: str(o, 'title'),
      description: strOrNull(o, 'description'),
      lat: num(o, 'lat'),
      lng: num(o, 'lng'),
      placeName: strOrNull(o, 'placeName'),
      startsAt: str(o, 'startsAt'),
      maxParticipants: num(o, 'maxParticipants'),
      coverUrl: cover ? this.client.storage.from(EVENT_COVER_BUCKET).getPublicUrl(cover).data.publicUrl : null,
      participants: num(o, 'participants'),
      joined: bool(o, 'joined'),
      organizer: this.parsePerson(o.organizer, 'event.organizer'),
      faces: arr(o.faces, 'event.faces').map((f) => this.parsePerson(f, 'event.face')),
    }
  }

  /** events_feed() (migration 018): upcoming and running events, soonest first. */
  async getEvents(): Promise<GameEvent[]> {
    return arr(await withRetry(() => unwrap(this.client.rpc('events_feed'))), 'events').map((e) => this.parseEvent(e))
  }

  async getEvent(id: string): Promise<GameEvent> {
    return this.parseEvent(await withRetry(() => unwrap(this.client.rpc('event_page', { p_event_id: id }))))
  }

  /**
   * Uploads the cover (if any) to the creator's folder, then creates the event; the server validates
   * everything again (create_event). Returns the new event id.
   */
  async createEvent(userId: string, draft: EventDraft): Promise<string> {
    const bucket = this.client.storage.from(EVENT_COVER_BUCKET)
    let coverPath: string | null = null
    if (draft.cover) {
      coverPath = `${userId}/${crypto.randomUUID()}.${draft.cover.type === 'image/webp' ? 'webp' : 'jpg'}`
      const { error } = await bucket.upload(coverPath, draft.cover, { contentType: draft.cover.type, upsert: false, cacheControl: '31536000' })
      if (error) throw toApiError(error)
    }
    try {
      const id = await unwrap(
        this.client.rpc('create_event', {
          p_kind: draft.kind,
          p_title: draft.title,
          p_description: draft.description,
          p_lat: draft.lat,
          p_lng: draft.lng,
          p_starts_at: draft.startsAt.toISOString(),
          p_max_participants: draft.maxParticipants,
          p_cover_path: coverPath,
        }),
      )
      if (typeof id !== 'string') throw new ApiError('invalid_response', 'create_event: expected uuid')
      return id
    } catch (e) {
      if (coverPath) await bucket.remove([coverPath]) // no orphan
      throw e
    }
  }

  /** my_tasks() (migration 020): tasks of the day and week with live progress, and the seasonal task. */
  async getTasks(): Promise<TasksState> {
    const o = obj(await withRetry(() => unwrap(this.client.rpc('my_tasks'))), 'tasks')
    const s = o.season === null || o.season === undefined ? null : obj(o.season, 'tasks.season')
    return {
      dayEndsAt: str(obj(o.day, 'tasks.day'), 'endsAt'),
      weekEndsAt: str(obj(o.week, 'tasks.week'), 'endsAt'),
      tasks: arr(o.tasks, 'tasks.tasks').map((row) => {
        const t = obj(row, 'task')
        return {
          slug: str(t, 'slug'),
          period: oneOf(t, 'period', ['day', 'week'] as const),
          kind: oneOf(t, 'kind', TASK_KINDS),
          title: str(t, 'title'),
          target: num(t, 'target'),
          progress: num(t, 'progress'),
          rewardCoins: num(t, 'rewardCoins'),
          claimed: bool(t, 'claimed'),
        }
      }),
      season: s
        ? {
            id: str(s, 'id'),
            title: str(s, 'title'),
            description: str(s, 'description'),
            target: num(s, 'target'),
            progress: num(s, 'progress'),
            rewardCoins: num(s, 'rewardCoins'),
            endsAt: str(s, 'endsAt'),
            completed: bool(s, 'completed'),
            claimed: bool(s, 'claimed'),
          }
        : null,
    }
  }

  /** style_collections() (migration 021): style collections from OSM tags and found buildings per rarity. */
  async getStyleCollections(): Promise<StyleCollections> {
    const o = obj(await withRetry(() => unwrap(this.client.rpc('style_collections'))), 'style_collections')
    return {
      collections: arr(o.collections, 'style_collections.collections').map((row) => {
        const c = obj(row, 'style_collection')
        return { id: oneOf(c, 'id', STYLE_COLLECTIONS), collected: num(c, 'collected'), total: num(c, 'total') }
      }),
      rarity: arr(o.rarity, 'style_collections.rarity').map((row) => {
        const r = obj(row, 'rarity_count')
        return { rarity: oneOf(r, 'rarity', ['rare', 'epic', 'legendary'] as const), found: num(r, 'found'), total: num(r, 'total') }
      }),
    }
  }

  async getLandmarkCollections(): Promise<LandmarkCollection[]> {
    const rows = arr(await withRetry(() => unwrap(this.client.rpc('landmark_collections'))), 'landmark_collections')
    return rows.map((row) => {
      const c = obj(row, 'landmark_collection')
      return {
        id: str(c, 'id'),
        title: str(c, 'title'),
        items: arr(c.items, 'landmark_collection.items').map((item) => {
          const l = obj(item, 'landmark')
          return { id: str(l, 'id'), name: str(l, 'name'), marked: bool(l, 'marked') }
        }),
      }
    })
  }

  /** claim_task(): idempotent on the server (one claim per task and period). Returns the new coin balance. */
  async claimTask(slug: string): Promise<number> {
    const o = obj(await withRetry(() => unwrap(this.client.rpc('claim_task', { p_slug: slug }))), 'claim_task')
    return num(o, 'coins')
  }

  async joinEvent(id: string): Promise<void> {
    await unwrap(this.client.rpc('join_event', { p_event_id: id }))
  }

  async leaveEvent(id: string): Promise<void> {
    await unwrap(this.client.rpc('leave_event', { p_event_id: id }))
  }

  async createClan(name: string, tag: string): Promise<string> {
    const data = await unwrap(this.client.rpc('create_clan', { p_name: name, p_tag: tag }))
    if (typeof data !== 'string') throw new ApiError('invalid_response', 'create_clan: expected uuid')
    return data
  }

  async joinClan(clanId: string): Promise<void> {
    await unwrap(this.client.rpc('join_clan', { p_clan_id: clanId }))
  }

  async leaveClan(): Promise<void> {
    await unwrap(this.client.rpc('leave_clan'))
  }

  /**
   * Uploads a prepared (re-encoded, ≤512 KB) image as the clan avatar and makes it current.
   * Storage RLS and set_clan_avatar() both check that the caller owns the clan.
   */
  async setClanAvatar(clanId: string, image: Blob): Promise<void> {
    const ext = image.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${clanId}/${crypto.randomUUID()}.${ext}`
    const bucket = this.client.storage.from(CLAN_AVATAR_BUCKET)
    const { error } = await bucket.upload(path, image, { contentType: image.type, upsert: false, cacheControl: '31536000' })
    if (error) throw toApiError(error)
    let previous: unknown
    try {
      previous = await unwrap(this.client.rpc('set_clan_avatar', { p_path: path }))
    } catch (e) {
      await bucket.remove([path]) // don't leave an orphan behind
      throw e
    }
    // best effort: a leftover old file only costs storage
    if (typeof previous === 'string') await bucket.remove([previous])
  }

  async removeClanAvatar(): Promise<void> {
    const previous = await unwrap(this.client.rpc('set_clan_avatar', { p_path: null }))
    if (typeof previous === 'string') await this.client.storage.from(CLAN_AVATAR_BUCKET).remove([previous])
  }

  async getClanLeaderboard(districtId: string | null = null): Promise<ClanRanking[]> {
    const data = await withRetry(() =>
      unwrap(this.client.rpc('clan_leaderboard', { p_district_id: districtId, p_limit: 20 })),
    )
    return arr(data).map((row) => {
      const o = obj(row, 'clan_rank')
      return {
        clanId: str(o, 'clan_id'),
        name: str(o, 'name'),
        tag: str(o, 'tag'),
        avatarUrl: this.clanAvatarUrl(strOrNull(o, 'avatar_path')),
        members: num(o, 'members'),
        points: num(o, 'points'),
        rank: num(o, 'rank'),
      }
    })
  }

  async getDistrictLeaderboard(districtId: string): Promise<PlayerRanking[]> {
    const data = await withRetry(() =>
      unwrap(this.client.rpc('district_leaderboard', { p_district_id: districtId, p_limit: 20 })),
    )
    return arr(data).map((row) => {
      const o = obj(row, 'player_rank')
      return {
        userId: str(o, 'user_id'),
        username: str(o, 'username'),
        level: num(o, 'level'),
        points: num(o, 'points'),
        rank: num(o, 'rank'),
      }
    })
  }
}
