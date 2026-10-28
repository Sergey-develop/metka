import { reactive, ref } from 'vue'
import { services } from '@/app/providers/services'
import { toApiError, type ApiError } from '@/services/api/errors'
import { useCollectionStore } from '@/stores/collection'
import { useMapStore } from '@/stores/map'
import { useMemoriesStore } from '@/stores/memories'
import type { MapBuilding } from '@/types/game'
import { distanceMeters } from '@/utils/geo'
import { MOSCOW_ENABLED } from '@/utils/gameAreas'
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
 * kept for the app session only. `range` is null until the questions are answered;
 * `scrollY` is where the list was scrolled when the player left it.
 */
export const swipeSession = reactive({
  mode: 'gallery' as 'gallery' | 'swipe',
  range: null as Range | null,
  seen: new Set<string>(),
  scrollY: 0,
})

/**
 * The last loaded buildings, for the app session: a page that comes back (the list after a place page)
 * shows them at once and refreshes in the background, instead of «Загружаем места…» — a short page
 * the browser could not scroll back to where the player was.
 */
let lastBuildings: MapBuilding[] = []

/**
 * Hearts on the area places (Zavidovo cards, id 'place:<slug>'): they are not buildings, so not in
 * memories (which need the building discovered) but in place_favorites. Kept for the app session.
 */
const placeFavorites = reactive(new Set<string>())
let placeFavoritesLoaded = false
const isAreaPlace = (b: MapBuilding) => b.id.startsWith('place:')

/** Game buildings of Moscow for the locations pages: loading, photo, distance and the favourite heart. */
export function usePlaces() {
  const map = useMapStore()
  const memories = useMemoriesStore()
  const collection = useCollectionStore()

  const buildings = ref<MapBuilding[]>(lastBuildings)
  const loading = ref(MOSCOW_ENABLED && lastBuildings.length === 0)
  const error = ref<ApiError | null>(null)

  async function load(): Promise<void> {
    // this list is the game buildings of Moscow (MOSCOW_BOUNDS): with Moscow off it is empty; Zavidovo shows its places
    if (!MOSCOW_ENABLED) {
      buildings.value = []
      loading.value = false
      return
    }
    loading.value = true
    error.value = null
    const [[minLng, minLat], [maxLng, maxLat]] = MOSCOW_BOUNDS
    try {
      const rows = await services().api.getBuildingsInBbox({ minLng, minLat, maxLng, maxLat })
      buildings.value = rows
      lastBuildings = rows
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

  const isFavorite = (b: MapBuilding) =>
    isAreaPlace(b) ? placeFavorites.has(b.slug) : (memories.byBuilding.get(b.id)?.isFavorite ?? false)
  /** the heart is offered on discovered buildings (memories) and on every area place */
  const canFavorite = (b: MapBuilding) => isAreaPlace(b) || !!b.discoveredAt
  const favBusy = ref<string | null>(null)
  async function toggleFavorite(b: MapBuilding): Promise<void> {
    if (favBusy.value) return
    if (isAreaPlace(b)) return togglePlaceFavorite(b)
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

  async function togglePlaceFavorite(b: MapBuilding): Promise<void> {
    const on = !placeFavorites.has(b.slug)
    favBusy.value = b.id
    // at once on the card; back as it was when the server refuses
    if (on) placeFavorites.add(b.slug)
    else placeFavorites.delete(b.slug)
    try {
      await services().api.setPlaceFavorite(b.slug, on)
    } catch {
      if (on) placeFavorites.delete(b.slug)
      else placeFavorites.add(b.slug)
    } finally {
      favBusy.value = null
    }
  }

  async function loadPlaceFavorites(): Promise<void> {
    if (placeFavoritesLoaded) return
    try {
      const ids = await services().api.getPlaceFavorites()
      placeFavorites.clear()
      for (const id of ids) placeFavorites.add(id)
      placeFavoritesLoaded = true
    } catch {
      // the hearts stay empty; the next visit to the list tries again
    }
  }

  function loadAll(): void {
    void load()
    void memories.load()
    void collection.load()
    void loadPlaceFavorites()
  }

  return { buildings, loading, error, load, loadAll, distance, photo, isFavorite, canFavorite, favBusy, toggleFavorite }
}
