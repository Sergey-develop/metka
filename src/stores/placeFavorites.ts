import { defineStore } from 'pinia'
import { ref } from 'vue'
import { services } from '@/app/providers/services'

/**
 * Hearts on the area places (Zavidovo cards): they are not buildings, so not in memories (which need
 * the building discovered) but in place_favorites (migration 041). Ids are area_places ids.
 */
export const usePlaceFavoritesStore = defineStore('placeFavorites', () => {
  const ids = ref(new Set<string>())
  const loaded = ref(false)
  const busy = ref<string | null>(null)

  const has = (placeId: string) => ids.value.has(placeId)

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    try {
      ids.value = new Set(await services().api.getPlaceFavorites())
      loaded.value = true
    } catch {
      // the hearts stay as they were; the next visit tries again
    }
  }

  function set(placeId: string, on: boolean): void {
    const next = new Set(ids.value)
    if (on) next.add(placeId)
    else next.delete(placeId)
    ids.value = next
  }

  /** at once on the card; back as it was when the server refuses */
  async function toggle(placeId: string): Promise<void> {
    if (busy.value) return
    const on = !has(placeId)
    busy.value = placeId
    set(placeId, on)
    try {
      await services().api.setPlaceFavorite(placeId, on)
    } catch {
      set(placeId, !on)
    } finally {
      busy.value = null
    }
  }

  function reset(): void {
    ids.value = new Set()
    loaded.value = false
    busy.value = null
  }

  return { ids, loaded, busy, has, load, toggle, reset }
})
