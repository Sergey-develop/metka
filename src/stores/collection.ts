import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
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
    } catch (e) {
      error.value = toApiError(e)
    } finally {
      loading.value = false
    }
  }

  function invalidate(): void {
    loaded.value = false
  }

  function reset(): void {
    items.value = []
    loaded.value = false
    error.value = null
  }

  return { items, filtered, loaded, loading, error, query, rarity, load, invalidate, reset }
})
