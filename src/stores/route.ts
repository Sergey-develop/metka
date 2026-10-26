import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { services } from '@/app/providers/services'
import type { GeoFix } from '@/services/geolocation/types'
import { RoutingError, type RoutingErrorCode, type WalkingRoute } from '@/services/routing/types'
import type { MapBuilding } from '@/types/game'
import { distanceMeters } from '@/utils/geo'
import { useMapStore } from './map'

/** the route is rebuilt once the player is this far from where it was built… */
export const REBUILD_AFTER_M = 40
/** …but not more often than this */
export const REBUILD_MIN_INTERVAL_MS = 10_000
/** closer than this (or the scan radius) the player has arrived */
export const ARRIVED_M = 25

export type RouteState = 'idle' | 'waiting_position' | 'loading' | 'ready' | 'arrived' | 'error'

/** A walking route from the player to a game place, drawn on our map and kept fresh as they walk. */
export const useRouteStore = defineStore('route', () => {
  const map = useMapStore()
  const target = shallowRef<MapBuilding | null>(null)
  const route = shallowRef<WalkingRoute | null>(null)
  const state = ref<RouteState>('idle')
  const errorCode = ref<RoutingErrorCode | null>(null)
  /** bumps on every new destination: the map fits the first route of each */
  const generation = ref(0)
  let builtFrom: GeoFix | null = null
  let builtAt = 0
  let controller: AbortController | null = null

  const active = computed(() => target.value !== null)

  function arrivedAt(fix: GeoFix, place: MapBuilding): boolean {
    return distanceMeters(fix, place) <= Math.max(ARRIVED_M, place.scanRadiusM)
  }

  async function build(fix: GeoFix): Promise<void> {
    const place = target.value
    if (!place) return
    controller?.abort()
    const own = new AbortController()
    controller = own
    builtFrom = fix
    builtAt = Date.now()
    if (!route.value) state.value = 'loading'
    try {
      const next = await services().routing.walking(fix, place, own.signal)
      if (own.signal.aborted || target.value !== place) return
      route.value = next
      errorCode.value = null
      state.value = 'ready'
    } catch (e) {
      if (own.signal.aborted || target.value !== place) return
      // a failed refresh keeps the route already on the map
      if (route.value) return
      errorCode.value = e instanceof RoutingError ? e.code : 'unavailable'
      state.value = 'error'
    } finally {
      if (controller === own) controller = null
    }
  }

  function onFix(fix: GeoFix | null): void {
    const place = target.value
    if (!place || !fix) return
    if (arrivedAt(fix, place)) {
      controller?.abort()
      route.value = null
      state.value = 'arrived'
      return
    }
    if (state.value === 'error' || controller) return
    const stale =
      !route.value || state.value === 'arrived' ||
      (builtFrom !== null && distanceMeters(builtFrom, fix) > REBUILD_AFTER_M && Date.now() - builtAt >= REBUILD_MIN_INTERVAL_MS)
    if (stale) void build(fix)
  }

  watch(() => map.position, onFix)

  function start(place: MapBuilding): void {
    stop()
    target.value = place
    generation.value++
    if (map.position) onFix(map.position)
    else state.value = 'waiting_position'
  }

  function retry(): void {
    if (!target.value) return
    errorCode.value = null
    route.value = null
    if (map.position) {
      state.value = 'loading'
      void build(map.position)
    } else state.value = 'waiting_position'
  }

  function stop(): void {
    controller?.abort()
    controller = null
    target.value = null
    route.value = null
    state.value = 'idle'
    errorCode.value = null
    builtFrom = null
    builtAt = 0
  }

  return { target, route, state, errorCode, generation, active, start, retry, stop }
})
