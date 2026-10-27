import { Camera, CameraErrorCode, CameraResultType, CameraSource } from '@capacitor/camera'
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

  /**
   * The photo comes back as base64 through the bridge. Not as a file path (`webPath`): the app shows the
   * site from CAP_SERVER_URL (https://…github.io), and that page may not read the app's local
   * `capacitor://localhost/_capacitor_file_/…` files — fetch failed and every photo ended in «Не удалось
   * сделать снимок» (2026-10-27). takePhoto() of camera 8 gives base64 only for a thumbnail, so this uses
   * getPhoto() (deprecated, still supported) with CameraResultType.Base64.
   */
  async takePhoto(): Promise<CapturedPhoto> {
    let base64: string | undefined
    let format = 'jpeg'
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Base64,
        quality: 85,
        width: MAX_SIDE_PX,
        height: MAX_SIDE_PX,
        correctOrientation: true,
        saveToGallery: false,
      })
      base64 = photo.base64String
      format = photo.format || format
    } catch (error) {
      throw mapCameraError(error)
    }
    if (!base64) throw new CameraError('failed', 'camera returned no image')
    const blob = base64ToBlob(base64, `image/${format}`)
    return { blob, previewUrl: URL.createObjectURL(blob) }
  }

  release(photo: CapturedPhoto): void {
    URL.revokeObjectURL(photo.previewUrl)
  }
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}
