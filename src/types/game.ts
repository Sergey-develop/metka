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

/**
 * Facts about one OSM building for the info card. Every field comes from OSM tags or the game
 * catalog as stored; null means "not in the data", never a guess.
 */
export interface BuildingFacts {
  osmBuildingId: number
  osmType: 'node' | 'way' | 'relation'
  osmId: number
  name: string | null
  address: string | null
  /** human label of the building type ("Жилой дом", "Школа"), null when OSM only says building=yes */
  kind: string | null
  levels: number | null
  /** OSM start_date as written (a year or a date) */
  built: string | null
  /** standard design series (design:ref), e.g. "П44-1/17" */
  series: string | null
  flats: number | null
  /** contacts/hours tagged on the building itself (when the building is the organisation) */
  openingHours: string | null
  phone: string | null
  website: string | null
  wikidataId: string | null
  /** last import that changed this building's data */
  updatedAt: string
}

/** An organisation located in a building (osm_pois, linked only by footprint or explicit tag). */
export interface BuildingOrganization {
  id: number
  name: string
  /** human label ("Кафе", "Аптека") or null when the OSM kind is unknown to us */
  kind: string | null
  openingHours: string | null
  phone: string | null
  website: string | null
  /** how the link to the building was established */
  link: 'inside_footprint' | 'explicit'
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
  /** in joining order */
  members: {
    userId: string
    username: string
    level: number
    role: 'owner' | 'member'
    /** public URL of the uploaded avatar; takes precedence over avatarKey */
    avatarUrl: string | null
    avatarKey: AvatarKey | null
  }[]
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

/**
 * player_public_profile() (migration 019): another player's profile, clanmates only.
 * No coins, memories, favourites or photos — those stay private.
 */
export interface PublicProfile {
  profile: {
    id: string
    username: string
    avatarUrl: string | null
    avatarKey: AvatarKey | null
    level: number
    xp: number
    buildingsDiscovered: number
    homeDistrictId: string | null
  }
  stats: PlayerStats
  progress: Omit<PlayerProgress, 'memories' | 'favoritePlaces'>
  /** district id → buildings this player found there */
  discoveredByDistrict: Record<string, number>
  achievements: Pick<QuestView, 'id' | 'slug' | 'title' | 'description' | 'kind' | 'target' | 'progress' | 'completedAt'>[]
  /** rarest first; catalog pictures only */
  bestFinds: { buildingId: string; name: string; rarity: Rarity; imageUrl: string | null }[]
}

export const TASK_KINDS = ['discover', 'cells', 'rare', 'memory', 'districts'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

/** A task of the day or week (migration 020); progress is counted on the server for the current period. */
export interface GameTask {
  slug: string
  period: 'day' | 'week'
  kind: TaskKind
  title: string
  target: number
  /** capped at target */
  progress: number
  rewardCoins: number
  claimed: boolean
}

/** my_tasks(): the tasks sheet on the map */
export interface TasksState {
  dayEndsAt: string
  weekEndsAt: string
  tasks: GameTask[]
  /** the active server quest with an end date (claimed through claim_quest_reward); null — no season now */
  season: {
    id: string
    title: string
    description: string
    target: number
    progress: number
    rewardCoins: number
    endsAt: string
    completed: boolean
    claimed: boolean
  } | null
}

export const STYLE_COLLECTIONS = ['constructivism', 'stalinist', 'water_tower'] as const
export type StyleCollectionId = (typeof STYLE_COLLECTIONS)[number]

/** style_collections() (migration 021): OSM buildings of a style the player walked past; rarity counts. */
export interface StyleCollections {
  collections: { id: StyleCollectionId; collected: number; total: number }[]
  rarity: { rarity: Exclude<Rarity, 'common'>; found: number; total: number }[]
}

/** landmark_collections() (migration 023): curated places the player marks on site */
export interface LandmarkCollection {
  id: string
  title: string
  items: { id: string; name: string; marked: boolean }[]
}

export const EVENT_KINDS = ['run', 'walk', 'reading', 'cleanup'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export interface EventPerson {
  userId: string
  username: string
  avatarUrl: string | null
  avatarKey: AvatarKey | null
}

/** A player event (migration 018): events_feed() / event_page(). */
export interface GameEvent {
  id: string
  kind: EventKind
  title: string
  description: string | null
  lat: number
  lng: number
  /** address of the nearest building, derived on the server; null — just a point on the map */
  placeName: string | null
  startsAt: string
  maxParticipants: number
  /** public URL of the uploaded cover; null — the kind's illustration */
  coverUrl: string | null
  /** includes the organizer */
  participants: number
  joined: boolean
  organizer: EventPerson
  /** first participants in joining order (4 in the feed, 8 on the event page) */
  faces: EventPerson[]
}

export interface EventDraft {
  kind: EventKind
  title: string
  description: string
  lat: number
  lng: number
  startsAt: Date
  maxParticipants: number
  /** re-encoded picture (EXIF stripped); null — no cover */
  cover: Blob | null
}

/** clan_page(): the clan screen of the player's own clan; every number is counted on the server. */
export interface ClanPage {
  clan: Clan & { members: number; maxMembers: number }
  week: {
    /** days left in the Moscow week, today included (Monday 7 … Sunday 1) */
    daysLeft: number
    /** cells opened this week in the owner's home district (null — anywhere) */
    goal: { target: number; progress: number; districtId: string | null; districtName: string | null }
  }
  /** in joining order */
  members: {
    userId: string
    username: string
    level: number
    role: 'owner' | 'member'
    avatarUrl: string | null
    avatarKey: AvatarKey | null
    /** cells opened this week, anywhere */
    weekCells: number
  }[]
  ownedDistrictIds: string[]
  metrics: { level: number; exploredCells: number; discoveries: number }
  /** newest first */
  chronicle: (
    | { kind: 'discovery'; at: string; username: string; buildingName: string; rarity: Rarity }
    | { kind: 'joined'; at: string; username: string }
  )[]
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
  createdAt: string
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

/** player_stats() (migration 015): profile numbers counted on the server; see the migration for definitions. */
export interface PlayerStats {
  /** Moscow calendar day on the server, YYYY-MM-DD */
  today: string
  streakDays: number
  /** active days of the last 84, ascending, YYYY-MM-DD */
  activeDays: string[]
  streets: { visited: number; total: number; scope: 'home' | 'all' }
  /** null — not in a clan */
  clan: { level: number; discoveries: number } | null
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
