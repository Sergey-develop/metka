import type { AppPermissionState } from '../shared'

export interface HeadingReading {
  /** where the rear camera points, degrees clockwise from north */
  deg: number
  /** where the player faces, for the map: the phone's top edge when it lies flat, the rear camera when upright */
  facingDeg: number
  /** ± degrees when the platform reports it (iOS), else null */
  accuracyDeg: number | null
  /** phone held roughly upright; when flat the camera looks at the ground and the heading is useless */
  upright: boolean
  timestamp: number
}

export interface OrientationService {
  /** the device/browser can report an absolute (north-referenced) orientation at all */
  isSupported(): boolean
  /** iOS asks the user (must run inside a tap); elsewhere resolves 'granted' */
  requestPermission(): Promise<AppPermissionState>
  /** Returns an unsubscribe function. onUnavailable fires when no absolute heading arrives. */
  watchHeading(onReading: (reading: HeadingReading) => void, onUnavailable: () => void): () => void
}
