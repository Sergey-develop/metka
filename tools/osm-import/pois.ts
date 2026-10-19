/**
 * Organisations (shops, cafés, offices, …) from an Overpass response. Pure; I/O lives in
 * fetch-pois.ts / import-pois.ts. Only named nodes of useful kinds are kept; the explicit link to
 * a building (node is a vertex of a building way) is passed on as hostWayIds, the server decides.
 */

export type PoiKindKey = 'amenity' | 'shop' | 'office' | 'craft' | 'healthcare' | 'tourism' | 'leisure'

/** Payload item of the import_osm_pois RPC. */
export interface OsmPoiInput {
  osmType: 'node'
  osmId: number
  lng: number
  lat: number
  name: string
  kindKey: PoiKindKey
  kindValue: string
  tags: Record<string, string>
  hostWayIds: number[]
}

export type PoiSkipReason = 'no_name' | 'not_an_organisation' | 'invalid_coordinates' | 'invalid_id'

export interface SkippedPoi {
  osmId: number | null
  reason: PoiSkipReason
}

/** amenity/tourism/leisure values that are places people visit; benches, parking, bins are not. */
const AMENITY = new Set([
  'cafe', 'restaurant', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'pharmacy', 'bank', 'bureau_de_change',
  'post_office', 'clinic', 'doctors', 'dentist', 'hospital', 'school', 'kindergarten', 'music_school', 'language_school',
  'driving_school', 'college', 'university', 'library', 'theatre', 'cinema', 'arts_centre', 'community_centre',
  'place_of_worship', 'police', 'townhall', 'courthouse', 'veterinary', 'nightclub', 'coworking_space', 'childcare',
  'social_facility', 'marketplace', 'internet_cafe', 'car_wash', 'fuel',
])
const TOURISM = new Set(['hotel', 'hostel', 'guest_house', 'apartment', 'museum', 'gallery'])
const LEISURE = new Set(['fitness_centre', 'sports_centre', 'dance', 'bowling_alley', 'escape_game', 'sauna'])
const ANY_VALUE: PoiKindKey[] = ['shop', 'office', 'craft', 'healthcare']
const NOT_A_BUSINESS = new Set(['no', 'vacant', 'disused', 'yes;no'])
const KEY_ORDER: PoiKindKey[] = ['amenity', 'shop', 'office', 'craft', 'healthcare', 'tourism', 'leisure']

const KIND_VALUE_RE = /^[a-z0-9_;:-]{1,64}$/

export function poisQuery(bbox: { south: number; west: number; north: number; east: number }): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  const nodes = KEY_ORDER.map((k) => `node["${k}"]["name"](${b});`).join('')
  // POI nodes, then the building ways that use them as vertices (explicit link)
  return `[out:json][timeout:120];(${nodes});out body;way(bn)["building"];out skel;`
}

function kindOf(tags: Record<string, string>): { key: PoiKindKey; value: string } | null {
  for (const key of KEY_ORDER) {
    const value = tags[key]
    if (!value || NOT_A_BUSINESS.has(value) || !KIND_VALUE_RE.test(value)) continue
    if (ANY_VALUE.includes(key)) return { key, value }
    if (key === 'amenity' && AMENITY.has(value)) return { key, value }
    if (key === 'tourism' && TOURISM.has(value)) return { key, value }
    if (key === 'leisure' && LEISURE.has(value)) return { key, value }
  }
  return null
}

function cleanTags(raw: unknown): Record<string, string> {
  const tags: Record<string, string> = {}
  if (typeof raw !== 'object' || raw === null) return tags
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && k.length <= 255 && v.length <= 255) tags[k] = v
  }
  return tags
}

interface Element {
  type?: unknown
  id?: unknown
  lat?: unknown
  lon?: unknown
  tags?: unknown
  nodes?: unknown
}

export function overpassToPois(response: unknown): { items: OsmPoiInput[]; skipped: SkippedPoi[] } {
  const elements =
    typeof response === 'object' && response !== null && Array.isArray((response as { elements?: unknown }).elements)
      ? (response as { elements: Element[] }).elements
      : null
  if (!elements) throw new Error('expected an Overpass JSON response with "elements"')

  const hosts = new Map<number, number[]>()
  for (const el of elements) {
    if (el.type !== 'way' || typeof el.id !== 'number' || !Array.isArray(el.nodes)) continue
    for (const n of el.nodes) {
      if (typeof n !== 'number') continue
      const list = hosts.get(n) ?? []
      if (!list.includes(el.id)) list.push(el.id)
      hosts.set(n, list)
    }
  }

  const items: OsmPoiInput[] = []
  const skipped: SkippedPoi[] = []
  const seen = new Set<number>()
  for (const el of elements) {
    if (el.type !== 'node') continue
    const id = typeof el.id === 'number' && Number.isSafeInteger(el.id) && el.id > 0 ? el.id : null
    if (id === null) {
      skipped.push({ osmId: null, reason: 'invalid_id' })
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    const lat = el.lat
    const lng = el.lon
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      skipped.push({ osmId: id, reason: 'invalid_coordinates' })
      continue
    }
    const tags = cleanTags(el.tags)
    const name = (tags['name:ru'] ?? tags.name ?? '').trim()
    if (!name) {
      skipped.push({ osmId: id, reason: 'no_name' })
      continue
    }
    const kind = kindOf(tags)
    if (!kind) {
      skipped.push({ osmId: id, reason: 'not_an_organisation' })
      continue
    }
    items.push({
      osmType: 'node',
      osmId: id,
      lng,
      lat,
      name: name.slice(0, 300),
      kindKey: kind.key,
      kindValue: kind.value,
      tags,
      hostWayIds: hosts.get(id) ?? [],
    })
  }
  return { items, skipped }
}
