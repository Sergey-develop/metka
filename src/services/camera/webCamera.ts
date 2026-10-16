import type { AppPermissionState } from '../shared'
import { CameraError, type CameraService, type CapturedPhoto } from './types'

/**
 * Browser implementation for the web build: a file input with
 * capture="environment" opens the rear camera on mobile browsers.
 */
export class WebCameraService implements CameraService {
  async checkPermission(): Promise<AppPermissionState> {
    return 'granted'
  }

  async requestPermission(): Promise<AppPermissionState> {
    return 'granted'
  }

  takePhoto(): Promise<CapturedPhoto> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.setAttribute('capture', 'environment')
      input.style.display = 'none'
      let settled = false
      const finish = () => {
        settled = true
        window.removeEventListener('focus', onFocus)
        input.remove()
      }
      const onFocus = () => {
        // the picker closes before `change` fires; give it a moment
        setTimeout(() => {
          if (!settled) {
            finish()
            reject(new CameraError('cancelled'))
          }
        }, 1000)
      }
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        finish()
        if (!file) return reject(new CameraError('cancelled'))
        if (!file.type.startsWith('image/')) return reject(new CameraError('failed', 'not an image'))
        resolve({ blob: file, previewUrl: URL.createObjectURL(file) })
      })
      window.addEventListener('focus', onFocus, { once: true })
      document.body.append(input)
      input.click()
    })
  }

  release(photo: CapturedPhoto): void {
    URL.revokeObjectURL(photo.previewUrl)
  }
}
