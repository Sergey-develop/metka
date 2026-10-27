import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { type ApiError, toApiError } from '@/services/api/errors'
import { GeolocationError } from '@/services/geolocation/types'
import type { AreaPlace, AreaQuests, ArtifactRef, CheckInResult, RouteStep, StepResult } from '@/types/game'
import type { GameAreaId } from '@/utils/gameAreas'
import { useProfileStore } from './profile'

/** what the step card shows after a tap */
export type StepOutcome =
  | { kind: 'done'; xp: number; coins: number; artifacts: ArtifactRef[]; routeCompleted: boolean }
  | { kind: 'too_far'; distanceM: number }
  | { kind: 'wrong_answer' }
  | { kind: 'no_position'; code: GeolocationError['code'] }
  | { kind: 'camera' }
  | { kind: 'error'; error: ApiError }

/** Quest routes, places and artifacts of a game area (area_quests, migration 026). */
export const useAreaQuestsStore = defineStore('areaQuests', () => {
  const area = ref<GameAreaId>('zavidovo')
  const data = shallowRef<AreaQuests | null>(null)
  const loading = ref(false)
  const error = ref<ApiError | null>(null)
  const busyStep = ref<string | null>(null)
  /** photos of photo steps stay on the device for the session (not uploaded) */
  const photos = ref<Record<string, string>>({})

  const routes = computed(() => data.value?.routes ?? [])

  async function load(force = false): Promise<void> {
    if (loading.value || (data.value && !force)) return
    loading.value = true
    error.value = null
    try {
      data.value = await services().api.getAreaQuests(area.value)
    } catch (e) {
      error.value = toApiError(e)
    } finally {
      loading.value = false
    }
  }

  function markDone(stepId: string, routeCompleted: boolean): void {
    if (!data.value) return
    const now = new Date().toISOString()
    data.value = {
      ...data.value,
      routes: data.value.routes.map((r) => {
        if (!r.steps.some((s) => s.id === stepId)) return r
        return {
          ...r,
          completedAt: routeCompleted ? (r.completedAt ?? now) : r.completedAt,
          steps: r.steps.map((s) => (s.id === stepId ? { ...s, doneAt: s.doneAt ?? now } : s)),
        }
      }),
    }
  }

  function markEarned(artifacts: ArtifactRef[]): void {
    if (!data.value || artifacts.length === 0) return
    const ids = new Set(artifacts.map((a) => a.id))
    const now = new Date().toISOString()
    data.value = {
      ...data.value,
      collections: data.value.collections.map((c) => ({
        ...c,
        items: c.items.map((i) => (ids.has(i.id) ? { ...i, earnedAt: i.earnedAt ?? now } : i)),
      })),
    }
  }

  /** a fresh GPS fix for a check on the server */
  async function freshPosition(): Promise<{ lat: number; lng: number; accuracyM: number } | StepOutcome> {
    try {
      const fix = await services().geolocation.getCurrentPosition({ timeoutMs: 15_000, maxAgeMs: 5_000 })
      return { lat: fix.lat, lng: fix.lng, accuracyM: Math.max(fix.accuracyM, 1) }
    } catch (e) {
      return { kind: 'no_position', code: e instanceof GeolocationError ? e.code : 'unavailable' }
    }
  }

  /**
   * Sends the step to the server: with a fresh GPS fix when the step has a place, and the chosen
   * option for a question. The server decides; nothing is marked done before it answers.
   */
  async function complete(step: RouteStep, answer: number | null = null): Promise<StepOutcome | null> {
    if (busyStep.value) return null
    busyStep.value = step.id
    try {
      let position: { lat: number; lng: number; accuracyM: number } | null = null
      if (step.place) {
        const fix = await freshPosition()
        if ('kind' in fix) return fix
        position = fix
      }
      let result: StepResult
      try {
        result = await services().api.completeRouteStep(step.id, position, answer)
      } catch (e) {
        return { kind: 'error', error: toApiError(e) }
      }
      if (result.status === 'too_far') return { kind: 'too_far', distanceM: result.distanceM }
      if (result.status === 'wrong_answer') return { kind: 'wrong_answer' }
      if (result.status === 'already_done') {
        markDone(step.id, false)
        // the route may have been finished by this very step on a lost response: reload the truth
        void load(true)
        return { kind: 'done', xp: 0, coins: 0, artifacts: [], routeCompleted: false }
      }
      useProfileStore().applyStats(result.profile)
      markDone(step.id, result.routeCompleted)
      markEarned(result.artifacts)
      return { kind: 'done', xp: result.reward.xp, coins: result.reward.coins, artifacts: result.artifacts, routeCompleted: result.routeCompleted }
    } finally {
      busyStep.value = null
    }
  }

  const visited = computed(() => new Set((data.value?.visits ?? []).map((v) => v.placeId)))
  const busyPlace = ref<string | null>(null)

  function markVisited(placeId: string): void {
    if (!data.value || visited.value.has(placeId)) return
    data.value = { ...data.value, visits: [...data.value.visits, { placeId, visitedAt: new Date().toISOString() }] }
  }

  /** «Отметиться» at a place: the server checks the position, rewards once */
  async function checkIn(place: AreaPlace): Promise<StepOutcome | null> {
    if (busyPlace.value) return null
    busyPlace.value = place.id
    try {
      const position = await freshPosition()
      if ('kind' in position) return position
      let result: CheckInResult
      try {
        result = await services().api.checkInPlace(place.id, position)
      } catch (e) {
        return { kind: 'error', error: toApiError(e) }
      }
      if (result.status === 'too_far') return { kind: 'too_far', distanceM: result.distanceM }
      markVisited(place.id)
      if (result.status === 'already_done') return { kind: 'done', xp: 0, coins: 0, artifacts: [], routeCompleted: false }
      useProfileStore().applyStats(result.profile)
      markEarned(result.artifacts)
      return { kind: 'done', xp: result.reward.xp, coins: result.reward.coins, artifacts: result.artifacts, routeCompleted: false }
    } finally {
      busyPlace.value = null
    }
  }

  function setPhoto(stepId: string, url: string): void {
    const old = photos.value[stepId]
    if (old) URL.revokeObjectURL(old)
    photos.value = { ...photos.value, [stepId]: url }
  }

  function reset(): void {
    for (const url of Object.values(photos.value)) URL.revokeObjectURL(url)
    photos.value = {}
    data.value = null
    error.value = null
  }

  return { area, data, routes, loading, error, busyStep, busyPlace, visited, photos, load, complete, checkIn, setPhoto, reset }
})
