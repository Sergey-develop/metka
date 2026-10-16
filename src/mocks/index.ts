/**
 * DEVELOPMENT AND TEST MOCKS ONLY.
 * Loaded exclusively when import.meta.env.DEV && VITE_USE_MOCKS === 'true'
 * (see src/app/providers/services.ts); production builds tree-shake this module.
 * The mock recognizer works only with the synthetic 'mock-dev-v1' model that
 * exists in supabase/seed.sql, so it cannot grant rewards on a production DB.
 */
import type { CameraService, CapturedPhoto } from '@/services/camera/types'
import { CameraError } from '@/services/camera/types'
import type { GeoFix, GeolocationService } from '@/services/geolocation/types'
import { GeolocationError } from '@/services/geolocation/types'
import { decideCandidates } from '@/services/recognition/decision'
import type {
  BuildingRecognitionService,
  CandidateMatcher,
  RecognitionInput,
  RecognitionOptions,
  RecognitionResult,
} from '@/services/recognition/types'
import { RecognitionError } from '@/services/recognition/types'
import type { AppPermissionState } from '@/services/shared'

export const MOCK_MODEL_VERSION = 'mock-dev-v1'
const MOCK_DIM = 16

export class MockCameraService implements CameraService {
  permission: AppPermissionState = 'granted'
  nextError: CameraError | null = null

  async checkPermission(): Promise<AppPermissionState> {
    return this.permission
  }
  async requestPermission(): Promise<AppPermissionState> {
    return this.permission
  }
  async takePhoto(): Promise<CapturedPhoto> {
    if (this.permission === 'denied') throw new CameraError('permission_denied')
    if (this.nextError) {
      const error = this.nextError
      this.nextError = null
      throw error
    }
    const blob = new Blob([`mock-photo-${Date.now()}-${Math.random()}`], { type: 'image/jpeg' })
    return { blob, previewUrl: '' }
  }
  release(): void {}
}

export class MockGeolocationService implements GeolocationService {
  permission: AppPermissionState = 'granted'
  nextError: GeolocationError | null = null
  private listeners = new Set<(fix: GeoFix) => void>()

  constructor(public position: GeoFix = { lat: 55.7547, lng: 37.6215, accuracyM: 12, timestamp: Date.now() }) {}

  setPosition(lat: number, lng: number, accuracyM = 10): void {
    this.position = { lat, lng, accuracyM, timestamp: Date.now() }
    for (const listener of this.listeners) listener(this.position)
  }

  async checkPermission(): Promise<AppPermissionState> {
    return this.permission
  }
  async requestPermission(): Promise<AppPermissionState> {
    return this.permission
  }
  async getCurrentPosition(): Promise<GeoFix> {
    if (this.permission === 'denied') throw new GeolocationError('permission_denied')
    if (this.nextError) {
      const error = this.nextError
      this.nextError = null
      throw error
    }
    return { ...this.position, timestamp: Date.now() }
  }
  async watchPosition(onFix: (fix: GeoFix) => void): Promise<() => void> {
    this.listeners.add(onFix)
    onFix(this.position)
    return () => this.listeners.delete(onFix)
  }
}

/** Synthetic embedding for dev-seed building ids ...0000000000NN (basis vector e_NN + noise). */
export function mockEmbeddingFor(buildingId: string): Float32Array {
  const index = Number.parseInt(buildingId.slice(-2), 10)
  const v = new Float32Array(MOCK_DIM)
  for (let i = 0; i < MOCK_DIM; i++) v[i] = i + 1 === index ? 1 : 0.08 * (((i * 7) % 5) / 4)
  let norm = 0
  for (const x of v) norm += x * x
  return v.map((x) => x / Math.sqrt(norm))
}

/**
 * Pretends the photo shows the target building, then asks the real server
 * matcher to rank candidates. Explicitly a simulation; labelled in the UI.
 */
export class MockRecognitionService implements BuildingRecognitionService {
  constructor(private readonly matcher: CandidateMatcher) {}

  isAvailable(): boolean {
    return true
  }

  async recognize(input: RecognitionInput, options: RecognitionOptions = {}): Promise<RecognitionResult> {
    if (options.signal?.aborted) throw new RecognitionError('aborted')
    const started = performance.now()
    const embedding = mockEmbeddingFor(input.targetBuildingId)
    const candidates = await this.matcher.match(
      { embedding, modelVersion: MOCK_MODEL_VERSION, lat: input.location.lat, lng: input.location.lng },
      options.signal,
    )
    const decision = decideCandidates(candidates, input.targetBuildingId, { scoreThreshold: 0.8, marginThreshold: 0.1 })
    return {
      ...decision,
      targetBuildingId: input.targetBuildingId,
      candidates,
      embedding,
      modelVersion: MOCK_MODEL_VERSION,
      quality: { blurScore: 100, brightness: 128, issues: [] },
      diagnostics: {
        durationMs: Math.round(performance.now() - started),
        inferenceMs: 0,
        imageWidth: 0,
        imageHeight: 0,
        modelVersion: MOCK_MODEL_VERSION,
      },
    }
  }
}
