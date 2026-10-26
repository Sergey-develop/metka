import { reactive, ref } from 'vue'
import { services } from '@/app/providers/services'
import { toApiError, type ApiError } from '@/services/api/errors'
import { useCollectionStore } from '@/stores/collection'
import { useMapStore } from '@/stores/map'
import { useMemoriesStore } from '@/stores/memories'
import type { MapBuilding } from '@/types/game'
import { distanceMeters } from '@/utils/geo'
import { MOSCOW_BOUNDS } from '@/utils/mapGeometry'
import type { Range } from './SwipeSetup.vue'

/** walking at ~5 km/h, rounded to a 5-minute range as in the mockup ("15-20 мин.") */
export function walkTime(meters: number | null): string | null {
  if (meters === null) return null
  const minutes = meters / 83
  if (minutes <= 5) return 'до 5 мин.'
  if (minutes > 120) return null
  const hi = Math.ceil(minutes / 5) * 5
  return `${hi - 5}-${hi} мин.`
}

/**
 * The swipe mode survives a trip to a place page and back (the view is recreated):
 * kept for the app session only. `range` is null until the questions are answered.
 */
export const swipeSession = reactive({
  mode: 'gallery' as 'gallery' | 'swipe',
  range: null as Range | null,
  seen: new Set<string>(),
})

/** Game buildings of Moscow for the locations pages: loading, photo, distance and the favourite heart. */
export function usePlaces() {
  const map = useMapStore()
  const memories = useMemoriesStore()
  const collection = useCollectionStore()

  const buildings = ref<MapBuilding[]>([])
  const loading = ref(true)
  const error = ref<ApiError | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    const [[minLng, minLat], [maxLng, maxLat]] = MOSCOW_BOUNDS
    try {
      const rows = await services().api.getBuildingsInBbox({ minLng, minLat, maxLng, maxLat })
      buildings.value = rows
      // the map shows the card of a building picked here
      const next = new Map(map.buildings)
      for (const row of rows) next.set(row.id, row)
      map.buildings = next
    } catch (e) {
      error.value = toApiError(e)
    } finally {
      loading.value = false
    }
  }

  const distance = (b: MapBuilding) => (map.position ? distanceMeters(map.position, b) : null)

  function photo(b: MapBuilding): string | null {
    const own = collection.items.find((i) => i.buildingId === b.id)
    return memories.photoOf(b.id) ?? (own ? collection.imageOf(own) : null) ?? b.imageUrl
  }

  const isFavorite = (b: MapBuilding) => memories.byBuilding.get(b.id)?.isFavorite ?? false
  const favBusy = ref<string | null>(null)
  async function toggleFavorite(b: MapBuilding): Promise<void> {
    if (favBusy.value) return
    const current = memories.byBuilding.get(b.id)
    favBusy.value = b.id
    try {
      await memories.save(
        {
          buildingId: b.id,
          note: current?.note ?? '',
          visitedOn: current?.visitedOn ?? null,
          impression: current?.impression ?? null,
          isFavorite: !isFavorite(b),
        },
        { buildingName: b.name, address: b.address, rarity: b.rarity },
      )
    } catch {
      // the heart simply stays as it was; the album shows errors in detail
    } finally {
      favBusy.value = null
    }
  }

  function loadAll(): void {
    void load()
    void memories.load()
    void collection.load()
  }

  return { buildings, loading, error, load, loadAll, distance, photo, isFavorite, favBusy, toggleFavorite }
}
