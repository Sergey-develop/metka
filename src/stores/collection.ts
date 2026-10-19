import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { services } from '@/app/providers/services'
import { type ApiError, toApiError } from '@/services/api/errors'
import type { CollectionItem, Rarity } from '@/types/game'

export const useCollectionStore = defineStore('collection', () => {
  const items = ref<CollectionItem[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<ApiError | null>(null)
  const query = ref('')
  const rarity = ref<Rarity | 'all'>('all')
  /** signed URLs of the player's own (private) discovery photos */
  const photoUrls = shallowRef(new Map<string, string>())

  const filtered = computed(() => {
    const q = query.value.trim().toLocaleLowerCase('ru')
    return items.value.filter(
      (item) =>
        (rarity.value === 'all' || item.rarity === rarity.value) &&
        (q === '' || item.name.toLocaleLowerCase('ru').includes(q)),
    )
  })

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    loading.value = true
    error.value = null
    try {
      items.value = await services().api.getCollection()
      loaded.value = true
      void loadPhotoUrls()
    } catch (e) {
      error.value = toApiError(e)
    } finally {
      loading.value = false
    }
  }

  async function loadPhotoUrls(): Promise<void> {
    const paths = items.value.flatMap((i) => (i.photoPath && !photoUrls.value.has(i.photoPath) ? [i.photoPath] : []))
    if (paths.length === 0) return
    try {
      photoUrls.value = new Map([...photoUrls.value, ...(await services().memories.photoUrls(paths))])
    } catch {
      // fall back to catalog images
    }
  }

  /** the player's photo if there is one, else the catalog image */
  function imageOf(item: CollectionItem): string | null {
    return (item.photoPath ? photoUrls.value.get(item.photoPath) : undefined) ?? item.imageUrl
  }

  function invalidate(): void {
    loaded.value = false
  }

  function reset(): void {
    items.value = []
    photoUrls.value = new Map()
    loaded.value = false
    error.value = null
  }

  return { items, filtered, loaded, loading, error, query, rarity, photoUrls, imageOf, load, invalidate, reset }
})
