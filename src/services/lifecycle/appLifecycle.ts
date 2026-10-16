import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

export interface AppLifecycleService {
  /** Called with true when the app returns to foreground, false when backgrounded. */
  onActiveChange(listener: (isActive: boolean) => void): () => void
  /** Deep links (OAuth / password reset callbacks) on native platforms. */
  onDeepLink(listener: (url: string) => void): () => void
}

export class CapacitorAppLifecycle implements AppLifecycleService {
  onActiveChange(listener: (isActive: boolean) => void): () => void {
    if (!Capacitor.isNativePlatform()) {
      const handler = () => listener(document.visibilityState === 'visible')
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    }
    const handle = App.addListener('appStateChange', ({ isActive }) => listener(isActive))
    return () => {
      void handle.then((h) => h.remove())
    }
  }

  onDeepLink(listener: (url: string) => void): () => void {
    if (!Capacitor.isNativePlatform()) return () => undefined
    const handle = App.addListener('appUrlOpen', ({ url }) => listener(url))
    return () => {
      void handle.then((h) => h.remove())
    }
  }
}
