import type { AppPermissionState } from '../shared'

export type CameraErrorCode = 'permission_denied' | 'unavailable' | 'cancelled' | 'failed'

export class CameraError extends Error {
  constructor(
    readonly code: CameraErrorCode,
    message: string = code,
  ) {
    super(message)
    this.name = 'CameraError'
  }
}

export interface CapturedPhoto {
  blob: Blob
  /** Object URL for preview; call CameraService.release() when done. */
  previewUrl: string
}

export interface CameraService {
  /**
   * true when takePhoto() must be called synchronously inside the tap handler: browsers (iOS Safari
   * especially) ignore a programmatic file-input click once an await has passed.
   */
  readonly requiresUserGesture?: boolean
  checkPermission(): Promise<AppPermissionState>
  requestPermission(): Promise<AppPermissionState>
  /** Opens the system camera. Rejects with CameraError. */
  takePhoto(): Promise<CapturedPhoto>
  release(photo: CapturedPhoto): void
}
