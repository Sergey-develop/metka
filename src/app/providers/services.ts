import { Capacitor } from '@capacitor/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from '@/app/config'
import { GameApi } from '@/services/api/gameApi'
import { AuthService } from '@/services/auth/authService'
import { createSupabaseClient } from '@/services/auth/supabaseClient'
import { CapacitorCameraService } from '@/services/camera/capacitorCamera'
import { MediaDevicesCameraPreview, type CameraPreviewService } from '@/services/camera/preview'
import type { CameraService } from '@/services/camera/types'
import { WebCameraService } from '@/services/camera/webCamera'
import { CapacitorGeolocationService } from '@/services/geolocation/capacitorGeolocation'
import { BackgroundWatchGeolocationService } from '@/services/geolocation/backgroundGeolocation'
import type { GeolocationService } from '@/services/geolocation/types'
import { OsrmRoutingService } from '@/services/routing/osrmRouting'
import type { RoutingService } from '@/services/routing/types'
import { CapacitorAppLifecycle, type AppLifecycleService } from '@/services/lifecycle/appLifecycle'
import { BrowserScreenWakeLock, type ScreenWakeLock } from '@/services/lifecycle/wakeLock'
import { GpsExplorationTracker, type ExplorationTracker } from '@/services/exploration/explorationTracker'
import { PreferencesPendingPointStore } from '@/services/exploration/pendingPointStore'
import { SupabaseMemoriesService, type MemoriesService } from '@/services/memories/memoriesService'
import type { MapService } from '@/services/map/types'
import { DeviceOrientationService } from '@/services/orientation/deviceOrientation'
import type { OrientationService } from '@/services/orientation/types'
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
  /** live rear-camera feed for the /scan screen */
  cameraPreview: CameraPreviewService
  /** compass heading of the rear camera */
  orientation: OrientationService
  geolocation: GeolocationService
  recognition: BuildingRecognitionService
  lifecycle: AppLifecycleService
  /** keeps the screen on while exploring (GPS stops with the screen in a browser) */
  wakeLock: ScreenWakeLock
  /** a fresh map engine instance per map screen (ADR-003: Yandex JS API 3.0) */
  createMap: () => MapService
  /** walking routes drawn on our map */
  routing: RoutingService
  /** album of memories (private photos in Storage) */
  memories: MemoriesService
  /** GPS tracking for explored territory (foreground only) */
  createExplorationTracker: (userId: string | null) => ExplorationTracker
  /** true when dev mocks are active; surfaced in the UI */
  mocked: boolean
  /** dev-only controls (mock geolocation teleport); null in production */
  devTools: { teleport: (lat: number, lng: number) => void } | null
  /** exploration keeps going with the app in the background (native apps: background location) */
  backgroundExploration: boolean
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
    wakeLock: new BrowserScreenWakeLock(),
    memories: new SupabaseMemoriesService(supabase, prepareMemoryPhoto),
    createMap: () => new YandexMapService(() => loadYandexMaps(config.yandexMapsApiKey)),
    routing: new OsrmRoutingService(),
    cameraPreview: new MediaDevicesCameraPreview(),
    orientation: new DeviceOrientationService(),
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
      backgroundExploration: false,
    }
  }

  const manifestUrl = config.recognitionManifestUrl
  const geolocation = new CapacitorGeolocationService()
  const native = Capacitor.isNativePlatform()
  // in the app the exploration watch keeps running in the background; the browser stops GPS there anyway
  const trackerGeolocation = native ? new BackgroundWatchGeolocationService(geolocation) : geolocation
  return {
    ...base,
    camera: native ? new CapacitorCameraService() : new WebCameraService(),
    geolocation,
    createExplorationTracker: (userId) => newTracker(trackerGeolocation, api, userId),
    recognition: new EmbeddingRecognitionService({
      loadModel: manifestUrl ? () => loadOnnxModelFromUrl(manifestUrl) : null,
      decoder: new CanvasImageDecoder(),
      matcher: api,
    }),
    mocked: false,
    devTools: null,
    backgroundExploration: native,
  }
}
