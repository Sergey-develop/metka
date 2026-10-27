import { registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin, CallbackError, Location } from '@capacitor-community/background-geolocation'
import { GeolocationError, type GeoFix, type GeolocationService, type PositionRequest } from './types'
import type { AppPermissionState } from '../shared'

/**
 * Exploration with the phone in a pocket (native apps only): the watch keeps the GPS on while the app is
 * in the background (iOS: background mode «location», the blue indicator; Android: a foreground-service
 * notification). Asking for «Always» is up to the plugin: it escalates from «While using» when the watch
 * starts. Permission checks and one-off fixes stay with the regular plugin.
 *
 * Plugin @capacitor-community/background-geolocation 1.2.26: no network code, only CLLocationManager /
 * FusedLocationProvider (read on 2026-10-27).
 */
export const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

type WatchPlugin = Pick<BackgroundGeolocationPlugin, 'addWatcher' | 'removeWatcher'>

/** shown by Android in the notification of the foreground service; on iOS its presence turns background on */
export const BACKGROUND_TITLE = 'Метка открывает карту'
export const BACKGROUND_MESSAGE = 'Туман рассеивается, пока вы гуляете'

export function mapBackgroundError(error: CallbackError): GeolocationError {
  if (error.code === 'NOT_AUTHORIZED') return new GeolocationError('permission_denied', error.message)
  if (/disabled|not enabled/i.test(error.message)) return new GeolocationError('disabled', error.message)
  return new GeolocationError('unavailable', error.message)
}

export function toFix(location: Location): GeoFix {
  return { lat: location.latitude, lng: location.longitude, accuracyM: location.accuracy, timestamp: location.time ?? Date.now() }
}

export class BackgroundWatchGeolocationService implements GeolocationService {
  constructor(
    private readonly base: GeolocationService,
    private readonly plugin: WatchPlugin = BackgroundGeolocation,
  ) {}

  checkPermission(): Promise<AppPermissionState> {
    return this.base.checkPermission()
  }

  requestPermission(): Promise<AppPermissionState> {
    return this.base.requestPermission()
  }

  getCurrentPosition(request?: PositionRequest): Promise<GeoFix> {
    return this.base.getCurrentPosition(request)
  }

  async watchPosition(onFix: (fix: GeoFix) => void, onError: (error: GeolocationError) => void): Promise<() => void> {
    let id: string | null = null
    let stopped = false
    id = await this.plugin.addWatcher(
      {
        backgroundTitle: BACKGROUND_TITLE,
        backgroundMessage: BACKGROUND_MESSAGE,
        requestPermissions: true,
        // fresh fixes only: an old cached one would make a jump in the walk
        stale: false,
        // metres between fixes: the exploration grid is ≈11 m, the corridor 18 m wide
        distanceFilter: 5,
      },
      (location, error) => {
        if (stopped) return
        if (error) onError(mapBackgroundError(error))
        else if (location) onFix(toFix(location))
      },
    )
    return () => {
      stopped = true
      if (id) void this.plugin.removeWatcher({ id }).catch(() => undefined)
      id = null
    }
  }
}
