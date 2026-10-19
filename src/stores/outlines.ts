import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { ApiError, toApiError } from '@/services/api/errors'
import type { Bbox, BuildingOutline } from '@/types/game'

/** Footprints are only requested this close in; game buildings stay visible as points below it. */
export const OUTLINES_MIN_ZOOM = 15
const SERVER_MAX_SPAN_DEG = 0.1 // osm_buildings_in_bbox rejects larger bboxes (bbox_too_large)
const DEBOUNCE_MS = 250
/** Above this many cached footprints the cache is replaced instead of merged (memory bound). */
const MAX_CACHED = 6000
/** After a failure, automatic loads pause; the retry button (invalidate) resumes at once. */
const ERROR_BACKOFF_MS = 30_000

function padBbox(b: Bbox, factor = 0.25): Bbox {
  const pad = (span: number) => Math.max(0, Math.min(span * factor, (SERVER_MAX_SPAN_DEG * 0.99 - span) / 2))
  const dx = pad(b.maxLng - b.minLng)
  const dy = pad(b.maxLat - b.minLat)
  return { minLng: b.minLng - dx, minLat: b.minLat - dy, maxLng: b.maxLng + dx, maxLat: b.maxLat + dy }
}

function contains(outer: Bbox, inner: Bbox): boolean {
  return (
    outer.minLng <= inner.minLng && outer.minLat <= inner.minLat && outer.maxLng >= inner.maxLng && outer.maxLat >= inner.maxLat
  )
}

/**
 * Map layers B + C: OSM building footprints in the viewport with their game state.
 * Engine-agnostic — the map component reports viewport changes (on move end) and renders `outlines`.
 */
export const useOutlinesStore = defineStore('outlines', () => {
  const outlines = shallowRef(new Map<number, BuildingOutline>())
  const selectedId = ref<number | null>(null)
  const loading = ref(false)
  const error = ref<ApiError | null>(null)
  const truncated = ref(false)
  /** viewport is zoomed out past OUTLINES_MIN_ZOOM or wider than the server allows */
  const tooFar = ref(false)

  let loaded: { bbox: Bbox; zoom: number } | null = null
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let pausedUntil = 0

  const list = computed(() => [...outlines.value.values()])
  const selected = computed(() => (selectedId.value === null ? null : (outlines.value.get(selectedId.value) ?? null)))
  /** game buildings drawn as footprints, so the map can hide their fallback points */
  const gameIdsWithOutline = computed(() => new Set(list.value.flatMap((o) => (o.game ? [o.game.id] : []))))

  async function load(viewport: Bbox, zoom: number): Promise<void> {
    const z = Math.floor(zoom)
    if (
      z < OUTLINES_MIN_ZOOM ||
      viewport.maxLng - viewport.minLng > SERVER_MAX_SPAN_DEG * 0.99 ||
      viewport.maxLat - viewport.minLat > SERVER_MAX_SPAN_DEG * 0.99
    ) {
      tooFar.value = true
      return
    }
    tooFar.value = false
    if (Date.now() < pausedUntil) return
    // reuse what is loaded unless we zoomed in past it (geometry was simplified for a lower zoom)
    if (loaded && contains(loaded.bbox, viewport) && loaded.zoom >= z) return

    controller?.abort()
    const own = new AbortController()
    controller = own
    const bbox = padBbox(viewport)
    loading.value = true
    error.value = null
    try {
      const page = await services().api.getBuildingOutlines(bbox, z, own.signal)
      if (own.signal.aborted) return
      const next = outlines.value.size + page.features.length > MAX_CACHED ? new Map<number, BuildingOutline>() : new Map(outlines.value)
      for (const feature of page.features) next.set(feature.id, feature)
      if (selectedId.value !== null && !next.has(selectedId.value)) {
        const keep = outlines.value.get(selectedId.value)
        if (keep) next.set(keep.id, keep)
      }
      outlines.value = next
      truncated.value = page.truncated
      // a truncated answer does not cover the bbox: fetch again on the next move
      loaded = page.truncated ? null : { bbox, zoom: z }
    } catch (e) {
      const err = toApiError(e)
      if (err.code !== 'cancelled' && !own.signal.aborted) {
        error.value = err
        pausedUntil = Date.now() + ERROR_BACKOFF_MS
      }
    } finally {
      if (controller === own) {
        controller = null
        loading.value = false
      }
    }
  }

  /** Call on map move end; bursts of events collapse into one request. */
  function onViewport(viewport: Bbox, zoom: number): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void load(viewport, zoom)
    }, DEBOUNCE_MS)
  }

  function select(id: number | null): void {
    selectedId.value = id !== null && outlines.value.has(id) ? id : null
  }

  /** Forces the next viewport load (e.g. after a scan or returning from background). */
  function invalidate(): void {
    loaded = null
    pausedUntil = 0
  }

  function markDiscovered(gameBuildingId: string, at = new Date().toISOString()): void {
    const hit = list.value.find((o) => o.game?.id === gameBuildingId)
    if (!hit?.game || hit.game.discoveredAt) return
    const next = new Map(outlines.value)
    next.set(hit.id, { ...hit, game: { ...hit.game, discoveredAt: at } })
    outlines.value = next
  }

  function reset(): void {
    if (timer) clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
    outlines.value = new Map()
    selectedId.value = null
    loading.value = false
    error.value = null
    truncated.value = false
    tooFar.value = false
    loaded = null
    pausedUntil = 0
  }

  return {
    outlines,
    list,
    selectedId,
    selected,
    gameIdsWithOutline,
    loading,
    error,
    truncated,
    tooFar,
    load,
    onViewport,
    select,
    invalidate,
    markDiscovered,
    reset,
  }
})
