import type { AppPermissionState } from '../shared'
import type { HeadingReading, OrientationService } from './types'

type IosOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number }
type IosOrientationEventClass = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

const RAD = Math.PI / 180

/** horizontal (east, north) part of the device's −z axis (rear camera) and +y axis (top edge) */
function deviceAxes(alpha: number, beta: number, gamma: number) {
  const sX = Math.sin(beta * RAD)
  const cX = Math.cos(beta * RAD)
  const cY = Math.cos(gamma * RAD)
  const sY = Math.sin(gamma * RAD)
  const cZ = Math.cos(alpha * RAD)
  const sZ = Math.sin(alpha * RAD)
  return {
    camera: [-cZ * sY - sZ * sX * cY, -sZ * sY + cZ * sX * cY] as const,
    top: [-sZ * cX, cZ * cX] as const,
  }
}

const bearing = ([east, north]: readonly [number, number]): number => (Math.atan2(east, north) / RAD + 360) % 360

/**
 * Compass heading of the rear camera from absolute Euler angles (W3C DeviceOrientation spec,
 * "compass heading" example): the horizontal direction of the device's −z axis.
 */
export function rearCameraHeading(alpha: number, beta: number, gamma: number): number {
  return bearing(deviceAxes(alpha, beta, gamma).camera)
}

/**
 * Where the player faces: of the phone's top edge and rear camera, the one closer to horizontal —
 * the top edge for a phone lying flat (as a map is held), the camera for an upright one.
 */
export function facingHeading(alpha: number, beta: number, gamma: number): number {
  const { camera, top } = deviceAxes(alpha, beta, gamma)
  return bearing(Math.hypot(...camera) > Math.hypot(...top) ? camera : top)
}

/** the camera looks roughly at the horizon (not at the ground or the sky) */
function isUpright(beta: number | null, gamma: number | null): boolean {
  return Math.max(Math.abs(beta ?? 0), Math.abs(gamma ?? 0)) >= 45
}

const NO_HEADING_AFTER_MS = 3000

/**
 * Browser/WebView orientation events. iOS: webkitCompassHeading (+ accuracy), needs a permission
 * tap. Android: deviceorientationabsolute → heading of the rear camera. Relative-only orientation
 * (alpha without north reference) is ignored rather than reported as a heading.
 */
export class DeviceOrientationService implements OrientationService {
  constructor(private readonly win: Window = window) {}

  isSupported(): boolean {
    return 'DeviceOrientationEvent' in this.win
  }

  async requestPermission(): Promise<AppPermissionState> {
    if (!this.isSupported()) return 'denied'
    const cls = (this.win as Window & { DeviceOrientationEvent: IosOrientationEventClass }).DeviceOrientationEvent
    if (typeof cls.requestPermission !== 'function') return 'granted'
    try {
      return (await cls.requestPermission()) === 'granted' ? 'granted' : 'denied'
    } catch {
      // thrown when not called from a tap: the user has to be asked again
      return 'prompt'
    }
  }

  watchHeading(onReading: (reading: HeadingReading) => void, onUnavailable: () => void): () => void {
    const eventName = 'ondeviceorientationabsolute' in this.win ? 'deviceorientationabsolute' : 'deviceorientation'
    let received = false
    const handler = (event: Event): void => {
      const e = event as IosOrientationEvent
      let deg: number
      let facingDeg: number
      let accuracyDeg: number | null = null
      if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
        // iOS already reports the top edge when flat and the camera when upright
        deg = facingDeg = e.webkitCompassHeading
        accuracyDeg = typeof e.webkitCompassAccuracy === 'number' && e.webkitCompassAccuracy >= 0 ? e.webkitCompassAccuracy : null
      } else if (e.absolute && e.alpha !== null && e.beta !== null && e.gamma !== null) {
        deg = rearCameraHeading(e.alpha, e.beta, e.gamma)
        facingDeg = facingHeading(e.alpha, e.beta, e.gamma)
      } else {
        return
      }
      received = true
      onReading({ deg, facingDeg, accuracyDeg, upright: isUpright(e.beta, e.gamma), timestamp: Date.now() })
    }
    this.win.addEventListener(eventName, handler)
    const timer = setTimeout(() => {
      if (!received) onUnavailable()
    }, NO_HEADING_AFTER_MS)
    return () => {
      clearTimeout(timer)
      this.win.removeEventListener(eventName, handler)
    }
  }
}
