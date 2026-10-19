import { vi, type Mock } from 'vitest'
import type { AppConfig } from '@/app/config'
import { setServices, type AppServices } from '@/app/providers/services'
import { MockCameraService, MockGeolocationService } from '@/mocks'
import type { GameApi } from '@/services/api/gameApi'
import type { BuildingRecognitionService, RecognitionResult } from '@/services/recognition/types'
import type { MapBuilding, ScanDecision, ScanSubmission } from '@/types/game'

export const CONFIG: AppConfig = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon',
  yandexMapsApiKey: '00000000-0000-4000-8000-000000000000',
  recognitionManifestUrl: null,
  oauthProviders: [],
  useMocks: false,
  nativeAuthRedirect: 'app.metka.game://auth/callback',
}

export const BUILDING: MapBuilding = {
  id: '00000000-0000-4000-b000-000000000002',
  slug: 'gum',
  name: 'ГУМ',
  description: null,
  address: null,
  districtId: 'd1',
  lat: 55.7547,
  lng: 37.6215,
  scanRadiusM: 100,
  rarity: 'rare',
  reward: { xp: 120, coins: 30, influence: 25 },
  imageUrl: null,
  isDevSeed: true,
  discoveredAt: null,
}

export function recognitionResult(over: Partial<RecognitionResult> = {}): RecognitionResult {
  return {
    status: 'recognized',
    targetBuildingId: BUILDING.id,
    candidates: [{ buildingId: BUILDING.id, name: 'ГУМ', score: 0.93, distanceM: 10 }],
    confidence: 0.93,
    margin: 0.5,
    embedding: new Float32Array([1, 0, 0]),
    modelVersion: 'test-v1',
    quality: { blurScore: 100, brightness: 120, issues: [] },
    diagnostics: { durationMs: 5, inferenceMs: 3, imageWidth: 10, imageHeight: 10, modelVersion: 'test-v1' },
    ...over,
  }
}

export function decision(over: Partial<ScanDecision> = {}): ScanDecision {
  return {
    scanId: 's1',
    status: 'accepted',
    reason: null,
    duplicate: false,
    buildingId: BUILDING.id,
    distanceM: 10,
    reward: { xp: 120, coins: 30, influence: 25 },
    completedQuests: [],
    profile: { level: 2, xp: 120, coins: 30, buildingsDiscovered: 1 },
    ...over,
  }
}

export interface FakeServices {
  camera: MockCameraService
  geolocation: MockGeolocationService
  recognition: {
    isAvailable: Mock<() => boolean>
    recognize: Mock<() => Promise<RecognitionResult>>
  }
  api: { submitScan: Mock<(submission: ScanSubmission) => Promise<ScanDecision>> }
}

export function installFakeServices(): FakeServices {
  const camera = new MockCameraService()
  const geolocation = new MockGeolocationService({ lat: BUILDING.lat, lng: BUILDING.lng, accuracyM: 10, timestamp: 0 })
  const recognition = {
    isAvailable: vi.fn(() => true),
    recognize: vi.fn(async () => recognitionResult()),
  } satisfies BuildingRecognitionService
  const api = {
    submitScan: vi.fn(async (_submission: ScanSubmission) => decision()),
    getDistrictsOverview: vi.fn(async () => []),
    getBuildingsInBbox: vi.fn(async () => [BUILDING]),
    getProfile: vi.fn(),
    getCollection: vi.fn(async () => []),
    getQuests: vi.fn(async () => []),
    claimQuest: vi.fn(),
    isLocationScanTester: vi.fn(async () => false),
    setDiscoveryPhoto: vi.fn(async () => undefined),
    getBuildingFacts: vi.fn(),
    getBuildingOrganizations: vi.fn(async () => []),
  }
  const services = {
    config: CONFIG,
    supabase: {} as AppServices['supabase'],
    api: api as unknown as GameApi,
    auth: {} as AppServices['auth'],
    camera,
    cameraPreview: { isSupported: () => true, start: vi.fn(async () => ({ stop: vi.fn() })) },
    orientation: { isSupported: () => true, requestPermission: vi.fn(async () => 'granted' as const), watchHeading: vi.fn(() => () => undefined) },
    geolocation,
    recognition,
    lifecycle: { onActiveChange: () => () => undefined, onDeepLink: () => () => undefined },
    wakeLock: { supported: true, active: false, keepOn: vi.fn(async () => true), release: vi.fn(async () => undefined), onChange: () => () => undefined },
    createMap: () => {
      throw new Error('map is not available in unit tests')
    },
    memories: {
      list: vi.fn(async () => []),
      save: vi.fn(),
      remove: vi.fn(async () => undefined),
      photoUrls: vi.fn(async () => new Map<string, string>()),
    },
    createExplorationTracker: () => {
      throw new Error('override createExplorationTracker in the test')
    },
    mocked: false,
    devTools: null,
  } satisfies AppServices
  setServices(services)
  return { camera, geolocation, recognition, api }
}
