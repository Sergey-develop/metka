import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { ApiError, toApiError } from '@/services/api/errors'
import {
  emptyDiagnostics,
  type ExplorationStatus,
  type ExplorationTracker,
  type SyncState,
  type TrackerDiagnostics,
} from '@/services/exploration/explorationTracker'
import { cellBounds, cellKey, type Cell } from '@/services/exploration/grid'
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
 * reveals new ones. Tracking runs while the player has it switched on; in a browser only in the
 * foreground (main.ts pauses it in the background), in the native app also with the phone in a pocket
 * (background location). Separate from discovered buildings.
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
  /** cells revealed in the last RECENT_MS, with the time they arrived */
  const recent = shallowRef(new Map<string, { cell: Cell; at: number }>())
  /** size of the last batch of newly revealed cells, for a short "+N" notice */
  const lastGain = ref<{ count: number; at: number } | null>(null)
  const error = ref<ApiError | null>(null)
  /** explored cells for the current viewport are being fetched */
  const loadingViewport = ref(false)
  const diagnostics = ref<TrackerDiagnostics>(emptyDiagnostics())
  /** times the app went to the background while exploring (GPS stops there) */
  const backgroundStops = ref(0)
  /** the screen is being kept on while exploring */
  const screenKeptOn = ref(false)
  let wakeUnsub: (() => void) | null = null

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
    const readDiagnostics = () => {
      if (t.diagnostics) diagnostics.value = t.diagnostics
    }
    t.onChange((s) => {
      readDiagnostics()
      status.value = s.status
      accuracyM.value = s.accuracyM
      pending.value = s.pending
      sync.value = s.sync
      if (s.status === 'permission_denied' || s.status === 'disabled') {
        enabled.value = false
        syncWakeLock()
      }
    })
    t.onResult((r) => {
      readDiagnostics()
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

  /**
   * keep the screen on exactly while exploring is on — in a browser only: GPS stops with the screen
   * there; the native app explores in the background, so the screen may go dark (battery)
   */
  function syncWakeLock(): void {
    const wakeLock = services().wakeLock
    wakeUnsub ??= wakeLock.onChange((active) => (screenKeptOn.value = active))
    if (enabled.value && !services().backgroundExploration) void wakeLock.keepOn().then((ok) => (screenKeptOn.value = ok))
    else void wakeLock.release().then(() => (screenKeptOn.value = false))
  }

  async function enable(): Promise<void> {
    enabled.value = true
    syncWakeLock()
    await ensureTracker().start()
  }

  async function disable(): Promise<void> {
    enabled.value = false
    syncWakeLock()
    await tracker?.stop()
  }

  /**
   * Exploring is always on while the app is open: it starts by itself on the map once location access
   * is granted (the map asks for it with its own explanation first; this never prompts). Stopped only
   * in the background (pause/resume from main.ts). Safe to call repeatedly.
   */
  async function autoStart(): Promise<void> {
    if (enabled.value) return
    try {
      if ((await services().geolocation.checkPermission()) !== 'granted') return
    } catch {
      return
    }
    if (enabled.value) return
    await enable()
  }

  /** App went to the background: stop GPS, keep the switch on. */
  async function pause(): Promise<void> {
    if (!enabled.value) return
    backgroundStops.value++
    await tracker?.stop()
  }

  /** Back in the foreground: resume if the player left it on and did not pause it. */
  async function resume(): Promise<void> {
    if (enabled.value) await ensureTracker().start()
  }

  /**
   * Where the player explored last: the newest cell and the explored cells around it (≈1 km), as
   * [[minLng, minLat], [maxLng, maxLat]]; null when nothing is explored yet. Also adds those cells
   * to the cache so the fog opens there at once.
   */
  async function latestExploredArea(): Promise<[[number, number], [number, number]] | null> {
    const recent = await services().api.getRecentExploredCells()
    const newest = recent[0]
    if (!newest) return null
    merge(recent)
    const near = recent.filter((c) => Math.abs(c[0] - newest[0]) <= 90 && Math.abs(c[1] - newest[1]) <= 90)
    const b = near.map(cellBounds)
    return [
      [Math.min(...b.map((x) => x[0])), Math.min(...b.map((x) => x[1]))],
      [Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))],
    ]
  }

  /** Is any cached explored cell inside this box? */
  function anyExploredIn(box: Bbox): boolean {
    for (const c of cells.value.values()) {
      const [minLng, minLat, maxLng, maxLat] = cellBounds(c)
      if (maxLng >= box.minLng && minLng <= box.maxLng && maxLat >= box.minLat && minLat <= box.maxLat) return true
    }
    return false
  }

  async function loadViewport(viewport: Bbox, zoom: number): Promise<void> {
    if (zoom < EXPLORED_MIN_ZOOM) return
    if (viewport.maxLng - viewport.minLng > SERVER_MAX_SPAN_DEG * 0.99 || viewport.maxLat - viewport.minLat > SERVER_MAX_SPAN_DEG * 0.99) return
    if (loaded && contains(loaded, viewport)) return
    controller?.abort()
    const own = new AbortController()
    controller = own
    const bbox = padBbox(viewport)
    loadingViewport.value = true
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
      if (controller === own) {
        controller = null
        loadingViewport.value = false
      }
    }
  }

  function invalidate(): void {
    loaded = null
  }

  async function reset(): Promise<void> {
    enabled.value = false
    syncWakeLock()
    wakeUnsub?.()
    wakeUnsub = null
    diagnostics.value = emptyDiagnostics()
    backgroundStops.value = 0
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
    diagnostics,
    backgroundStops,
    screenKeptOn,
    enable,
    disable,
    autoStart,
    pause,
    resume,
    loadViewport,
    invalidate,
    reset,
    latestExploredArea,
    anyExploredIn,
    loadingViewport,
  }
})
