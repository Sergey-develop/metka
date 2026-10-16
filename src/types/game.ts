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
