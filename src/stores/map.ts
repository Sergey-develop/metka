import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { ApiError, toApiError } from '@/services/api/errors'
import type { GeoFix } from '@/services/geolocation/types'
import { GeolocationError } from '@/services/geolocation/types'
import type { Bbox, DistrictOverview, MapBuilding } from '@/types/game'
import { distanceMeters } from '@/utils/geo'

const SERVER_MAX_SPAN_DEG = 0.99 // buildings_in_bbox rejects > 1° (bbox_too_large)
const MAX_SPAN_DEG = 0.9

/** Expand the viewport so small pans don't trigger a refetch, but never past the server's 1° limit. */
function padBbox(b: Bbox, factor = 0.25): Bbox {
  const pad = (span: number) => Math.max(0, Math.min(span * factor, (SERVER_MAX_SPAN_DEG - span) / 2))
  const dx = pad(b.maxLng - b.minLng)
  const dy = pad(b.maxLat - b.minLat)
  return { minLng: b.minLng - dx, minLat: b.minLat - dy, maxLng: b.maxLng + dx, maxLat: b.maxLat + dy }
}

function contains(outer: Bbox, inner: Bbox): boolean {
  return (
    outer.minLng <= inner.minLng && outer.minLat <= inner.minLat && outer.maxLng >= inner.maxLng && outer.maxLat >= inner.maxLat
  )
}

export const useMapStore = defineStore('map', () => {
  const buildings = shallowRef(new Map<string, MapBuilding>())
  const districts = ref<DistrictOverview[]>([])
  const selectedBuildingId = ref<string | null>(null)
  const selectedDistrictId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<ApiError | null>(null)
  const zoomedOutTooFar = ref(false)

  const position = ref<GeoFix | null>(null)
  const geoError = ref<GeolocationError | null>(null)
  let stopWatch: (() => void) | null = null
  /** explanation sheet shown before the OS location prompt */
  const locationPrompt = ref(false)
  let locationPromptDismissed = false
  let loadedBbox: Bbox | null = null
  let requestSeq = 0

  const buildingList = computed(() => [...buildings.value.values()])
  const selectedBuilding = computed(() =>
    selectedBuildingId.value ? (buildings.value.get(selectedBuildingId.value) ?? null) : null,
  )
  const selectedDistrict = computed(() => districts.value.find((d) => d.id === selectedDistrictId.value) ?? null)

  function distanceTo(building: MapBuilding): number | null {
    return position.value ? distanceMeters(position.value, building) : null
  }

  async function loadViewport(viewport: Bbox): Promise<void> {
    if (viewport.maxLng - viewport.minLng > MAX_SPAN_DEG || viewport.maxLat - viewport.minLat > MAX_SPAN_DEG) {
      zoomedOutTooFar.value = true
      return
    }
    zoomedOutTooFar.value = false
    if (loadedBbox && contains(loadedBbox, viewport)) return

    const bbox = padBbox(viewport)
    const seq = ++requestSeq
    loading.value = true
    error.value = null
    try {
      const rows = await services().api.getBuildingsInBbox(bbox)
      if (seq !== requestSeq) return // a newer request superseded this one
      const next = new Map(buildings.value)
      for (const row of rows) next.set(row.id, row)
      buildings.value = next
      loadedBbox = bbox
    } catch (e) {
      if (seq === requestSeq) error.value = toApiError(e)
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  async function loadDistricts(): Promise<void> {
    try {
      districts.value = await services().api.getDistrictsOverview()
    } catch (e) {
      error.value = toApiError(e)
    }
  }

  /** Forces the next viewport load (e.g. after returning from background). */
  function invalidate(): void {
    loadedBbox = null
  }

  function markDiscovered(buildingId: string, at = new Date().toISOString()): void {
    const b = buildings.value.get(buildingId)
    if (!b || b.discoveredAt) return
    const next = new Map(buildings.value)
    next.set(buildingId, { ...b, discoveredAt: at })
    buildings.value = next
    void loadDistricts()
  }

  function select(buildingId: string | null): void {
    selectedBuildingId.value = buildingId
    if (buildingId) selectedDistrictId.value = null
  }

  function selectDistrict(districtId: string | null): void {
    selectedDistrictId.value = districtId
    if (districtId) selectedBuildingId.value = null
  }

  /**
   * The system prompt is never shown cold: an explanation sheet comes first.
   * 'auto' (map opened / app resumed) shows it unless dismissed this session,
   * 'user' (locate button) always shows it, 'confirmed' asks the OS.
   */
  async function startTracking(mode: 'auto' | 'user' | 'confirmed' = 'auto'): Promise<void> {
    if (stopWatch) return
    const geo = services().geolocation
    geoError.value = null
    try {
      let permission = await geo.checkPermission()
      if (permission === 'prompt' && mode !== 'confirmed') {
        locationPrompt.value = mode === 'user' || !locationPromptDismissed
        return
      }
      locationPrompt.value = false
      if (permission === 'prompt') permission = await geo.requestPermission()
      if (permission === 'denied') {
        geoError.value = new GeolocationError('permission_denied')
        return
      }
      stopWatch = await geo.watchPosition(
        (fix) => {
          position.value = fix
          geoError.value = null
        },
        (err) => {
          geoError.value = err
        },
      )
    } catch (e) {
      geoError.value = e instanceof GeolocationError ? e : new GeolocationError('unavailable', String(e))
    }
  }

  function dismissLocationPrompt(): void {
    locationPrompt.value = false
    locationPromptDismissed = true
  }

  /** Stop GPS while backgrounded to save battery. */
  function stopTracking(): void {
    stopWatch?.()
    stopWatch = null
  }

  function reset(): void {
    stopTracking()
    buildings.value = new Map()
    districts.value = []
    selectedBuildingId.value = null
    selectedDistrictId.value = null
    loadedBbox = null
    position.value = null
    locationPrompt.value = false
    locationPromptDismissed = false
  }

  return {
    buildings,
    buildingList,
    districts,
    selectedBuildingId,
    selectedBuilding,
    selectedDistrictId,
    selectedDistrict,
    loading,
    error,
    zoomedOutTooFar,
    position,
    geoError,
    distanceTo,
    loadViewport,
    loadDistricts,
    invalidate,
    markDiscovered,
    select,
    selectDistrict,
    startTracking,
    locationPrompt,
    dismissLocationPrompt,
    stopTracking,
    reset,
  }
})
