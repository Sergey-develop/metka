import { CameraError } from './types'

/** A running live camera feed; stop() releases the camera (indicator off). */
export interface CameraPreviewHandle {
  stop(): void
}

/** Live rear-camera feed for the scan screen (no photo is taken or uploaded). */
export interface CameraPreviewService {
  isSupported(): boolean
  /** Attaches the rear camera to the video element. Rejects with CameraError. */
  start(video: HTMLVideoElement): Promise<CameraPreviewHandle>
}

/**
 * getUserMedia in the browser and in the Capacitor WebView (WKWebView iOS ≥ 14.3; Android WebView
 * via Capacitor's permission bridge). Works the same everywhere, no native plugin needed.
 */
export class MediaDevicesCameraPreview implements CameraPreviewService {
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  }

  async start(video: HTMLVideoElement): Promise<CameraPreviewHandle> {
    if (!this.isSupported()) throw new CameraError('unavailable')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('permission_denied')
      if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') throw new CameraError('unavailable')
      throw new CameraError('failed', e instanceof Error ? e.message : 'getUserMedia failed')
    }
    const stop = (): void => {
      for (const track of stream.getTracks()) track.stop()
      if (video.srcObject === stream) video.srcObject = null
    }
    try {
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await video.play()
    } catch (e) {
      stop()
      throw new CameraError('failed', e instanceof Error ? e.message : 'video play failed')
    }
    return { stop }
  }
}
