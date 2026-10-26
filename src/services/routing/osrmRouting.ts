import type { LngLat } from '@/types/game'
import type { LngLatPair } from '@/services/map/types'
import { distanceMeters } from '@/utils/geo'
import { RoutingError, type RoutingService, type WalkingRoute } from './types'

/**
 * FOSSGIS public OSRM with the foot profile (OSM data, CORS open, no key). Fair use only:
 * a public release needs our own OSRM or a paid router (the Yandex key refuses route requests).
 */
export const FOSSGIS_FOOT_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot'

/** a walk longer than this is not a walk: refuse before asking the server */
export const MAX_WALK_M = 30_000

const isPair = (v: unknown): v is LngLatPair =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number'

/** Parses an OSRM /route response (geometries=geojson); throws RoutingError on anything unexpected. */
export function parseOsrmRoute(body: unknown): WalkingRoute {
  const res = body as { code?: unknown; routes?: unknown } | null
  if (!res || typeof res !== 'object') throw new RoutingError('unavailable', 'bad response')
  if (res.code === 'NoRoute' || res.code === 'NoSegment') throw new RoutingError('no_route')
  if (res.code !== 'Ok' || !Array.isArray(res.routes) || res.routes.length === 0) throw new RoutingError('unavailable', String(res.code))
  const route = res.routes[0] as { distance?: unknown; duration?: unknown; geometry?: { coordinates?: unknown } }
  const coords = route.geometry?.coordinates
  if (typeof route.distance !== 'number' || typeof route.duration !== 'number' || !Array.isArray(coords)) {
    throw new RoutingError('unavailable', 'bad route')
  }
  const path = coords.filter(isPair).map(([lng, lat]): LngLatPair => [lng, lat])
  if (path.length < 2) throw new RoutingError('no_route')
  return { path, distanceM: route.distance, durationS: route.duration }
}

export class OsrmRoutingService implements RoutingService {
  constructor(
    private readonly baseUrl = FOSSGIS_FOOT_URL,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  async walking(from: LngLat, to: LngLat, signal?: AbortSignal): Promise<WalkingRoute> {
    if (distanceMeters(from, to) > MAX_WALK_M) throw new RoutingError('too_far')
    const url = `${this.baseUrl}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`
    let response: Response
    try {
      response = await this.fetchFn(url, { signal })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new RoutingError('network', String(e))
    }
    // OSRM answers NoRoute with 400 and a JSON body
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new RoutingError('unavailable', `HTTP ${response.status}`)
    }
    const route = parseOsrmRoute(body)
    // the server snaps both ends to the paths: join the line to the player and to the place
    return { ...route, path: [[from.lng, from.lat], ...route.path, [to.lng, to.lat]] }
  }
}
