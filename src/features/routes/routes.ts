import { ref } from 'vue'
import type { ChipItem } from '@/components/ui/CategoryChips.vue'
import type { AreaPlace, MapBuilding, PlaceTag, PlaceZone, QuestRoute, StepKind } from '@/types/game'
import { placePhoto } from './photos'

export const ZONE_TITLE: Record<PlaceZone, string> = {
  bay: 'Набережная и бухта',
  forest: '«Ямской лес»',
  village: 'Историческое село Завидово',
  resort: 'Ещё на курорте',
}

/** the category chips of the map and the places list (area_places.tags, migration 027) */
export const PLACE_CHIPS: (ChipItem & { id: PlaceTag })[] = [
  { id: 'sport', label: 'Спорт', tone: 'sport', icon: 'runner' },
  { id: 'culture', label: 'Культура', tone: 'culture', icon: 'cap' },
  { id: 'kids', label: 'С детьми', tone: 'kids', icon: 'people' },
  { id: 'free', label: 'Бесплатно', tone: 'free' },
  { id: 'food', label: 'Еда', tone: 'food' },
  { id: 'rest', label: 'Отдых', tone: 'rest' },
]
/** the category chosen on the map: kept for the app session, so it survives a visit to a place page */
export const mapCategory = ref<PlaceTag | null>(null)

export const TAG_LABEL = Object.fromEntries(PLACE_CHIPS.map((c) => [c.id, c.label])) as Record<PlaceTag, string>

export const KIND_LABEL: Record<StepKind, string> = {
  checkin: 'Чек-ин',
  photo: 'Фото',
  question: 'Вопрос',
}

export const doneCount = (r: QuestRoute) => r.steps.filter((s) => s.doneAt).length
/** the step the app suggests next: the first one not done, in route order */
export const nextStep = (r: QuestRoute) => r.steps.find((s) => !s.doneAt) ?? null
export const stepsXp = (r: QuestRoute) => r.steps.reduce((sum, s) => sum + s.rewardXp, 0)

/** a place shaped as a route target (the walking route and its map card take a game building) */
export function placeTarget(p: AreaPlace & { lat: number; lng: number }): MapBuilding {
  return {
    id: `place:${p.id}`,
    slug: p.id,
    name: p.name,
    description: p.description,
    address: p.address,
    districtId: null,
    lat: p.lat,
    lng: p.lng,
    scanRadiusM: p.radiusM,
    rarity: 'common',
    reward: { xp: 0, coins: 0, influence: 0 },
    imageUrl: placePhoto(p),
    isDevSeed: false,
    discoveredAt: null,
  }
}

export const hasPoint = (p: AreaPlace | null): p is AreaPlace & { lat: number; lng: number } =>
  p !== null && p.lat !== null && p.lng !== null
