import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExplorationResult } from '../exploration/explorationTracker'
import type { Cell } from '../exploration/grid'
import type { TrackPoint } from '../exploration/trackFilter'
import type { CandidateMatcher, RecognitionCandidate } from '../recognition/types'
import {
  AVATAR_KEYS,
  type AdminGameInfo,
  type AvatarKey,
  type Bbox,
  type BuildingOutline,
  type GameBuildingDraft,
  type GameBuildingStatus,
  type OutlineGameInfo,
  type OutlinesPage,
  type PlayerProgress,
  type ClaimResult,
  type Clan,
  type ClanMembership,
  type ClanRanking,
  type CollectionItem,
  type DistrictOverview,
  type MapBuilding,
  type PlayerRanking,
  type Profile,
  type ProfileStats,
  type QuestView,
  type Rarity,
  type ScanDecision,
  type ScanRejectReason,
  type ScanSubmission,
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
          .select('user_id, role, joined_at, profiles(username, level)')
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
        }
      }),
    }
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
