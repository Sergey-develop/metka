import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { type ApiError, toApiError } from '@/services/api/errors'
import type { CameraPreviewHandle } from '@/services/camera/preview'
import { CameraError } from '@/services/camera/types'
import { GeolocationError, type GeoFix } from '@/services/geolocation/types'
import type { HeadingReading } from '@/services/orientation/types'
import { rankCandidates, type MatchResult, type ScanHeading } from '@/services/scan/candidates'
import { SelectionStabilizer, type Selection } from '@/services/scan/stabilizer'
import type { BuildingOutline } from '@/types/game'
import { distanceMeters } from '@/utils/geo'
import { useBuildingInfoStore } from './buildingInfo'

export type ArScanPhase = 'idle' | 'starting' | 'running' | 'failed'
export type ArScanFailure = 'camera_denied' | 'camera_unavailable' | 'camera_failed' | 'location_denied' | 'gps_disabled'
export type GpsState = 'waiting' | 'ok' | 'lost'
export type HeadingState = 'waiting' | 'ok' | 'flat' | 'needs_permission' | 'unavailable'
export type OutlinesState = 'idle' | 'loading' | 'ready' | 'error'

/** nearby footprints are fetched for this radius and refetched after moving this far */
const FETCH_RADIUS_M = 250
const REFETCH_AFTER_M = 100
/** distance on the card only with a reasonably precise fix */
const DISTANCE_MAX_ACCURACY_M = 20
const RECOMPUTE_MS = 200
const HEADING_SMOOTHING = 0.3
const M_PER_DEG_LAT = 110_540

/**
 * Camera-first scan screen (/scan): which building is in front of the camera, by GPS + compass +
 * OSM footprints. Approximate by design (see services/scan/candidates.ts); it never unlocks
 * anything — the game action goes through the verified /scan/:buildingId flow.
 */
