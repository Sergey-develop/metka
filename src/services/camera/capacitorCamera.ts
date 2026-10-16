import { Camera, CameraErrorCode } from '@capacitor/camera'
import { errorCode, errorMessage, normalizePermission, type AppPermissionState } from '../shared'
import { CameraError, type CameraService, type CapturedPhoto } from './types'

const MAX_SIDE_PX = 1600

export function mapCameraError(error: unknown): CameraError {
  const code = errorCode(error)
  const message = errorMessage(error)
  switch (code) {
    case CameraErrorCode.CameraPermissionDenied:
      return new CameraError('permission_denied', message)
    case CameraErrorCode.NoCameraAvailable:
      return new CameraError('unavailable', message)
    case CameraErrorCode.TakePhotoCancelled:
      return new CameraError('cancelled', message)
  }
  if (/cancel/i.test(message)) return new CameraError('cancelled', message)
  if (/denied|permission/i.test(message)) return new CameraError('permission_denied', message)
  return new CameraError('failed', message)
}

/** Native iOS/Android camera through @capacitor/camera (system camera UI). */
export class CapacitorCameraService implements CameraService {
  async checkPermission(): Promise<AppPermissionState> {
    try {
      return normalizePermission((await Camera.checkPermissions()).camera)
    } catch {
      return 'prompt'
    }
  }

  async requestPermission(): Promise<AppPermissionState> {
    try {
      return normalizePermission((await Camera.requestPermissions({ permissions: ['camera'] })).camera)
    } catch (error) {
      throw mapCameraError(error)
    }
  }

  async takePhoto(): Promise<CapturedPhoto> {
    let webPath: string | undefined
    try {
      const result = await Camera.takePhoto({
        quality: 85,
        targetWidth: MAX_SIDE_PX,
        targetHeight: MAX_SIDE_PX,
        correctOrientation: true,
        saveToGallery: false,
      })
      webPath = result.webPath
    } catch (error) {
      throw mapCameraError(error)
    }
    if (!webPath) throw new CameraError('failed', 'camera returned no image')
    const response = await fetch(webPath)
    if (!response.ok) throw new CameraError('failed', `cannot read captured image (${response.status})`)
    const blob = await response.blob()
    return { blob, previewUrl: URL.createObjectURL(blob) }
  }

  release(photo: CapturedPhoto): void {
    URL.revokeObjectURL(photo.previewUrl)
  }
}
