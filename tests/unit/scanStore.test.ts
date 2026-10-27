import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { services } from '@/app/providers/services'
import { ApiError } from '@/services/api/errors'
import { CameraError } from '@/services/camera/types'
import { GeolocationError } from '@/services/geolocation/types'
import { RecognitionError } from '@/services/recognition/types'
import { useAuthStore } from '@/stores/auth'
import { useMapStore } from '@/stores/map'
import { useProfileStore } from '@/stores/profile'
import { LOCATION_TEST_MODEL, useScanStore } from '@/stores/scan'
import { BUILDING, decision, installFakeServices, recognitionResult } from './helpers'

// canvas re-encoding is not available in happy-dom; the real function is covered by its own module
vi.mock('@/utils/avatarImage', () => ({ prepareMemoryPhoto: vi.fn(async (b: Blob) => b) }))

let fakes: ReturnType<typeof installFakeServices>

beforeEach(() => {
  setActivePinia(createPinia())
  fakes = installFakeServices()
  const map = useMapStore()
  map.buildings = new Map([[BUILDING.id, { ...BUILDING }]])
  Object.assign(useAuthStore(), { session: { user: { id: 'user-1' } } })
})

function startScan() {
  const scan = useScanStore()
  scan.start(BUILDING.id)
  return scan
}

