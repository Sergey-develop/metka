import type { LngLat } from '@/types/game'

const EARTH_RADIUS_M = 6_371_008.8

/** Great-circle distance in metres (display/precheck only; the server uses PostGIS). */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Same allowance rule as submit_building_scan. */
export const MAX_ACCURACY_M = 100
export const ACCURACY_ALLOWANCE_M = 30

export function allowedScanDistance(scanRadiusM: number, accuracyM: number): number {
  return scanRadiusM + Math.min(accuracyM, ACCURACY_ALLOWANCE_M)
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} м`
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0).replace('.', ',')} км`
}

/** walking time as on the mockups: «до 5 мин», «15–20 мин» */
export function walkRange(seconds: number): string {
  const minutes = seconds / 60
  if (minutes <= 5) return 'до 5 мин'
  const hi = Math.ceil(minutes / 5) * 5
  return `${hi - 5}–${hi} мин`
}
