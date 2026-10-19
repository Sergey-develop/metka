import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { ApiError, toApiError } from '@/services/api/errors'
import type { MemoryPlace } from '@/services/memories/memoriesService'
import type { Memory, MemoryDraft } from '@/types/game'
import { useAuthStore } from './auth'

/** Album of memories. Separate from the collection (unlocked buildings) and from explored territory. */
export const useMemoriesStore = defineStore('memories', () => {
  const items = ref<Memory[]>([])
  const photoUrls = shallowRef(new Map<string, string>())
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<ApiError | null>(null)
  const favoritesOnly = ref(false)

  const byBuilding = computed(() => new Map(items.value.map((m) => [m.buildingId, m])))
  const visible = computed(() => (favoritesOnly.value ? items.value.filter((m) => m.isFavorite) : items.value))

  /** signed URL of the memory photo for a building, if the player attached one */
  function photoOf(buildingId: string): string | null {
    const path = byBuilding.value.get(buildingId)?.photoPath
    return (path ? photoUrls.value.get(path) : undefined) ?? null
  }

  async function refreshPhotoUrls(memories: Memory[]): Promise<void> {
    const paths = memories.flatMap((m) => (m.photoPath && !photoUrls.value.has(m.photoPath) ? [m.photoPath] : []))
    if (paths.length === 0) return
    try {
      const urls = await services().memories.photoUrls(paths)
      photoUrls.value = new Map([...photoUrls.value, ...urls])
    } catch {
      // photos are optional decoration: the album still works without them
    }
  }

  async function load(force = false): Promise<void> {
    if (loading.value || (loaded.value && !force)) return
    loading.value = true
    error.value = null
    try {
      items.value = await services().memories.list()
      loaded.value = true
      void refreshPhotoUrls(items.value)
    } catch (e) {
      error.value = toApiError(e)
    } finally {
      loading.value = false
    }
  }

  /** Throws ApiError so the form can show it; the list changes only after the server confirmed. */
  async function save(draft: MemoryDraft, place: MemoryPlace): Promise<Memory> {
    const userId = useAuthStore().userId
    if (!userId) throw new ApiError('unauthorized')
    try {
      const saved = await services().memories.save(userId, draft, byBuilding.value.get(draft.buildingId) ?? null, place)
      items.value = [saved, ...items.value.filter((m) => m.buildingId !== saved.buildingId)]
      await refreshPhotoUrls([saved])
      return saved
    } catch (e) {
      throw toApiError(e)
    }
  }

  async function remove(buildingId: string): Promise<void> {
    try {
      await services().memories.remove(buildingId)
      items.value = items.value.filter((m) => m.buildingId !== buildingId)
    } catch (e) {
      throw toApiError(e)
    }
  }

  function reset(): void {
    items.value = []
    photoUrls.value = new Map()
    loaded.value = false
    error.value = null
    favoritesOnly.value = false
  }

  return { items, visible, byBuilding, photoUrls, photoOf, loading, loaded, error, favoritesOnly, load, save, remove, reset }
})