export const useArScanStore = defineStore('arScan', () => {
  const phase = ref<ArScanPhase>('idle')
  const failure = ref<ArScanFailure | null>(null)
  const gps = ref<GpsState>('waiting')
  const position = ref<GeoFix | null>(null)
  const headingState = ref<HeadingState>('waiting')
  const heading = ref<ScanHeading | null>(null)
  const outlines = shallowRef<BuildingOutline[]>([])
  const outlinesState = ref<OutlinesState>('idle')
  const outlinesError = ref<ApiError | null>(null)
  const match = shallowRef<MatchResult | null>(null)
  const selection = ref<Selection>({ id: null, manual: false })

  let stabilizer = new SelectionStabilizer()
  let token = 0
  let camera: CameraPreviewHandle | null = null
  let stopGeo: (() => void) | null = null
  let stopHeading: (() => void) | null = null
  let fetchController: AbortController | null = null
  let fetchedAt: GeoFix | null = null
  let lastCompute = 0
  let smooth: { x: number; y: number } | null = null

  const selectedOutline = computed(() => {
    const id = selection.value.id
    if (id === null) return null
    return outlines.value.find((o) => o.id === id) ?? null
  })

  const distanceM = computed(() => {
    const id = selection.value.id
    const fix = position.value
    if (id === null || !fix || fix.accuracyM > DISTANCE_MAX_ACCURACY_M) return null
    const seen = match.value?.candidates.find((c) => c.outline.id === id)?.distanceM
    const near = match.value?.nearby.find((n) => n.outline.id === id)?.distanceM
    const d = seen ?? near
    return d === undefined ? null : d
  })

  function fail(f: ArScanFailure): void {
    failure.value = f
    phase.value = 'failed'
    release()
  }

  function setSelection(next: Selection): void {
    const changed = next.id !== selection.value.id || next.manual !== selection.value.manual
    if (!changed) return
    selection.value = next
    if (next.id !== null) void useBuildingInfoStore().load(next.id)
  }

  /**
   * Picks the building in view. Once a card is open (detected or chosen) detection is held: the card
   * stays put however the compass and GPS jitter, until the player closes it (close()).
   */
  function recompute(force = false): void {
    const fix = position.value
    if (!fix || outlinesState.value !== 'ready') return
    if (selection.value.id !== null) return
    const now = Date.now()
    if (!force && now - lastCompute < RECOMPUTE_MS) return
    lastCompute = now
    match.value = rankCandidates(fix, headingState.value === 'ok' ? heading.value : null, outlines.value)
    setSelection(stabilizer.update(match.value, now))
  }

  async function fetchOutlines(fix: GeoFix): Promise<void> {
    fetchController?.abort()
    const controller = new AbortController()
    fetchController = controller
    fetchedAt = fix
    const dLat = FETCH_RADIUS_M / M_PER_DEG_LAT
    const dLng = dLat / Math.cos((fix.lat * Math.PI) / 180)
    if (outlines.value.length === 0) outlinesState.value = 'loading'
    outlinesError.value = null
    try {
      const page = await services().api.getBuildingOutlines(
        { minLng: fix.lng - dLng, minLat: fix.lat - dLat, maxLng: fix.lng + dLng, maxLat: fix.lat + dLat },
        18,
        controller.signal,
      )
      if (controller !== fetchController) return
      outlines.value = page.features
      outlinesState.value = 'ready'
      recompute(true)
    } catch (e) {
      if (controller !== fetchController) return
      const error = toApiError(e)
      if (error.code === 'cancelled') return
      outlinesError.value = error
      fetchedAt = null // allow the next fix (or retry) to try again
      if (outlines.value.length === 0) outlinesState.value = 'error'
    } finally {
      if (controller === fetchController) fetchController = null
    }
  }

  function onFix(fix: GeoFix): void {
    position.value = fix
    gps.value = 'ok'
    if (!fetchController && (!fetchedAt || distanceMeters(fetchedAt, fix) > REFETCH_AFTER_M)) void fetchOutlines(fix)
    recompute(true)
  }

  function onGeoError(error: GeolocationError): void {
    if (error.code === 'permission_denied') return fail('location_denied')
    if (error.code === 'disabled') return fail('gps_disabled')
    gps.value = 'lost' // timeout/unavailable: keep watching, the next fix recovers
  }

  function onHeading(reading: HeadingReading): void {
    if (!reading.upright) {
      headingState.value = 'flat'
      heading.value = null
      smooth = null
      recompute()
      return
    }
    const rad = (reading.deg * Math.PI) / 180
    const x = Math.sin(rad)
    const y = Math.cos(rad)
    smooth = smooth
      ? { x: smooth.x + (x - smooth.x) * HEADING_SMOOTHING, y: smooth.y + (y - smooth.y) * HEADING_SMOOTHING }
      : { x, y }
    const deg = ((Math.atan2(smooth.x, smooth.y) * 180) / Math.PI + 360) % 360
    heading.value = { deg, accuracyDeg: reading.accuracyDeg }
    const becameUsable = headingState.value !== 'ok'
    headingState.value = 'ok'
    recompute(becameUsable)
  }

  function watchHeading(): void {
    stopHeading?.()
    stopHeading = services().orientation.watchHeading(onHeading, () => {
      if (headingState.value === 'waiting') headingState.value = 'unavailable'
    })
  }

  async function startHeading(): Promise<void> {
    const { orientation } = services()
    if (!orientation.isSupported()) {
      headingState.value = 'unavailable'
      return
    }
    const permission = await orientation.requestPermission()
    if (permission === 'granted') watchHeading()
    else headingState.value = permission === 'prompt' ? 'needs_permission' : 'unavailable'
  }

  /** iOS: the compass permission must be asked from a tap. */
  async function enableCompass(): Promise<void> {
    headingState.value = 'waiting'
    await startHeading()
  }

  async function start(video: HTMLVideoElement): Promise<void> {
    stop()
    const run = ++token
    phase.value = 'starting'
    failure.value = null
    const { cameraPreview, geolocation } = services()

    try {
      const handle = await cameraPreview.start(video)
      if (run !== token) return handle.stop()
      camera = handle
    } catch (e) {
      if (run !== token) return
      const code = e instanceof CameraError ? e.code : 'failed'
      return fail(code === 'permission_denied' ? 'camera_denied' : code === 'unavailable' ? 'camera_unavailable' : 'camera_failed')
    }

    try {
      let permission = await geolocation.checkPermission()
      if (permission === 'prompt') permission = await geolocation.requestPermission()
      if (run !== token) return
      if (permission === 'denied') return fail('location_denied')
      const unsubscribe = await geolocation.watchPosition(onFix, onGeoError)
      if (run !== token) return unsubscribe()
      stopGeo = unsubscribe
    } catch (e) {
      if (run !== token) return
      return fail(e instanceof GeolocationError && e.code === 'disabled' ? 'gps_disabled' : 'location_denied')
    }

    phase.value = 'running'
    await startHeading()
  }

  function retryOutlines(): void {
    if (position.value && !fetchController) void fetchOutlines(position.value)
  }

  function choose(id: number): void {
    setSelection(stabilizer.choose(id))
  }

  /** the player closed the card: detection resumes from scratch */
  function close(): void {
    setSelection(stabilizer.release())
    recompute(true)
  }

  /** stops sensors and the camera; keeps the fetched footprints for a quick restart */
  function release(): void {
    token++
    camera?.stop()
    camera = null
    stopGeo?.()
    stopGeo = null
    stopHeading?.()
    stopHeading = null
    fetchController?.abort()
    fetchController = null
  }

  function stop(): void {
    release()
    phase.value = 'idle'
    failure.value = null
    gps.value = 'waiting'
    position.value = null
    headingState.value = 'waiting'
    heading.value = null
    smooth = null
    match.value = null
    stabilizer = new SelectionStabilizer()
    selection.value = { id: null, manual: false }
    if (outlinesState.value === 'loading') outlinesState.value = outlines.value.length ? 'ready' : 'idle'
    fetchedAt = null
  }

  return {
    phase,
    failure,
    gps,
    position,
    headingState,
    heading,
    outlines,
    outlinesState,
    outlinesError,
    match,
    selection,
    selectedOutline,
    distanceM,
    start,
    stop,
    enableCompass,
    retryOutlines,
    choose,
    close,
  }
})