describe('scan store', () => {
  it('runs the full flow and applies the server-confirmed reward', async () => {
    const profile = useProfileStore()
    profile.profile = {
      id: 'u',
      username: 'x',
      avatarUrl: null,
      avatarKey: null,
      setupCompleted: true,
      level: 1,
      xp: 0,
      coins: 0,
      buildingsDiscovered: 0,
      homeDistrictId: null,
    }
    const scan = startScan()
    await scan.capture()
    expect(scan.phase).toBe('done')
    expect(scan.decision?.status).toBe('accepted')
    expect(profile.profile.xp).toBe(120)
    expect(useMapStore().buildings.get(BUILDING.id)?.discoveredAt).not.toBeNull()
    const submission = fakes.api.submitScan.mock.calls[0]![0]
    expect(submission).toMatchObject({ buildingId: BUILDING.id, modelVersion: 'test-v1', accuracyM: 10 })
    expect(submission.imageSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('TEST mode: without a recognition model, a listed tester scans by location + photo', async () => {
    fakes.recognition.isAvailable.mockReturnValue(false)
    Object.assign(services().api, { isLocationScanTester: vi.fn(async () => true) })
    const scan = startScan()
    await scan.capture()
    expect(scan.locationTestMode).toBe(true)
    expect(fakes.recognition.recognize).not.toHaveBeenCalled()
    const submission = fakes.api.submitScan.mock.calls[0]![0]
    expect(submission).toMatchObject({ buildingId: BUILDING.id, modelVersion: LOCATION_TEST_MODEL, accuracyM: 10 })
    expect(submission.embedding).toHaveLength(0)
    expect(submission.imageSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(scan.decision?.status).toBe('accepted') // the server decides, as always
  })

  it('without a model, regular players still get "recognition unavailable"', async () => {
    fakes.recognition.isAvailable.mockReturnValue(false)
    Object.assign(services().api, { isLocationScanTester: vi.fn(async () => false) })
    const scan = startScan()
    await scan.capture()
    expect(scan.failure).toEqual({ kind: 'recognition_unavailable' })
    expect(fakes.api.submitScan).not.toHaveBeenCalled()
  })

  it('web: opens the camera synchronously inside the tap (iOS Safari ignores it after an await)', async () => {
    Object.defineProperty(fakes.camera, 'requiresUserGesture', { value: true })
    const takePhoto = vi.spyOn(fakes.camera, 'takePhoto')
    const scan = startScan()
    const running = scan.capture() // not awaited: we are still "inside the tap"
    expect(takePhoto).toHaveBeenCalledTimes(1)
    await running
    expect(takePhoto).toHaveBeenCalledTimes(1) // the same photo is used, no second picker
    expect(scan.decision?.status).toBe('accepted')
  })

  it('cancel during capture returns to ready and ignores the late photo', async () => {
    let deliver: (p: { blob: Blob; previewUrl: string }) => void = () => undefined
    vi.spyOn(fakes.camera, 'takePhoto').mockImplementation(() => new Promise((r) => (deliver = r)))
    const scan = startScan()
    const running = scan.capture()
    await vi.waitFor(() => expect(scan.phase).toBe('capturing'))
    scan.cancel()
    expect(scan.phase).toBe('ready')
    deliver({ blob: new Blob(['x'], { type: 'image/jpeg' }), previewUrl: 'blob:x' })
    await running
    expect(scan.phase).toBe('ready')
    expect(fakes.api.submitScan).not.toHaveBeenCalled()
  })

  it('keeps the scan photo for the collection after an accepted scan; a failed upload changes nothing', async () => {
    const setPhoto = vi.mocked(services().api.setDiscoveryPhoto)
    setPhoto.mockRejectedValueOnce(new Error('offline'))
    const scan = startScan()
    await scan.capture()
    await vi.waitFor(() => expect(setPhoto).toHaveBeenCalledWith('user-1', BUILDING.id, expect.any(Blob), true))
    expect(scan.decision?.status).toBe('accepted') // the discovery stands regardless of the photo
  })

  it('re-scan of a discovered building adds a photo only if missing; rejected scans upload nothing', async () => {
    const setPhoto = vi.mocked(services().api.setDiscoveryPhoto)
    fakes.api.submitScan.mockResolvedValueOnce(decision({ status: 'already_discovered', reward: null }))
    await startScan().capture()
    await vi.waitFor(() => expect(setPhoto).toHaveBeenLastCalledWith('user-1', BUILDING.id, expect.any(Blob), false))
    setPhoto.mockClear()
    fakes.api.submitScan.mockResolvedValueOnce(decision({ status: 'rejected', reason: 'too_far', reward: null }))
    await startScan().capture()
    await new Promise((r) => setTimeout(r, 0))
    expect(setPhoto).not.toHaveBeenCalled()
  })

  it('reports denied camera permission', async () => {
    fakes.camera.permission = 'denied'
    const scan = startScan()
    await scan.capture()
    expect(scan.failure).toEqual({ kind: 'camera_denied' })
    expect(fakes.api.submitScan).not.toHaveBeenCalled()
  })

  it('reports denied location and disabled GPS', async () => {
    fakes.geolocation.permission = 'denied'
    const scan = startScan()
    await scan.capture()
    expect(scan.failure).toEqual({ kind: 'location_denied' })

    fakes.geolocation.permission = 'granted'
    fakes.geolocation.nextError = new GeolocationError('disabled')
    await scan.capture()
    expect(scan.failure).toEqual({ kind: 'gps_disabled' })
  })

  it('refuses inaccurate fixes and players who are too far', async () => {
    const scan = startScan()
    fakes.geolocation.setPosition(BUILDING.lat, BUILDING.lng, 400)
    await scan.capture()
    expect(scan.failure).toEqual({ kind: 'gps_inaccurate', accuracyM: 400 })

    fakes.geolocation.setPosition(BUILDING.lat + 0.01, BUILDING.lng, 10)
    await scan.capture()
    expect(scan.failure?.kind).toBe('too_far')
    expect(fakes.recognition.recognize).not.toHaveBeenCalled()
  })

  it('the GPS warmed up on the scan screen gives the position at once (no waiting on the tap)', async () => {
    const scan = startScan()
    await scan.warmUp()
    fakes.geolocation.setPosition(BUILDING.lat, BUILDING.lng, 10) // a fresh fix from the watch
    const ask = vi.spyOn(fakes.geolocation, 'getCurrentPosition')
    await scan.capture()
    expect(ask).not.toHaveBeenCalled()
    expect(scan.location).toMatchObject({ lat: BUILDING.lat, lng: BUILDING.lng })
    // after leaving the screen a tap asks again
    scan.coolDown()
    scan.start(BUILDING.id)
    await scan.capture()
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('a camera failure says where the app runs and what the camera said (shown small on screen)', async () => {
    fakes.camera.nextError = new CameraError('failed', 'cannot read captured image (0)')
    const scan = startScan()
    await scan.capture()
    expect(scan.failure).toEqual({ kind: 'camera_failed', detail: 'браузер · CameraError: cannot read captured image (0)' })
    expect(fakes.api.submitScan).not.toHaveBeenCalled()
  })

  it('returns to ready when the user cancels the camera', async () => {
    fakes.camera.nextError = new CameraError('cancelled')
    const scan = startScan()
    await scan.capture()
    expect(scan.phase).toBe('ready')
    expect(scan.failure).toBeNull()
  })

  it('does not submit poor quality or unrecognised photos', async () => {
    const scan = startScan()
    fakes.recognition.recognize.mockResolvedValueOnce(
      recognitionResult({ status: 'poor_quality', embedding: null, quality: { blurScore: 2, brightness: 20, issues: ['too_dark'] } }),
    )
    await scan.capture()
    expect(scan.phase).toBe('done')
    expect(scan.recognition?.status).toBe('poor_quality')

    fakes.recognition.recognize.mockResolvedValueOnce(recognitionResult({ status: 'other_building' }))
    await scan.capture()
    expect(scan.recognition?.status).toBe('other_building')
    expect(fakes.api.submitScan).not.toHaveBeenCalled()
  })

  it('fails clearly when no recognition model is configured', async () => {
    fakes.recognition.isAvailable.mockReturnValue(false)
    const scan = startScan()
    await scan.capture()
    expect(scan.failure).toEqual({ kind: 'recognition_unavailable' })
  })

  it('maps recognition timeouts', async () => {
    fakes.recognition.recognize.mockRejectedValueOnce(new RecognitionError('timeout'))
    const scan = startScan()
    await scan.capture()
    expect(scan.failure).toEqual({ kind: 'recognition_timeout' })
  })

  it('retries a failed submission with the same idempotency key', async () => {
    fakes.api.submitScan.mockRejectedValueOnce(new ApiError('network'))
    const scan = startScan()
    await scan.capture()
    expect(scan.failure).toEqual({ kind: 'network' })
    const firstId = fakes.api.submitScan.mock.calls[0]![0].clientRequestId

    await scan.retry()
    expect(scan.decision?.status).toBe('accepted')
    expect(fakes.api.submitScan.mock.calls[1]![0].clientRequestId).toBe(firstId)
    expect(fakes.camera).toBeDefined()
  })

  it('shows server rejections without granting anything', async () => {
    fakes.api.submitScan.mockResolvedValueOnce(decision({ status: 'rejected', reason: 'too_far', reward: null }))
    const scan = startScan()
    await scan.capture()
    expect(scan.decision?.reason).toBe('too_far')
    expect(useMapStore().buildings.get(BUILDING.id)?.discoveredAt).toBeNull()
  })

  it('clears permission errors when the app returns from settings', async () => {
    fakes.camera.permission = 'denied'
    const scan = startScan()
    await scan.capture()
    scan.onResume()
    expect(scan.phase).toBe('ready')
  })
})
