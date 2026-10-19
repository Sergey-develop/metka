export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface LngLat {
  lat: number
  lng: number
}

export interface Bbox {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

export interface MapBuilding extends LngLat {
  id: string
  slug: string
  name: string
  description: string | null
  address: string | null
  districtId: string | null
  scanRadiusM: number
  rarity: Rarity
  reward: { xp: number; coins: number; influence: number }
  imageUrl: string | null
  isDevSeed: boolean
  discoveredAt: string | null
}

export type GameBuildingStatus = 'draft' | 'published' | 'unavailable' | 'hidden'

/** Game catalog entry attached to an OSM footprint (players only ever see published/unavailable). */
export interface OutlineGameInfo {
  id: string
  status: GameBuildingStatus
  name: string
  description: string | null
  category: string | null
  rarity: Rarity
  imageUrl: string | null
  discoveredAt: string | null
}

/** Admin-only fields of the same catalog entry. */
export interface AdminGameInfo extends OutlineGameInfo {
  reward: { xp: number; coins: number; influence: number }
  scanRadiusM: number
  unlockConditions: Record<string, unknown>
}

/** A building footprint from osm_buildings (map layer B) with its game state (layer C), if any. */
export interface BuildingOutline<G extends OutlineGameInfo = OutlineGameInfo> {
  /** osm_buildings.id */
  id: number
  osmType: 'node' | 'way' | 'relation'
  osmId: number
  /** Point only for buildings mapped as a single OSM node */
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Point
  name: string | null
  address: string | null
  category: string | null
  game: G | null
}

export interface OutlinesPage<G extends OutlineGameInfo = OutlineGameInfo> {
  features: BuildingOutline<G>[]
  /** server dropped plain footprints to stay under the limit (game buildings are always kept) */
  truncated: boolean
}

/** Editable catalog fields (admin_save_game_building); omitted keys are left unchanged. */
export interface GameBuildingDraft {
  name?: string
  description?: string | null
  category?: string | null
  rarity?: Rarity
  imageUrl?: string | null
  unlockConditions?: Record<string, unknown>
  rewardXp?: number
  rewardCoins?: number
  rewardInfluence?: number
  scanRadiusM?: number
}

export interface DistrictOverview {
  id: string
  slug: string
  name: string
  shortName: string
  boundary: GeoJSON.MultiPolygon
  totalBuildings: number
  discoveredBuildings: number
  myInfluence: number
}

export const AVATAR_KEYS = ['runner', 'scooter', 'skater', 'cyclist'] as const
export type AvatarKey = (typeof AVATAR_KEYS)[number]

export interface Profile {
  id: string
  username: string
  /** public URL of the uploaded avatar; takes precedence over avatarKey */
  avatarUrl: string | null
  /** preset brand pictogram; see src/components/ui/figures.ts */
  avatarKey: AvatarKey | null
  /** registration step "game profile" done (nickname + avatar chosen) */
  setupCompleted: boolean
  level: number
  xp: number
  coins: number
  buildingsDiscovered: number
  homeDistrictId: string | null
}

export type ProfileStats = Pick<Profile, 'level' | 'xp' | 'coins' | 'buildingsDiscovered'>

export type ScanRejectReason =
  | 'rate_limited'
  | 'invalid_location'
  | 'building_not_found'
  | 'location_inaccurate'
  | 'too_far'
  | 'recognition_unavailable'
  | 'invalid_embedding'
  | 'invalid_request'
  | 'duplicate_image'
  | 'suspicious_embedding'
  | 'other_building'
  | 'not_recognized'
  | 'ambiguous'

export interface ScanSubmission {
  clientRequestId: string
  buildingId: string
  lat: number
  lng: number
  accuracyM: number
  modelVersion: string
  embedding: Float32Array
  imageSha256: string | null
  quality: { blurScore: number; brightness: number } | null
}

/** Server verdict. Only this decides whether a building was discovered. */
export interface ScanDecision {
  scanId: string
  status: 'accepted' | 'rejected' | 'already_discovered'
  reason: ScanRejectReason | null
  duplicate: boolean
  buildingId: string | null
  distanceM: number | null
  reward: { xp: number; coins: number; influence: number } | null
  completedQuests: { questId: string; slug: string; title: string }[]
  profile: ProfileStats | null
}

export interface CollectionItem {
  buildingId: string
  name: string
  rarity: Rarity
  imageUrl: string | null
  districtId: string | null
  discoveredAt: string
  /** the player's own photo from the unlocking scan (private Storage path) */
  photoPath: string | null
}

export type QuestKind = 'discover_count' | 'discover_in_district' | 'discover_rarity'

export interface QuestView {
  id: string
  slug: string
  title: string
  description: string
  kind: QuestKind
  target: number
  progress: number
  reward: { xp: number; coins: number }
  completedAt: string | null
  claimedAt: string | null
  endsAt: string | null
}

export interface ClaimResult {
  status: 'claimed' | 'already_claimed'
  questId: string
  profile: ProfileStats | null
}

export interface Clan {
  id: string
  name: string
  tag: string
  ownerId: string
  /** public URL of the uploaded clan avatar */
  avatarUrl: string | null
}

export interface ClanMembership {
  clan: Clan
  role: 'owner' | 'member'
  members: { userId: string; username: string; level: number; role: 'owner' | 'member' }[]
}

export interface ClanRanking {
  clanId: string
  name: string
  tag: string
  avatarUrl: string | null
  members: number
  points: number
  rank: number
}

export interface PlayerRanking {
  userId: string
  username: string
  level: number
  points: number
  rank: number
}

/** Sticker on a memory: liked = blue, wow = pink, meh = black-and-white (favourite = heart, separate). */
export type Impression = 'liked' | 'wow' | 'meh'

/** The player's own memory of an unlocked building (album). Not a building, not territory. */
export interface Memory {
  id: string
  buildingId: string
  buildingName: string
  address: string | null
  rarity: Rarity
  note: string | null
  /** YYYY-MM-DD */
  visitedOn: string | null
  impression: Impression | null
  isFavorite: boolean
  /** private Storage path; display via signed URL */
  photoPath: string | null
  updatedAt: string
}

export interface MemoryDraft {
  buildingId: string
  note: string
  visitedOn: string | null
  impression: Impression | null
  isFavorite: boolean
  /** new photo to upload (already picked by the player) */
  photo?: Blob | null
  /** drop the current photo */
  removePhoto?: boolean
}

/** player_progress(): each number comes from its own table. */
export interface PlayerProgress {
  exploredCells: number
  exploredDistricts: number
  districtMinCells: number
  unlockedBuildings: number
  memories: number
  favoritePlaces: number
}
