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

/** the coloured badge on a location card (mockup Location_Gallery, 2026-10-27) */
export type PlaceKind = 'fun' | 'nature' | 'history' | 'food' | 'hotel'
export const KIND_BADGE: Record<PlaceKind, string> = {
  fun: 'Развлечения',
  nature: 'Природа',
  history: 'История',
  food: 'Ресторан',
  hotel: 'Отель',
}

/** kind and the white «type» badge next to it, per place; the mockup's own words where it shows the place */
const PLACE_BADGES: Record<string, { kind: PlaceKind; type: string }> = {
  'zav-bay': { kind: 'nature', type: 'Прогулки' },
  'zav-embankment': { kind: 'nature', type: 'Прогулки' },
  'zav-bridge': { kind: 'nature', type: 'Прогулки' },
  'zav-beach': { kind: 'nature', type: 'Отдых' },
  'zav-sloboda-lake': { kind: 'nature', type: 'Прогулки' },
  'zav-ant-trail': { kind: 'nature', type: 'Тропа' },
  'zav-ant-trail-start': { kind: 'nature', type: 'Тропа' },
  'zav-camping': { kind: 'nature', type: 'Кемпинг' },
  'zav-tsarevna': { kind: 'food', type: 'Отдых' },
  'zav-traktir': { kind: 'food', type: 'Отдых' },
  'zav-syrzavod': { kind: 'food', type: 'Отдых' },
  'zav-zhukovka': { kind: 'food', type: 'Отдых' },
  'zav-krym': { kind: 'food', type: 'Отдых' },
  'zav-barhan': { kind: 'food', type: 'Кафе' },
  'zav-gastrobar': { kind: 'food', type: 'Бар' },
  'zav-yacht-club': { kind: 'fun', type: 'Яхт-клуб' },
  'zav-meridian': { kind: 'fun', type: 'Яхт-клуб' },
  'zav-river-port': { kind: 'fun', type: 'Речной порт' },
  'zav-golf': { kind: 'fun', type: 'Гольф-клуб' },
  'zav-tennis': { kind: 'fun', type: 'Теннис' },
  'zav-basketball': { kind: 'fun', type: 'Баскетбол' },
  'zav-football': { kind: 'fun', type: 'Футбол' },
  'zav-minigolf': { kind: 'fun', type: 'Мини-гольф' },
  'zav-toboggan': { kind: 'fun', type: 'Тюбинг' },
  'zav-fishing': { kind: 'fun', type: 'Рыбалка' },
  'zav-water-rental': { kind: 'fun', type: 'Прокат' },
  'zav-aqua-spa': { kind: 'fun', type: 'Аквапарк' },
  'zav-banya': { kind: 'fun', type: 'Баня' },
  'zav-alpaca': { kind: 'fun', type: 'Парк альпак' },
  'zav-evrika': { kind: 'fun', type: 'Мастерские' },
  'zav-tent': { kind: 'fun', type: 'Мероприятия' },
  'zav-memorial': { kind: 'history', type: 'Памятник' },
  'zav-radisson': { kind: 'hotel', type: 'Отдых' },
  'zav-radisson-residences': { kind: 'hotel', type: 'Апартаменты' },
  'zav-yamskaya': { kind: 'hotel', type: 'Отдых' },
  'zav-spa-village': { kind: 'hotel', type: 'Спа' },
}

/** a place not listed above (added later in the database) still gets a kind from its tags */
function kindFromTags(tags: readonly PlaceTag[]): PlaceKind {
  if (tags.includes('food')) return 'food'
  if (tags.includes('culture')) return 'history'
  if (tags.includes('sport') || tags.includes('kids')) return 'fun'
  return 'nature'
}

export function placeBadges(p: AreaPlace): { kind: PlaceKind; label: string; type: string | null } {
  const known = PLACE_BADGES[p.id]
  const kind = known?.kind ?? kindFromTags(p.tags)
  return { kind, label: KIND_BADGE[kind], type: known?.type ?? null }
}

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
