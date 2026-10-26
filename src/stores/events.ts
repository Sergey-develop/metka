import { defineStore } from 'pinia'
import { ref } from 'vue'
import { services } from '@/app/providers/services'
import { type ApiError, toApiError } from '@/services/api/errors'
import type { GameEvent } from '@/types/game'

/** The events feed (events_feed, migration 018). One event is loaded by its own screen. */
export const useEventsStore = defineStore('events', () => {
  const items = ref<GameEvent[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<ApiError | null>(null)

  async function load(): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = null
    try {
      items.value = await services().api.getEvents()
      loaded.value = true
    } catch (e) {
      // keep what was shown before
      error.value = toApiError(e)
    } finally {
      loading.value = false
    }
  }

  /** an event changed on its own screen (sign-up): keep the feed in step without a refetch */
  function replace(event: GameEvent): void {
    const i = items.value.findIndex((e) => e.id === event.id)
    if (i >= 0) items.value[i] = event
  }

  function reset(): void {
    items.value = []
    loaded.value = false
    error.value = null
  }

  return { items, loaded, loading, error, load, replace, reset }
})
