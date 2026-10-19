import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { ApiError, toApiError } from '@/services/api/errors'
import type { ExplorationStatus, ExplorationTracker, SyncState } from '@/services/exploration/explorationTracker'
import { cellKey, type Cell } from '@/services/exploration/grid'
import type { Bbox } from '@/types/game'
import { useAuthStore } from './auth'

/**
 * Cells (~11 m) are fetched from this zoom (the server limits a request to 0.2°). The fog appears at
 * street level (basemap from zoom 11.5); between 11.5 and 12 only cells already cached are cut out.
 */
export const EXPLORED_MIN_ZOOM = 12
const SERVER_MAX_SPAN_DEG = 0.2
const MAX_CACHED = 50_000
/** freshly revealed cells are highlighted this long */
export const RECENT_MS = 12_000

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
  /** the player paused exploring (GPS off, nothing revealed) without switching the mode off */
  const paused = ref(false)
  const status = ref<ExplorationStatus>('off')
  const accuracyM = ref<number | null>(null)
  const pending = ref(0)
  /** 'saved' only after the server confirmed — never optimistic */
  const sync = ref<SyncState>('idle')
  const totalCells = ref<number | null>(null)
  /** cells revealed during this session */
  const sessionCells = ref(0)
  const cells = shallowRef(new Map<string, Cell>())
  /** cells revealed in the last RECENT_MS, with the time they arrived */
  const recent = shallowRef(new Map<string, { cell: Cell; at: number }>())
  /** size of the last batch of newly revealed cells, for a short "+N" notice */
  const lastGain = ref<{ count: number; at: number } | null>(null)
  const error = ref<ApiError | null>(null)

  let tracker: ExplorationTracker | null = null
  let loaded: Bbox | null = null
  let controller: AbortController | null = null
  let recentTimer: ReturnType<typeof setTimeout> | null = null

  const cellList = computed(() => [...cells.value.values()])
  const recentList = computed(() => [...recent.value.values()].map((r) => r.cell))

  /** drops highlights older than RECENT_MS; re-arms itself while anything is highlighted */
  function expireRecent(): void {
    recentTimer = null
    const now = Date.now()
    const next = new Map([...recent.value].filter(([, r]) => now - r.at < RECENT_MS))
    if (next.size !== recent.value.size) recent.value = next
    if (lastGain.value && now - lastGain.value.at >= RECENT_MS) lastGain.value = null
    if (next.size > 0 || lastGain.value) recentTimer = setTimeout(expireRecent, 1000)
  }

  function markRecent(newCells: readonly Cell[]): void {
    if (newCells.length === 0) return
    const now = Date.now()
    const next = new Map(recent.value)
    for (const c of newCells) next.set(cellKey(c), { cell: c, at: now })
    recent.value = next
    lastGain.value = { count: newCells.length, at: now }
    recentTimer ??= setTimeout(expireRecent, 1000)
  }

  /** Adds cells; the map (and so cellList and the fog) changes only if something is actually new. */
  function merge(newCells: readonly Cell[]): void {
    const fresh = newCells.filter((c) => !cells.value.has(cellKey(c)))
    if (fresh.length === 0) return
    const next = cells.value.size + fresh.length > MAX_CACHED ? new Map<string, Cell>() : new Map(cells.value)
    for (const c of fresh) next.set(cellKey(c), c)
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
      if (s.status === 'permission_denied' || s.status === 'disabled') {
        enabled.value = false
        paused.value = false
      }
    })
    t.onResult((r) => {
      error.value = null
      merge(r.newCells)
      markRecent(r.newCells)
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
    paused.value = false
    await ensureTracker().start()
  }

  async function disable(): Promise<void> {
    enabled.value = false
    paused.value = false
    await tracker?.stop()
  }

  function toggle(): Promise<void> {
    return enabled.value ? disable() : enable()
  }

  /**
   * The player pauses exploring: GPS stops and buffered points are uploaded. Nothing is revealed
   * across the pause — the server starts a new segment after a gap of more than 30 s.
   */
  async function pauseByPlayer(): Promise<void> {
    if (!enabled.value || paused.value) return
    paused.value = true
    await tracker?.stop()
  }

  async function resumeByPlayer(): Promise<void> {
    if (!enabled.value || !paused.value) return
    paused.value = false
    await ensureTracker().start()
  }

  /** App went to the background: stop GPS, keep the switch on. */
  async function pause(): Promise<void> {
    if (enabled.value) await tracker?.stop()
  }

  /** Back in the foreground: resume if the player left it on and did not pause it. */
  async function resume(): Promise<void> {
    if (enabled.value && !paused.value) await ensureTracker().start()
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
    paused.value = false
    if (recentTimer) clearTimeout(recentTimer)
    recentTimer = null
    recent.value = new Map()
    lastGain.value = null
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
    paused,
    status,
    accuracyM,
    pending,
    sync,
    totalCells,
    sessionCells,
    cells,
    cellList,
    recentList,
    lastGain,
    error,
    enable,
    disable,
    toggle,
    pause,
    resume,
    pauseByPlayer,
    resumeByPlayer,
    loadViewport,
    invalidate,
    reset,
  }
})
