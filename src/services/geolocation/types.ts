import type { AppPermissionState } from '../shared'

export interface GeoFix {
  lat: number
  lng: number
  accuracyM: number
  timestamp: number
}

export type GeolocationErrorCode = 'permission_denied' | 'disabled' | 'unavailable' | 'timeout'

export class GeolocationError extends Error {
  constructor(
    readonly code: GeolocationErrorCode,
    message: string = code,
  ) {
    super(message)
    this.name = 'GeolocationError'
  }
}

export interface PositionRequest {
  timeoutMs?: number
  maxAgeMs?: number
}

export interface GeolocationService {
  checkPermission(): Promise<AppPermissionState>
  requestPermission(): Promise<AppPermissionState>
  getCurrentPosition(request?: PositionRequest): Promise<GeoFix>
  /** Returns an unsubscribe function. */
  watchPosition(onFix: (fix: GeoFix) => void, onError: (error: GeolocationError) => void): Promise<() => void>
}
