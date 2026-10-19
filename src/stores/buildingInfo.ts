import { defineStore } from 'pinia'
import { shallowRef, type ShallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { type ApiError, toApiError } from '@/services/api/errors'
import type { BuildingFacts, BuildingOrganization } from '@/types/game'

export type Entry<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; error: ApiError }
export type InfoEntry = { state: 'loading' } | { state: 'ready'; facts: BuildingFacts } | { state: 'error'; error: ApiError }

const CACHE_LIMIT = 200

/** One cached, de-duplicated loader per kind of building data. */
function cachedLoader<T>(fetch: (id: number) => Promise<T>) {
  const entries: ShallowRef<Map<number, Entry<T>>> = shallowRef(new Map())
  const inFlight = new Map<number, Promise<void>>()

  function set(id: number, entry: Entry<T>): void {
    const next = new Map(entries.value)
    next.delete(id) // re-insert: most recent last
    next.set(id, entry)
    while (next.size > CACHE_LIMIT) next.delete(next.keys().next().value as number)
    entries.value = next
  }

  function load(id: number, force: boolean): Promise<void> {
    const current = entries.value.get(id)
    if (current?.state === 'ready' || (current?.state === 'error' && !force)) return Promise.resolve()
    const pending = inFlight.get(id)
    if (pending) return pending
    set(id, { state: 'loading' })
    const run = (async () => {
      try {
        set(id, { state: 'ready', data: await fetch(id) })
      } catch (e) {
        set(id, { state: 'error', error: toApiError(e) })
      } finally {
        inFlight.delete(id)
      }
    })()
    inFlight.set(id, run)
    return run
  }

  function reset(): void {
    entries.value = new Map()
    inFlight.clear()
  }

  return { entries, load, reset }
}

/** Card data per OSM building: facts and organisations, cached, one request at a time per building. */
export const useBuildingInfoStore = defineStore('buildingInfo', () => {
  const facts = cachedLoader((id) => services().api.getBuildingFacts(id))
  const orgs = cachedLoader((id) => services().api.getBuildingOrganizations(id))

  function get(id: number): InfoEntry | null {
    const e = facts.entries.value.get(id)
    if (!e) return null
    return e.state === 'ready' ? { state: 'ready', facts: e.data } : e
  }

  function organizations(id: number): Entry<BuildingOrganization[]> | null {
    return orgs.entries.value.get(id) ?? null
  }

  /** Loads unless already loaded or loading; `force` retries after an error. */
  async function load(id: number, force = false): Promise<void> {
    await Promise.all([facts.load(id, force), orgs.load(id, force)])
  }

  function reset(): void {
    facts.reset()
    orgs.reset()
  }

  return { get, organizations, load, reset }
})
