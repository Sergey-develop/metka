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
import { GpsExplorationTracker, type ExplorationTracker } from '@/services/exploration/explorationTracker'
import { PreferencesPendingPointStore } from '@/services/exploration/pendingPointStore'
import { SupabaseMemoriesService, type MemoriesService } from '@/services/memories/memoriesService'
import type { MapService } from '@/services/map/types'
import { prepareMemoryPhoto } from '@/utils/avatarImage'
import { loadYandexMaps } from '@/services/map/yandexLoader'
import { YandexMapService } from '@/services/map/yandexMap'
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
  /** a fresh map engine instance per map screen (ADR-003: Yandex JS API 3.0) */
  createMap: () => MapService
  /** album of memories (private photos in Storage) */
  memories: MemoriesService
  /** GPS tracking for explored territory (foreground only) */
  createExplorationTracker: (userId: string | null) => ExplorationTracker
  /** true when dev mocks are active; surfaced in the UI */
  mocked: boolean
  /** dev-only controls (mock geolocation teleport); null in production */
  devTools: { teleport: (lat: number, lng: number) => void } | null
}

let current: AppServices | null = null

function newTracker(geolocation: GeolocationService, api: GameApi, userId: string | null): ExplorationTracker {
  const store = userId ? new PreferencesPendingPointStore(userId) : null
  return new GpsExplorationTracker(geolocation, (points) => api.recordExploration(points), {}, Date.now, store)
}

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
    memories: new SupabaseMemoriesService(supabase, prepareMemoryPhoto),
    createMap: () => new YandexMapService(() => loadYandexMaps(config.yandexMapsApiKey)),
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
      createExplorationTracker: (userId) => newTracker(geolocation, api, userId),
      recognition: new mocks.MockRecognitionService(api),
      mocked: true,
      devTools: { teleport: (lat, lng) => geolocation.setPosition(lat, lng) },
    }
  }

  const manifestUrl = config.recognitionManifestUrl
  const geolocation = new CapacitorGeolocationService()
  return {
    ...base,
    camera: Capacitor.isNativePlatform() ? new CapacitorCameraService() : new WebCameraService(),
    geolocation,
    createExplorationTracker: (userId) => newTracker(geolocation, api, userId),
    recognition: new EmbeddingRecognitionService({
      loadModel: manifestUrl ? () => loadOnnxModelFromUrl(manifestUrl) : null,
      decoder: new CanvasImageDecoder(),
      matcher: api,
    }),
    mocked: false,
    devTools: null,
  }
}
