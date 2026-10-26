import type { LngLat } from '@/types/game'
import type { LngLatPair } from '@/services/map/types'

export interface WalkingRoute {
  /** the line to draw, from the start point to the destination */
  path: LngLatPair[]
  distanceM: number
  durationS: number
}

export type RoutingErrorCode = 'no_route' | 'too_far' | 'network' | 'unavailable'

export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string = code,
  ) {
    super(message)
    this.name = 'RoutingError'
  }
}

/** Walking routes; the engine (OSRM on OSM data now, a paid Yandex Router later) stays behind this. */
export interface RoutingService {
  walking(from: LngLat, to: LngLat, signal?: AbortSignal): Promise<WalkingRoute>
}
