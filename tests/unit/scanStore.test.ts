import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/services/api/errors'
import { CameraError } from '@/services/camera/types'
import { GeolocationError } from '@/services/geolocation/types'
import { RecognitionError } from '@/services/recognition/types'
import { useMapStore } from '@/stores/map'
import { useProfileStore } from '@/stores/profile'
import { useScanStore } from '@/stores/scan'
import { BUILDING, decision, installFakeServices, recognitionResult } from './helpers'

let fakes: ReturnType<typeof installFakeServices>

beforeEach(() => {
  setActivePinia(createPinia())
  fakes = installFakeServices()
  const map = useMapStore()
  map.buildings = new Map([[BUILDING.id, { ...BUILDING }]])
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
