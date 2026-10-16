import { Capacitor } from '@capacitor/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from '@/app/config'
import { GameApi } from '@/services/api/gameApi'
import { AuthService } from '@/services/auth/authService'
import { createSupabaseClient } from '@/services/auth/supabaseClient'
import { CapacitorCameraService } from '@/services/camera/capacitorCamera'
import type { CameraService } from '@/services/camera/types'
import { WebCameraService } from '@/services/camera/webCamera'
import { CapacitorGeolocationService } from '@/services/geolocation/capacitorGeolocation'
import type { GeolocationService } from '@/services/geolocation/types'
import { CapacitorAppLifecycle, type AppLifecycleService } from '@/services/lifecycle/appLifecycle'
import { CanvasImageDecoder } from '@/services/recognition/canvasDecoder'
import { loadOnnxModelFromUrl } from '@/services/recognition/onnxModel'
import { EmbeddingRecognitionService } from '@/services/recognition/recognitionService'
import type { BuildingRecognitionService } from '@/services/recognition/types'

export interface AppServices {
  config: AppConfig
  supabase: SupabaseClient
  api: GameApi
  auth: AuthService
  camera: CameraService
  geolocation: GeolocationService
  recognition: BuildingRecognitionService
  lifecycle: AppLifecycleService
  /** true when dev mocks are active; surfaced in the UI */
  mocked: boolean
  /** dev-only controls (mock geolocation teleport); null in production */
  devTools: { teleport: (lat: number, lng: number) => void } | null
}

let current: AppServices | null = null

export function setServices(services: AppServices): void {
  current = services
}

export function services(): AppServices {
  if (!current) throw new Error('services are not initialised')
  return current
}

export async function createServices(config: AppConfig): Promise<AppServices> {
  const supabase = createSupabaseClient(config)
  const api = new GameApi(supabase)
  const base = {
    config,
    supabase,
    api,
    auth: new AuthService(supabase, config),
    lifecycle: new CapacitorAppLifecycle(),
  }

  // `import.meta.env.DEV` is statically false in production builds, so the
  // mocks module is dropped from the bundle entirely.
  if (import.meta.env.DEV && config.useMocks) {
    const mocks = await import('@/mocks')
    const geolocation = new mocks.MockGeolocationService()
    return {
      ...base,
      camera: new mocks.MockCameraService(),
      geolocation,
      recognition: new mocks.MockRecognitionService(api),
      mocked: true,
      devTools: { teleport: (lat, lng) => geolocation.setPosition(lat, lng) },
    }
  }

  const manifestUrl = config.recognitionManifestUrl
  return {
    ...base,
    camera: Capacitor.isNativePlatform() ? new CapacitorCameraService() : new WebCameraService(),
    geolocation: new CapacitorGeolocationService(),
    recognition: new EmbeddingRecognitionService({
      loadModel: manifestUrl ? () => loadOnnxModelFromUrl(manifestUrl) : null,
      decoder: new CanvasImageDecoder(),
      matcher: api,
    }),
    mocked: false,
    devTools: null,
  }
}
