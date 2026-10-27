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


/**
 * The place tags (mockup Теги.png, 2026-10-28): the coloured badge on a place card (mockup
 * Location_Gallery) and the category chips of the map, the locations and the places list — one kind per
 * place, so a chip shows exactly the places whose card has that badge.
 */
export type PlaceKind = 'fun' | 'nature' | 'history' | 'sport' | 'food' | 'hotel'
/** on a card: one place */
export const KIND_BADGE: Record<PlaceKind, string> = {
  fun: 'Развлечения',
  nature: 'Природа',
  history: 'История',
  sport: 'Спорт',
  food: 'Ресторан',
  hotel: 'Отель',
}
/** the chips, in the order of Теги.png */
export const PLACE_CHIPS: (ChipItem & { id: PlaceKind })[] = [
  { id: 'fun', label: 'Развлечения', tone: 'fun', icon: true },
  { id: 'nature', label: 'Природа', tone: 'nature', icon: true },
  { id: 'history', label: 'История', tone: 'history', icon: true },
  { id: 'sport', label: 'Спорт', tone: 'sport', icon: true },
  { id: 'food', label: 'Рестораны', tone: 'food', icon: true },
  { id: 'hotel', label: 'Отели', tone: 'hotel', icon: true },
]
/** the category chosen on the map: kept for the app session, so it survives a visit to a place page */
export const mapCategory = ref<PlaceKind | null>(null)

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
  'zav-golf': { kind: 'sport', type: 'Гольф-клуб' },
  'zav-tennis': { kind: 'sport', type: 'Теннис' },
  'zav-basketball': { kind: 'sport', type: 'Баскетбол' },
  'zav-football': { kind: 'sport', type: 'Футбол' },
  'zav-minigolf': { kind: 'sport', type: 'Мини-гольф' },
  'zav-toboggan': { kind: 'sport', type: 'Тюбинг' },
  'zav-fishing': { kind: 'sport', type: 'Рыбалка' },
  'zav-water-rental': { kind: 'sport', type: 'Прокат' },
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
  if (tags.includes('sport')) return 'sport'
  if (tags.includes('kids')) return 'fun'
  return 'nature'
}

/** whether the place is of the chosen kind (no kind chosen: every place) */
export const ofKind = (p: AreaPlace, kind: PlaceKind | null) => !kind || placeBadges(p).kind === kind

export function placeBadges(p: AreaPlace): { kind: PlaceKind; label: string; type: string | null } {
  const known = PLACE_BADGES[p.id]
  const kind = known?.kind ?? kindFromTags(p.tags)
  return { kind, label: KIND_BADGE[kind], type: known?.type ?? null }
}

export const doneCount = (r: QuestRoute) => r.steps.filter((s) => s.doneAt).length
/** the step the app suggests next: the first one not done, in route order */
export const nextStep = (r: QuestRoute) => r.steps.find((s) => !s.doneAt) ?? null

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
