import { Capacitor } from '@capacitor/core'
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

type GeolocationPlugin = Pick<typeof Geolocation, 'checkPermissions' | 'requestPermissions' | 'getCurrentPosition' | 'watchPosition' | 'clearWatch'>

/** Works on iOS, Android and web (the plugin falls back to navigator.geolocation). */
export class CapacitorGeolocationService implements GeolocationService {
  constructor(
    private readonly plugin: GeolocationPlugin = Geolocation,
    private readonly native: boolean = Capacitor.isNativePlatform(),
  ) {}

  async checkPermission(): Promise<AppPermissionState> {
    try {
      return normalizePermission((await this.plugin.checkPermissions()).location)
    } catch (error) {
      // thrown when system location services are off
      if (mapGeolocationError(error).code === 'disabled') return 'denied'
      return 'prompt'
    }
  }

  async requestPermission(): Promise<AppPermissionState> {
    if (!this.native) return this.requestWebPermission()
    try {
      return normalizePermission((await this.plugin.requestPermissions({ permissions: ['location'] })).location)
    } catch (error) {
      throw mapGeolocationError(error)
    }
  }

  /**
   * The web plugin does not implement requestPermissions() ("Not implemented on web"). Browsers
   * (Safari on iPhone included) show their location prompt on the first position request instead.
   */
  private async requestWebPermission(): Promise<AppPermissionState> {
    try {
      await this.plugin.getCurrentPosition({ enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 })
      return 'granted'
    } catch (error) {
      const mapped = mapGeolocationError(error)
      if (mapped.code === 'permission_denied') return 'denied'
      if (mapped.code === 'disabled') throw mapped
      // answered, but no fix yet (timeout/indoors): the watcher reports signal problems itself
      return 'granted'
    }
  }

  async getCurrentPosition(request: PositionRequest = {}): Promise<GeoFix> {
    try {
      const position = await this.plugin.getCurrentPosition({
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
    const id = await this.plugin.watchPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 }, (position, error) => {
      if (error) onError(mapGeolocationError(error))
      else if (position) onFix(toFix(position))
    })
    return () => {
      void this.plugin.clearWatch({ id })
    }
  }
}
