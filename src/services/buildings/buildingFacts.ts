import type { BuildingFacts, BuildingOrganization } from '@/types/game'

/**
 * Turns an osm_buildings row into card facts. Only tags that OSM actually has are used;
 * unknown or malformed values become null instead of being guessed.
 */

const BUILDING_KINDS: Record<string, string> = {
  apartments: 'Жилой дом',
  residential: 'Жилой дом',
  dormitory: 'Общежитие',
  house: 'Частный дом',
  detached: 'Частный дом',
  commercial: 'Коммерческое здание',
  retail: 'Торговое здание',
  office: 'Офисное здание',
  industrial: 'Промышленное здание',
  warehouse: 'Склад',
  school: 'Школа',
  kindergarten: 'Детский сад',
  university: 'Университет',
  college: 'Колледж',
  hospital: 'Больница',
  church: 'Храм',
  cathedral: 'Собор',
  chapel: 'Часовня',
  mosque: 'Мечеть',
  public: 'Общественное здание',
  civic: 'Общественное здание',
  government: 'Административное здание',
  hotel: 'Гостиница',
  train_station: 'Вокзал',
  transportation: 'Транспортное здание',
  sports_hall: 'Спортивный зал',
  stadium: 'Стадион',
  garage: 'Гараж',
  garages: 'Гаражи',
  parking: 'Паркинг',
  service: 'Техническое здание',
  construction: 'Строится',
  supermarket: 'Супермаркет',
}

/** amenity/shop/office/… values, shared with organisations (osm_pois) */
export const PLACE_KINDS: Record<string, string> = {
  cafe: 'Кафе',
  restaurant: 'Ресторан',
  fast_food: 'Фастфуд',
  bar: 'Бар',
  pub: 'Паб',
  pharmacy: 'Аптека',
  bank: 'Банк',
  atm: 'Банкомат',
  post_office: 'Почта',
  clinic: 'Поликлиника',
  doctors: 'Врач',
  dentist: 'Стоматология',
  hospital: 'Больница',
  school: 'Школа',
  kindergarten: 'Детский сад',
  music_school: 'Музыкальная школа',
  library: 'Библиотека',
  theatre: 'Театр',
  cinema: 'Кинотеатр',
  community_centre: 'Культурный центр',
  place_of_worship: 'Храм',
  police: 'Полиция',
  townhall: 'Администрация',
  veterinary: 'Ветклиника',
  fuel: 'АЗС',
  supermarket: 'Супермаркет',
  convenience: 'Продукты',
  bakery: 'Пекарня',
  butcher: 'Мясная лавка',
  clothes: 'Одежда',
  shoes: 'Обувь',
  hairdresser: 'Парикмахерская',
  beauty: 'Салон красоты',
  florist: 'Цветы',
  books: 'Книги',
  electronics: 'Электроника',
  mobile_phone: 'Салон связи',
  hardware: 'Хозтовары',
  optician: 'Оптика',
  alcohol: 'Алкоголь',
  pet: 'Зоотовары',
  laundry: 'Прачечная',
  dry_cleaning: 'Химчистка',
  car_repair: 'Автосервис',
  kiosk: 'Киоск',
  company: 'Офис компании',
  government: 'Госучреждение',
  estate_agent: 'Агентство недвижимости',
  insurance: 'Страхование',
  it: 'IT-компания',
  hotel: 'Гостиница',
  museum: 'Музей',
  fitness_centre: 'Фитнес-клуб',
  sports_centre: 'Спортивный центр',
}

function tag(tags: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = tags[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return null
}

function positiveInt(value: string | null, max: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const n = Number(value)
  return n > 0 && n <= max ? n : null
}

/** Only http(s) links; anything else (javascript:, bare words) is dropped. */
export function safeWebsite(value: string | null): string | null {
  if (!value) return null
  const url = /^https?:\/\//i.test(value) ? value : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value) ? `https://${value}` : null
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

/** Kind label from OSM tags: a known amenity/shop wins over the building type. */
export function kindLabel(tags: Record<string, unknown>): string | null {
  for (const key of ['amenity', 'shop', 'office', 'tourism', 'leisure', 'craft']) {
    const v = tag(tags, key)
    if (v && PLACE_KINDS[v]) return PLACE_KINDS[v]
  }
  const building = tag(tags, 'building')
  return building ? (BUILDING_KINDS[building] ?? null) : null
}

export interface OsmBuildingRow {
  id: number
  osm_type: 'node' | 'way' | 'relation'
  osm_id: number
  name: string | null
  address: string | null
  tags: Record<string, unknown>
  updated_at: string
}

export function factsFromOsm(row: OsmBuildingRow): BuildingFacts {
  const t = row.tags
  const wikidata = tag(t, 'wikidata')
  return {
    osmBuildingId: row.id,
    osmType: row.osm_type,
    osmId: row.osm_id,
    name: row.name,
    address: row.address,
    kind: kindLabel(t),
    levels: positiveInt(tag(t, 'building:levels'), 200),
    built: tag(t, 'start_date'),
    series: tag(t, 'design:ref'),
    flats: positiveInt(tag(t, 'building:flats'), 10_000),
    openingHours: tag(t, 'opening_hours'),
    phone: tag(t, 'contact:phone', 'phone'),
    website: safeWebsite(tag(t, 'contact:website', 'website')),
    wikidataId: wikidata && /^Q\d+$/.test(wikidata) ? wikidata : null,
    updatedAt: row.updated_at,
  }
}

export function organizationFromOsm(row: {
  id: number
  name: string
  kindValue: string
  tags: Record<string, unknown>
  link: BuildingOrganization['link']
}): BuildingOrganization {
  return {
    id: row.id,
    name: row.name,
    kind: PLACE_KINDS[row.kindValue] ?? null,
    openingHours: tag(row.tags, 'opening_hours'),
    phone: tag(row.tags, 'contact:phone', 'phone'),
    website: safeWebsite(tag(row.tags, 'contact:website', 'website')),
    link: row.link,
  }
}
