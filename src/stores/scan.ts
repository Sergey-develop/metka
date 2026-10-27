import { Capacitor } from '@capacitor/core'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { ApiError, toApiError } from '@/services/api/errors'
import { CameraError, type CapturedPhoto } from '@/services/camera/types'
import { GeolocationError, type GeoFix } from '@/services/geolocation/types'
import { sha256Hex } from '@/services/recognition/imageMath'
import { RecognitionError, type RecognitionResult } from '@/services/recognition/types'
import type { MapBuilding, ScanDecision, ScanSubmission } from '@/types/game'
import { allowedScanDistance, distanceMeters, MAX_ACCURACY_M } from '@/utils/geo'
import { useCollectionStore } from './collection'
import { prepareMemoryPhoto } from '@/utils/avatarImage'
import { useAuthStore } from './auth'
import { useMapStore } from './map'
import { useOutlinesStore } from './outlines'
import { useProfileStore } from './profile'
import { useAchievementAlertsStore } from './achievementAlerts'
import { useQuestsStore } from './quests'

export type ScanPhase = 'ready' | 'locating' | 'capturing' | 'analyzing' | 'submitting' | 'done' | 'failed'

export type ScanFailure =
  | { kind: 'building_unknown' }
  | { kind: 'recognition_unavailable' }
  | { kind: 'camera_denied' }
  | { kind: 'camera_unavailable' }
  /** detail: where the app runs and what the camera said — shown small, there are no dev tools on a phone */
  | { kind: 'camera_failed'; detail: string }
  | { kind: 'location_denied' }
  | { kind: 'gps_disabled' }
  | { kind: 'gps_unavailable' }
  | { kind: 'gps_inaccurate'; accuracyM: number }
  | { kind: 'too_far'; distanceM: number; allowedM: number }
  | { kind: 'recognition_timeout' }
  | { kind: 'recognition_failed' }
  | { kind: 'offline' }
  | { kind: 'network' }
  | { kind: 'server'; message: string }

/** model_version accepted by submit_building_scan for listed testers only (migration 009) */
export const LOCATION_TEST_MODEL = 'location-test-v1'

