import type { GeoFix } from '@/services/geolocation/types'
import { distanceMeters } from '@/utils/geo'

/** A fix worth sending to record_exploration (the server re-validates everything). */
export interface TrackPoint {
  lat: number
  lng: number
  accuracy: number
  /** ms since epoch */
  t: number
}

export type FilterVerdict =
  | { accepted: true; point: TrackPoint }
  | { accepted: false; reason: 'inaccurate' | 'too_close' | 'outlier' | 'out_of_order' }

export interface TrackFilterOptions {
  /** fixes worse than this never count (server limit: 35 m) */
  maxAccuracyM: number
  /** ignore jitter while standing still */
  minDistanceM: number
  /** while standing, still pass a fix this often so the server does not see a pause */
  heartbeatMs: number
  /** jumps faster than this (within outlierWindowMs of the anchor) are GPS outliers (server: 7 m/s) */
  maxSpeedMps: number
  outlierWindowMs: number
}

export const DEFAULT_FILTER: TrackFilterOptions = {
  maxAccuracyM: 30,
  minDistanceM: 8,
  heartbeatMs: 20_000,
  maxSpeedMps: 6.5,
  outlierWindowMs: 120_000,
}

/**
 * Client-side track cleaning: drops inaccurate fixes, stationary jitter and outliers before they
 * cost bandwidth. Mirrors the server rules with slightly stricter limits, so accepted points are
 * rarely rejected there. After a long gap (pause, tunnel, bus ride) the next good fix re-anchors.
 */
export class TrackFilter {
  private anchor: TrackPoint | null = null
  private readonly options: TrackFilterOptions

  constructor(options: Partial<TrackFilterOptions> = {}) {
    this.options = { ...DEFAULT_FILTER, ...options }
  }

  push(fix: GeoFix): FilterVerdict {
    const o = this.options
    if (!Number.isFinite(fix.accuracyM) || fix.accuracyM > o.maxAccuracyM) return { accepted: false, reason: 'inaccurate' }
    const point: TrackPoint = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracyM, t: fix.timestamp }
    const anchor = this.anchor
    if (anchor) {
      const dt = point.t - anchor.t
      if (dt <= 0) return { accepted: false, reason: 'out_of_order' }
      const d = distanceMeters(anchor, point)
      if (dt <= o.outlierWindowMs && d / (dt / 1000) > o.maxSpeedMps) return { accepted: false, reason: 'outlier' }
      if (d < o.minDistanceM && dt < o.heartbeatMs) return { accepted: false, reason: 'too_close' }
    }
    this.anchor = point
    return { accepted: true, point }
  }

  reset(): void {
    this.anchor = null
  }
}
