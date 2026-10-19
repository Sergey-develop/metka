import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { ApiError, toApiError } from '@/services/api/errors'
import type { ExplorationStatus, ExplorationTracker, SyncState } from '@/services/exploration/explorationTracker'
import { cellKey, type Cell } from '@/services/exploration/grid'
import type { Bbox } from '@/types/game'
import { useAuthStore } from './auth'

/** Cells (~22 m) are only fetched/drawn this close in. */
export const EXPLORED_MIN_ZOOM = 13
const SERVER_MAX_SPAN_DEG = 0.2
const MAX_CACHED = 50_000

function padBbox(b: Bbox, factor = 0.5): Bbox {
  const pad = (span: number) => Math.max(0, Math.min(span * factor, (SERVER_MAX_SPAN_DEG * 0.99 - span) / 2))
  const dx = pad(b.maxLng - b.minLng)
  const dy = pad(b.maxLat - b.minLat)
  return { minLng: b.minLng - dx, minLat: b.minLat - dy, maxLng: b.maxLng + dx, maxLat: b.maxLat + dy }
}

const contains = (o: Bbox, i: Bbox) => o.minLng <= i.minLng && o.minLat <= i.minLat && o.maxLng >= i.maxLng && o.maxLat >= i.maxLat

/**
 * "Исследование": the player's explored cells (server-authoritative) and the GPS tracker that
 * reveals new ones. Tracking runs only while the player has it switched on and the app is in the
 * foreground (main.ts pauses it in the background). Separate from discovered buildings.
 */
export const useExplorationStore = defineStore('exploration', () => {
  /** player's intent; tracking itself also needs permission and the foreground */
  const enabled = ref(false)
  const status = ref<ExplorationStatus>('off')
  const accuracyM = ref<number | null>(null)
  const pending = ref(0)
  /** 'saved' only after the server confirmed — never optimistic */
  const sync = ref<SyncState>('idle')
  const totalCells = ref<number | null>(null)
  /** cells revealed during this session */
  const sessionCells = ref(0)
  const cells = shallowRef(new Map<string, Cell>())
  const error = ref<ApiError | null>(null)

  let tracker: ExplorationTracker | null = null
  let loaded: Bbox | null = null
  let controller: AbortController | null = null

  const cellList = computed(() => [...cells.value.values()])

  function merge(newCells: readonly Cell[]): void {
    if (newCells.length === 0) return
    const next = cells.value.size + newCells.length > MAX_CACHED ? new Map<string, Cell>() : new Map(cells.value)
    for (const c of newCells) next.set(cellKey(c), c)
    cells.value = next
  }

  function ensureTracker(): ExplorationTracker {
    if (tracker) return tracker
    const t = services().createExplorationTracker(useAuthStore().userId)
    t.onChange((s) => {
      status.value = s.status
      accuracyM.value = s.accuracyM
      pending.value = s.pending
      sync.value = s.sync
      if (s.status === 'permission_denied' || s.status === 'disabled') enabled.value = false
    })
    t.onResult((r) => {
      error.value = null
      merge(r.newCells)
      sessionCells.value += r.newCells.length
      totalCells.value = r.totalCells
    })
    t.onUploadError((e) => {
      error.value = toApiError(e)
    })
    tracker = t
    return t
  }

  async function enable(): Promise<void> {
    enabled.value = true
    await ensureTracker().start()
  }

  async function disable(): Promise<void> {
    enabled.value = false
    await tracker?.stop()
  }

  function toggle(): Promise<void> {
    return enabled.value ? disable() : enable()
  }

  /** App went to the background: stop GPS, keep the switch on. */
  async function pause(): Promise<void> {
    if (enabled.value) await tracker?.stop()
  }

  /** Back in the foreground: resume if the player left it on. */
  async function resume(): Promise<void> {
    if (enabled.value) await ensureTracker().start()
  }

  async function loadViewport(viewport: Bbox, zoom: number): Promise<void> {
    if (zoom < EXPLORED_MIN_ZOOM) return
    if (viewport.maxLng - viewport.minLng > SERVER_MAX_SPAN_DEG * 0.99 || viewport.maxLat - viewport.minLat > SERVER_MAX_SPAN_DEG * 0.99) return
    if (loaded && contains(loaded, viewport)) return
    controller?.abort()
    const own = new AbortController()
    controller = own
    const bbox = padBbox(viewport)
    try {
      const page = await services().api.getExploredCells(bbox, own.signal)
      if (own.signal.aborted) return
      merge(page.cells)
      totalCells.value = page.totalCells
      loaded = page.truncated ? null : bbox
      error.value = null
    } catch (e) {
      const err = toApiError(e)
      if (err.code !== 'cancelled' && !own.signal.aborted) error.value = err
    } finally {
      if (controller === own) controller = null
    }
  }

  function invalidate(): void {
    loaded = null
  }

  async function reset(): Promise<void> {
    enabled.value = false
    controller?.abort()
    controller = null
    await tracker?.stop()
    tracker = null
    cells.value = new Map()
    loaded = null
    status.value = 'off'
    accuracyM.value = null
    pending.value = 0
    sync.value = 'idle'
    totalCells.value = null
    sessionCells.value = 0
    error.value = null
  }

  return {
    enabled,
    status,
    accuracyM,
    pending,
    sync,
    totalCells,
    sessionCells,
    cells,
    cellList,
    error,
    enable,
    disable,
    toggle,
    pause,
    resume,
    loadViewport,
    invalidate,
    reset,
  }
})