export const useScanStore = defineStore('scan', () => {
  /** bumped by every capture() and cancel(): results of an abandoned attempt are dropped */
  let runId = 0
  /** TEST ONLY: this account scans by location without recognition (see checkLocationTester) */
  const locationTestMode = ref(false)
  let testerCheck: Promise<boolean> | null = null
  const phase = ref<ScanPhase>('ready')
  const buildingId = ref<string | null>(null)
  const failure = ref<ScanFailure | null>(null)
  const recognition = shallowRef<RecognitionResult | null>(null)
  const decision = ref<ScanDecision | null>(null)
  const photo = shallowRef<CapturedPhoto | null>(null)
  const location = ref<GeoFix | null>(null)
  /** kept so a network failure can be retried with the same idempotency key */
  const pendingSubmission = shallowRef<ScanSubmission | null>(null)
  let controller: AbortController | null = null
  /** explanation sheet shown before the first OS camera prompt */
  const cameraPrompt = ref(false)
  let cameraExplained = false

  const busy = computed(() => ['locating', 'capturing', 'analyzing', 'submitting'].includes(phase.value))
  const building = computed<MapBuilding | null>(() =>
    buildingId.value ? (useMapStore().buildings.get(buildingId.value) ?? null) : null,
  )

  function fail(f: ScanFailure): void {
    failure.value = f
    phase.value = 'failed'
  }

  function releasePhoto(): void {
    if (photo.value) services().camera.release(photo.value)
    photo.value = null
  }

  function start(id: string): void {
    cancel()
    releasePhoto()
    buildingId.value = id
    phase.value = 'ready'
    failure.value = null
    recognition.value = null
    decision.value = null
    pendingSubmission.value = null
  }

  async function ensurePermissions(): Promise<boolean> {
    const { camera, geolocation } = services()
    try {
      let cam = await camera.checkPermission()
      if (cam === 'prompt' && !cameraExplained) {
        // explain why before the OS prompt; confirmCamera() resumes the capture
        cameraPrompt.value = true
        return false
      }
      if (cam === 'prompt') cam = await camera.requestPermission()
      if (cam === 'denied') {
        fail({ kind: 'camera_denied' })
        return false
      }
    } catch {
      fail({ kind: 'camera_unavailable' })
      return false
    }
    try {
      let geo = await geolocation.checkPermission()
      if (geo === 'prompt') geo = await geolocation.requestPermission()
      if (geo === 'denied') {
        fail({ kind: 'location_denied' })
        return false
      }
    } catch (e) {
      fail(e instanceof GeolocationError && e.code === 'disabled' ? { kind: 'gps_disabled' } : { kind: 'location_denied' })
      return false
    }
    return true
  }

  /**
   * GPS kept on while the scan screen is open, so a tap usually finds a fresh fix at once instead of
   * waiting for a cold GPS («Определяем местоположение…» spun for many seconds). Never prompts: without
   * permission the tap asks as before.
   */
  let liveFix: GeoFix | null = null
  let unwatch: (() => void) | null = null
  let warming = false
  async function warmUp(): Promise<void> {
    if (unwatch || warming) return
    warming = true
    try {
      const { geolocation } = services()
      if ((await geolocation.checkPermission()) !== 'granted') return
      const stop = await geolocation.watchPosition(
        (fix) => {
          liveFix = fix
          // the «N м от вас» line follows the player too
          useMapStore().position = fix
        },
        () => undefined,
      )
      if (!warming) return stop() // left the screen meanwhile
      unwatch = stop
    } catch {
      // no warm-up: the tap asks for a position itself
    } finally {
      warming = false
    }
  }
  function coolDown(): void {
    warming = false
    unwatch?.()
    unwatch = null
    liveFix = null
  }

  /** a fix from the warm GPS this fresh is used at once */
  const LIVE_FIX_MAX_AGE_MS = 15_000

  async function locate(target: MapBuilding): Promise<GeoFix | null> {
    phase.value = 'locating'
    let fix: GeoFix
    const live = liveFix
    try {
      fix =
        live && Date.now() - live.timestamp <= LIVE_FIX_MAX_AGE_MS && live.accuracyM <= MAX_ACCURACY_M
          ? live
          : await services().geolocation.getCurrentPosition({ timeoutMs: 10_000, maxAgeMs: LIVE_FIX_MAX_AGE_MS })
    } catch (e) {
      const code = e instanceof GeolocationError ? e.code : 'unavailable'
      fail(
        code === 'permission_denied'
          ? { kind: 'location_denied' }
          : code === 'disabled'
            ? { kind: 'gps_disabled' }
            : { kind: 'gps_unavailable' },
      )
      return null
    }
    location.value = fix
    if (fix.accuracyM > MAX_ACCURACY_M) {
      fail({ kind: 'gps_inaccurate', accuracyM: Math.round(fix.accuracyM) })
      return null
    }
    const distanceM = distanceMeters(fix, target)
    const allowedM = allowedScanDistance(target.scanRadiusM, fix.accuracyM)
    if (distanceM > allowedM) {
      fail({ kind: 'too_far', distanceM: Math.round(distanceM), allowedM: Math.round(allowedM) })
      return null
    }
    return fix
  }

  /**
   * TEST ONLY: while there is no recognition model (ADR-001), accounts listed in
   * location_scan_testers scan by location + photo; the server checks the list (migration 009).
   */
  async function checkLocationTester(): Promise<boolean> {
    // any failure (offline, old server without migration 009) means "not a tester"
    testerCheck ??= (async () => services().api.isLocationScanTester())().catch(() => false)
    locationTestMode.value = await testerCheck
    return locationTestMode.value
  }

  /** Full flow: permissions -> location -> photo -> recognition -> server verdict. */
  async function capture(): Promise<void> {
    const target = building.value
    if (!target) return fail({ kind: 'building_unknown' })
    const { camera, recognition: recognizer } = services()
    const run = ++runId
    // Web: open the camera picker right now, inside the tap — after any await Safari ignores it.
    // Location is determined while the player takes the photo.
    const canProceedNow = recognizer.isAvailable() || locationTestMode.value
    const earlyPhoto = camera.requiresUserGesture && canProceedNow ? camera.takePhoto() : null
    let earlyPhotoUsed = false
    earlyPhoto?.then(
      (p) => {
        if (!earlyPhotoUsed) camera.release(p) // flow stopped earlier (too far, cancelled…)
      },
      () => undefined,
    )

    const locationTest = !recognizer.isAvailable() && (await checkLocationTester())
    if (run !== runId) return
    if (!recognizer.isAvailable() && !locationTest) return fail({ kind: 'recognition_unavailable' })

    failure.value = null
    recognition.value = null
    decision.value = null
    if (!(await ensurePermissions())) return
    if (run !== runId) return
    const fix = await locate(target)
    if (!fix || run !== runId) return

    phase.value = 'capturing'
    releasePhoto()
    try {
      earlyPhotoUsed = true
      const taken = await (earlyPhoto ?? camera.takePhoto())
      if (run !== runId) {
        camera.release(taken)
        return
      }
      photo.value = taken
    } catch (e) {
      if (run !== runId) return
      const code = e instanceof CameraError ? e.code : 'failed'
      if (code === 'cancelled') {
        phase.value = 'ready'
        return
      }
      if (code === 'permission_denied') return fail({ kind: 'camera_denied' })
      if (code === 'unavailable') return fail({ kind: 'camera_unavailable' })
      const where = Capacitor.isNativePlatform() ? 'приложение' : 'браузер'
      const what = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      return fail({ kind: 'camera_failed', detail: `${where} · ${what}`.slice(0, 300) })
    }

    if (locationTest) {
      pendingSubmission.value = {
        clientRequestId: crypto.randomUUID(),
        buildingId: target.id,
        lat: fix.lat,
        lng: fix.lng,
        accuracyM: fix.accuracyM,
        modelVersion: LOCATION_TEST_MODEL,
        embedding: new Float32Array(0),
        imageSha256: await sha256Hex(photo.value.blob),
        quality: null,
      }
      await submit()
      return
    }

    phase.value = 'analyzing'
    controller = new AbortController()
    let result: RecognitionResult
    try {
      result = await recognizer.recognize(
        { image: photo.value.blob, targetBuildingId: target.id, location: fix },
        { signal: controller.signal, timeoutMs: 20_000 },
      )
    } catch (e) {
      if (e instanceof RecognitionError) {
        if (e.code === 'aborted') {
          phase.value = 'ready'
          return
        }
        if (e.code === 'timeout') return fail({ kind: 'recognition_timeout' })
        if (e.code === 'matching_failed') return fail(navigator.onLine === false ? { kind: 'offline' } : { kind: 'network' })
      }
      return fail({ kind: 'recognition_failed' })
    } finally {
      controller = null
    }
    recognition.value = result

    if (result.status === 'unavailable') return fail({ kind: 'recognition_unavailable' })
    // Nothing worth sending: the UI explains how to retake the photo.
    if (result.status === 'poor_quality' || result.status === 'not_recognized' || result.status === 'other_building') {
      phase.value = 'done'
      return
    }
    if (!result.embedding || !result.modelVersion) return fail({ kind: 'recognition_failed' })

    pendingSubmission.value = {
      clientRequestId: crypto.randomUUID(),
      buildingId: target.id,
      lat: fix.lat,
      lng: fix.lng,
      accuracyM: fix.accuracyM,
      modelVersion: result.modelVersion,
      embedding: result.embedding,
      imageSha256: await sha256Hex(photo.value.blob),
      quality: result.quality ? { blurScore: result.quality.blurScore, brightness: result.quality.brightness } : null,
    }
    await submit()
  }

  async function attachDiscoveryPhoto(buildingId: string, blob: Blob, replace: boolean): Promise<void> {
    const userId = useAuthStore().userId
    if (!userId) return
    try {
      const image = await prepareMemoryPhoto(blob)
      await services().api.setDiscoveryPhoto(userId, buildingId, image, replace)
      useCollectionStore().invalidate()
    } catch {
      // the building stays discovered; it just has no photo in the collection
    }
  }

  /** Sends (or re-sends with the same idempotency key) the pending submission. */
  async function submit(): Promise<void> {
    const submission = pendingSubmission.value
    if (!submission) return
    phase.value = 'submitting'
    failure.value = null
    let verdict: ScanDecision
    try {
      verdict = await services().api.submitScan(submission)
    } catch (e) {
      const error = toApiError(e)
      if (error.code === 'offline') return fail({ kind: 'offline' })
      if (error.code === 'network') return fail({ kind: 'network' })
      return fail({ kind: 'server', message: error instanceof ApiError ? error.code : 'server' })
    }
    decision.value = verdict
    pendingSubmission.value = null
    phase.value = 'done'

    if (verdict.status === 'accepted' || verdict.status === 'already_discovered') {
      // keep the photo for the collection (best effort: the discovery itself is already confirmed)
      if (photo.value) void attachDiscoveryPhoto(submission.buildingId, photo.value.blob, verdict.status === 'accepted')
      useMapStore().markDiscovered(submission.buildingId)
      useOutlinesStore().markDiscovered(submission.buildingId)
      useCollectionStore().invalidate()
    }
    if (verdict.status === 'accepted') {
      useProfileStore().applyStats(verdict.profile)
      useQuestsStore().invalidate()
      // shown over whatever page the player goes to next (AchievementUnlocked)
      if (verdict.completedQuests.length) useAchievementAlertsStore().push(verdict.completedQuests)
    }
  }

  /** Retry after a failure: resubmits if a submission is pending, otherwise restarts capture. */
  async function retry(): Promise<void> {
    if (pendingSubmission.value) return submit()
    return capture()
  }

  /** Abandons the current attempt at any step (a late photo or GPS result is ignored). */
  function cancel(): void {
    runId++
    controller?.abort()
    controller = null
    if (phase.value === 'locating' || phase.value === 'capturing') phase.value = 'ready'
  }

  function confirmCamera(): Promise<void> {
    cameraPrompt.value = false
    cameraExplained = true
    return capture()
  }

  function dismissCameraPrompt(): void {
    cameraPrompt.value = false
  }

  /** After returning from background (e.g. from system settings), clear permission errors. */
  function onResume(): void {
    const kind = failure.value?.kind
    if (phase.value === 'failed' && (kind === 'camera_denied' || kind === 'location_denied' || kind === 'gps_disabled')) {
      phase.value = 'ready'
      failure.value = null
    }
  }

  function reset(): void {
    coolDown()
    testerCheck = null
    locationTestMode.value = false
    cancel()
    releasePhoto()
    cameraPrompt.value = false
    cameraExplained = false
    buildingId.value = null
    phase.value = 'ready'
    failure.value = null
    recognition.value = null
    decision.value = null
    pendingSubmission.value = null
  }

  return {
    phase,
    locationTestMode,
    checkLocationTester,
    buildingId,
    building,
    failure,
    recognition,
    decision,
    photo,
    location,
    pendingSubmission,
    busy,
    cameraPrompt,
    start,
    capture,
    confirmCamera,
    dismissCameraPrompt,
    submit,
    retry,
    cancel,
    onResume,
    warmUp,
    coolDown,
    reset,
  }
})
