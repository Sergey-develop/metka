import { Geolocation, type Position } from '@capacitor/geolocation'
import { errorCode, errorMessage, normalizePermission, type AppPermissionState } from '../shared'
import { GeolocationError, type GeoFix, type GeolocationService, type PositionRequest } from './types'

/**
 * Maps native (OS-PLUG-GLOC-xxxx) and browser (GeolocationPositionError 1..3)
 * errors to a single typed error.
 */
export function mapGeolocationError(error: unknown): GeolocationError {
  const code = errorCode(error)
  const message = errorMessage(error)
  switch (code) {
    case 'OS-PLUG-GLOC-0003':
    case 1:
      return new GeolocationError('permission_denied', message)
    case 'OS-PLUG-GLOC-0007':
    case 'OS-PLUG-GLOC-0009':
    case 'OS-PLUG-GLOC-0017':
      return new GeolocationError('disabled', message)
    case 'OS-PLUG-GLOC-0010':
    case 3:
      return new GeolocationError('timeout', message)
  }
  if (/location services are not enabled|disabled/i.test(message)) return new GeolocationError('disabled', message)
  if (/denied/i.test(message)) return new GeolocationError('permission_denied', message)
  if (/timeout|in time/i.test(message)) return new GeolocationError('timeout', message)
  return new GeolocationError('unavailable', message)
}

function toFix(position: Position): GeoFix {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyM: position.coords.accuracy,
    timestamp: position.timestamp,
  }
}

/** Works on iOS, Android and web (the plugin falls back to navigator.geolocation). */
export class CapacitorGeolocationService implements GeolocationService {
  async checkPermission(): Promise<AppPermissionState> {
    try {
      return normalizePermission((await Geolocation.checkPermissions()).location)
    } catch (error) {
      // thrown when system location services are off
      if (mapGeolocationError(error).code === 'disabled') return 'denied'
      return 'prompt'
    }
  }

  async requestPermission(): Promise<AppPermissionState> {
    try {
      return normalizePermission((await Geolocation.requestPermissions({ permissions: ['location'] })).location)
    } catch (error) {
      throw mapGeolocationError(error)
    }
  }

  async getCurrentPosition(request: PositionRequest = {}): Promise<GeoFix> {
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: request.timeoutMs ?? 15_000,
        maximumAge: request.maxAgeMs ?? 5_000,
      })
      return toFix(position)
    } catch (error) {
      throw mapGeolocationError(error)
    }
  }

  async watchPosition(
    onFix: (fix: GeoFix) => void,
    onError: (error: GeolocationError) => void,
  ): Promise<() => void> {
    const id = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 }, (position, error) => {
      if (error) onError(mapGeolocationError(error))
      else if (position) onFix(toFix(position))
    })
    return () => {
      void Geolocation.clearWatch({ id })
    }
  }
}
