<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import AppIcon from '@/components/ui/AppIcon.vue'
import FigureLoader from '@/components/ui/FigureLoader.vue'
import LevelProgress from '@/components/ui/LevelProgress.vue'
import CategoryChips from '@/components/ui/CategoryChips.vue'
import PermissionSheet from '@/components/ui/PermissionSheet.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import WalletStreak from '@/components/ui/WalletStreak.vue'
import ClanAvatar from '@/features/clans/ClanAvatar.vue'
import { useClanStore } from '@/stores/clan'
import { useExplorationStore } from '@/stores/exploration'
import { useMemoriesStore } from '@/stores/memories'
import { useMapStore } from '@/stores/map'
import { useOutlinesStore } from '@/stores/outlines'
import { useProfileStore } from '@/stores/profile'
import { useRouteStore } from '@/stores/route'
import { useTasksStore } from '@/stores/tasks'
import type { ExplorationStatus } from '@/services/exploration/explorationTracker'
import { DEFAULT_FILTER } from '@/services/exploration/trackFilter'
import { toApiError } from '@/services/api/errors'
import { STREET_LEVEL_ZOOM, type MapViewport } from '@/services/map/types'
import type { MapBuilding } from '@/types/game'
import BuildingCard from './BuildingCard.vue'
import ClanSheet from './ClanSheet.vue'
import DistrictCard from './DistrictCard.vue'
import ExplorationDiagnostics from './ExplorationDiagnostics.vue'
import MapCanvas from './MapCanvas.vue'
import OutlineCard from './OutlineCard.vue'
import RouteCard from './RouteCard.vue'
import TasksSheet from './TasksSheet.vue'
import MemoryEditor from '@/features/album/MemoryEditor.vue'
import { gameAreaAt, ZAVIDOVO_HOME, type GameAreaId } from '@/utils/gameAreas'
import { usePlaces } from '@/features/locations/places'
import { hasPoint, mapCategory, PLACE_CHIPS, placeTarget } from '@/features/routes/routes'
import { useAreaQuestsStore } from '@/stores/areaQuests'

const map = useMapStore()
const outlines = useOutlinesStore()
const exploration = useExplorationStore()
const memories = useMemoriesStore()
/** unlocked building whose memory is being edited */
const memoryFor = ref<MapBuilding | null>(null)
const profile = useProfileStore()
const clan = useClanStore()
const tasks = useTasksStore()
const route = useRouteStore()
/** a card fills the bottom of the map: the clan and tasks buttons step aside */
const cardOpen = computed(() => !!(map.selectedBuilding || map.selectedDistrict || outlines.selected))
/** the route card (mockup «карта с меткой») keeps the clan and tasks buttons, lifted above it */
const routeCard = computed(() => route.active && !cardOpen.value && !(diagnosticsOpen.value && exploration.enabled))
/** photo of the destination: own memory or scan first, as on the locations pages */
const { photo: placePhoto } = usePlaces()
/** the clan / tasks sheets over the map (mockups «выдвигается клан», «выдвигаются задания») */
const sheet = ref<'clan' | 'tasks' | null>(null)
const router = useRouter()
const canvas = ref<InstanceType<typeof MapCanvas> | null>(null)
const header = ref<HTMLElement | null>(null)
const headerHeight = ref(180)
const mapError = ref<string | null>(null)

// header (mockup карта.jpg): avatar, level with XP, coins and the streak
/** streak from player_stats; null until loaded or when it failed — shown as «—» */
const streak = ref<number | null>(null)

const GEO_TEXT = {
  permission_denied: 'Нет доступа к геолокации',
  disabled: 'Геолокация выключена',
  timeout: 'Не удаётся определить местоположение',
  unavailable: 'Местоположение недоступно',
} as const

let viewportTimer: ReturnType<typeof setTimeout> | undefined
let lastViewport: MapViewport | null = null
const viewport = ref<MapViewport | null>(null)
function onViewport({ bbox, zoom }: MapViewport): void {
  lastViewport = { bbox, zoom }
  viewport.value = { bbox, zoom }
  if (showExploredState.value !== 'loading') showExploredState.value = 'idle'
  clearTimeout(viewportTimer)
  viewportTimer = setTimeout(() => {
    void map.loadViewport(bbox)
    void outlines.load(bbox, zoom)
    void exploration.loadViewport(bbox, zoom)
  }, 250)
}

const EXPLORE_TEXT: Record<ExplorationStatus, string | null> = {
  off: null,
  starting: 'Исследование: запуск…',
  searching: 'Исследование: ищем GPS…',
  tracking: null,
  weak_signal: 'Слабый GPS — шаги не засчитываются',
  signal_lost: 'Нет сигнала GPS',
  permission_denied: 'Нет доступа к геолокации — разрешите в настройках',
  disabled: 'Геолокация выключена на устройстве',
}

/** Admin shortcut until the catalog page exists: publish the tapped footprint as a game building. */
const isAdmin = ref(false)
/** Fog of War is always on for players; admins may lift it to set up buildings anywhere */
const fogLifted = ref(false)
const fogOn = computed(() => !(isAdmin.value && fogLifted.value))
/** tap on the exploration chip: where the route gets lost (GPS, filter, upload, server) */
const diagnosticsOpen = ref(false)

/** Street level under fog with nothing explored in view: say why the map is grey, offer a way out. */
const fogHint = computed(() => {
  const v = viewport.value
  if (!fogOn.value || !v || v.zoom < STREET_LEVEL_ZOOM || exploration.loadingViewport) return false
  if (cardOpen.value || route.active || diagnosticsOpen.value) return false
  return !exploration.anyExploredIn(v.bbox)
})
/** the other game area to jump to: Zavidovo is ~100 km away and empty from afar (no okrugs, no basemap) */
const otherArea = computed(() => {
  const v = viewport.value
  if (!v) return null
  const here = gameAreaAt({ lng: (v.bbox.minLng + v.bbox.maxLng) / 2, lat: (v.bbox.minLat + v.bbox.maxLat) / 2 })
  return here === 'zavidovo' ? { id: 'moscow' as const, label: 'Москва' } : { id: 'zavidovo' as const, label: 'Завидово' }
})
function goToArea(id: GameAreaId): void {
  if (id === 'moscow') {
    canvas.value?.showCity()
    return
  }
  canvas.value?.flyTo(ZAVIDOVO_HOME.lng, ZAVIDOVO_HOME.lat, ZAVIDOVO_HOME.zoom)
}
const showExploredState = ref<'idle' | 'loading' | 'none' | 'error'>('idle')
async function showExplored(): Promise<void> {
  if (showExploredState.value === 'loading') return
  showExploredState.value = 'loading'
  try {
    const area = await exploration.latestExploredArea()
    if (!area) {
      showExploredState.value = 'none'
      return
    }
    canvas.value?.fitArea(area, 17)
    showExploredState.value = 'idle'
  } catch {
    showExploredState.value = 'error'
  }
}
const publishing = ref(false)
const publishError = ref<string | null>(null)

async function publishOutline(): Promise<void> {
  const outline = outlines.selected
  if (!outline || publishing.value) return
  publishing.value = true
  publishError.value = null
  try {
    const { api } = services()
    const id = await api.saveGameBuilding(outline.id, { name: (outline.name ?? outline.address ?? 'Здание').slice(0, 160) })
    await api.setGameBuildingStatus(id, 'published')
    map.invalidate()
    outlines.invalidate()
    if (lastViewport) await Promise.all([map.loadViewport(lastViewport.bbox), outlines.load(lastViewport.bbox, lastViewport.zoom)])
    outlines.select(null)
    if (map.buildings.has(id)) map.select(id)
  } catch (e) {
    const err = toApiError(e)
    publishError.value = err.code === 'forbidden' ? 'Нет прав администратора' : 'Не удалось опубликовать, попробуйте ещё раз'
  } finally {
    publishing.value = false
  }
}

/** One status line for the exploration mode (null = nothing worth showing). */
const exploreChip = computed<{ text: string; warn: boolean } | null>(() => {
  const waiting = exploration.pending ? ` (${exploration.pending})` : ''
  if (exploration.enabled && exploration.sync === 'offline') return { text: `Нет сети · путь сохранится позже${waiting}`, warn: true }
  if (exploration.enabled && exploration.sync === 'error') return { text: `Ошибка сохранения · повторим${waiting}`, warn: true }
  const text = EXPLORE_TEXT[exploration.status]
  if (text) {
    if (exploration.status === 'weak_signal' && exploration.accuracyM) {
      // the filter's limit (DEFAULT_FILTER.maxAccuracyM): show how far the fix is from counting
      return { text: `Слабый GPS: ±${Math.round(exploration.accuracyM)} м, нужно до ${DEFAULT_FILTER.maxAccuracyM} м`, warn: true }
    }
    return { text, warn: exploration.status !== 'starting' && exploration.status !== 'searching' }
  }
  if (exploration.status === 'tracking') {
    const total = exploration.totalCells === null ? '' : ` · всего ${exploration.totalCells}`
    const state = exploration.sync === 'syncing' ? ' · сохраняем…' : exploration.sync === 'saved' ? ' · сохранено' : ''
    const gain = exploration.lastGain ? ` · +${exploration.lastGain.count} новых` : ''
    // in a browser GPS stops with the screen: warn when it could not be kept on
    if (!exploration.screenKeptOn) {
      return { text: `Исследование · открыто ${exploration.sessionCells}${gain} · не выключайте экран`, warn: true }
    }
    return { text: `Исследование · открыто ${exploration.sessionCells}${total}${gain}${state}`, warn: false }
  }
  return null
})

/** Footprint of the selected game building, or the directly tapped footprint. */
const selectedOutlineId = computed(() => {
  if (outlines.selectedId !== null) return outlines.selectedId
  const id = map.selectedBuildingId
  return id ? (outlines.list.find((o) => o.game?.id === id)?.id ?? null) : null
})

/** Tapped footprint: playable game buildings open the regular card (scan flow), others the outline card. */
function selectOutline(id: number | null): void {
  outlines.select(id)
  const gameId = outlines.selected?.game?.id
  if (gameId && map.buildings.has(gameId)) {
    outlines.select(null)
    map.select(gameId)
  } else {
    map.select(null)
    if (id !== null) map.selectDistrict(null)
  }
}

function selectDistrict(id: string | null): void {
  if (id) outlines.select(null)
  map.selectDistrict(id)
  if (id) canvas.value?.fitDistrict(id)
}

const quests = useAreaQuestsStore()
/** places of the Zavidovo quest steps drawn as map points; done when every step there is done */
const questPoints = computed(() => {
  const points = new Map<string, MapBuilding>()
  for (const r of quests.routes) {
    for (const s of r.steps) {
      if (!hasPoint(s.place)) continue
      const id = `place:${s.place.id}`
      const known = points.get(id)
      const doneAt = s.doneAt && (!known || known.discoveredAt) ? s.doneAt : null
      points.set(id, { ...placeTarget(s.place), rarity: 'epic', discoveredAt: doneAt })
    }
  }
  return [...points.values()]
})
/** a category chip shows only the places of that category (Zavidovo, migration 027) instead of everything else */
const categoryPoints = computed(() => {
  const tag = mapCategory.value
  if (!tag) return []
  return (quests.data?.places ?? [])
    .filter((p) => p.tags.includes(tag))
    .filter(hasPoint)
    .map((p) => ({ ...placeTarget(p), rarity: 'epic' as const }))
})
const canvasBuildings = computed(() => {
  if (mapCategory.value) return categoryPoints.value
  return questPoints.value.length ? [...map.buildingList, ...questPoints.value] : map.buildingList
})
// the places are all in Zavidovo: a chip picked elsewhere takes the map there
watch(mapCategory, (tag) => {
  if (!tag) return
  void quests.load()
  map.select(null)
  outlines.select(null)
  const v = viewport.value
  const here = v && gameAreaAt({ lng: (v.bbox.minLng + v.bbox.maxLng) / 2, lat: (v.bbox.minLat + v.bbox.maxLat) / 2 })
  if (here !== 'zavidovo') canvas.value?.flyTo(ZAVIDOVO_HOME.lng, ZAVIDOVO_HOME.lat, ZAVIDOVO_HOME.zoom)
})

function selectBuilding(id: string): void {
  if (id.startsWith('place:')) {
    const placeId = id.slice('place:'.length)
    // a category point opens the place, a quest point its route
    if (mapCategory.value) {
      void router.push({ name: 'place', params: { id: placeId } })
      return
    }
    const r = quests.routes.find((x) => x.steps.some((s) => s.place?.id === placeId && !s.doneAt)) ??
      quests.routes.find((x) => x.steps.some((s) => s.place?.id === placeId))
    void router.push(r ? { name: 'route', params: { slug: r.slug } } : '/routes')
    return
  }
  outlines.select(null)
  map.select(id)
  const b = map.buildings.get(id)
  if (b) canvas.value?.flyTo(b.lng, b.lat, 16)
}

function openScanner(): void {
  if (map.selectedBuildingId) void router.push({ name: 'scan', params: { buildingId: map.selectedBuildingId } })
}

/** the first line to each new destination is fitted into view; rebuilds on the way are not */
const mapReady = ref(false)
let fittedGeneration = 0
function fitRoute(): void {
  const next = route.route
  if (!mapReady.value || !next || fittedGeneration === route.generation) return
  fittedGeneration = route.generation
  const lngs = next.path.map(([lng]) => lng)
  const lats = next.path.map(([, lat]) => lat)
  canvas.value?.fitArea([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], 17)
}
watch(() => route.route, fitRoute)
function onMapReady(): void {
  mapReady.value = true
  fitRoute()
}

function retry(): void {
  map.invalidate()
  outlines.invalidate()
  mapError.value = null
  void map.loadDistricts()
}

let resize: ResizeObserver | null = null
onMounted(() => {
  // the quest points of Zavidovo; a failure only leaves them off the map
  void quests.load()
  services()
    .api.isAdmin()
    .then((v) => (isAdmin.value = v))
    .catch(() => (isAdmin.value = false))
  void map.startTracking()
  // the Fog of War opens by itself: exploring starts as soon as location access is granted
  void exploration.autoStart()
  void map.loadDistricts()
  // crest on the clan button and the badge on the tasks button
  void clan.load()
  void tasks.load()
  if (!profile.profile) void profile.load()
  services()
    .api.getPlayerStats()
    .then((s) => (streak.value = s.streakDays))
    .catch(() => (streak.value = null))
  void memories.load()
  if (header.value) {
    resize = new ResizeObserver(([entry]) => {
      if (entry) headerHeight.value = entry.target.getBoundingClientRect().height
    })
    resize.observe(header.value)
  }
})
// first launch: the map asks for location; the first fix means access was granted
watch(
  () => map.position !== null,
  (hasFix) => {
    if (hasFix) void exploration.autoStart()
  },
)
onBeforeUnmount(() => {
  clearTimeout(viewportTimer)
  resize?.disconnect()
  map.stopTracking()
})
</script>

<template>
  <main class="map-view">
    <MapCanvas
      ref="canvas"
      :buildings="canvasBuildings"
      :districts="map.districts"
      :outlines="outlines.list"
      :buildings-with-outline="outlines.gameIdsWithOutline"
      :position="map.position"
      :selected-building-id="map.selectedBuildingId"
      :selected-district-id="map.selectedDistrictId"
      :selected-outline-id="selectedOutlineId"
      :explored-cells="exploration.cellList"
      :recent-cells="exploration.recentList"
      :fog="fogOn"
      :route="route.route?.path ?? null"
      :padding="{ top: headerHeight, bottom: 110 }"
      @viewport="onViewport"
      @select-building="selectBuilding"
      @select-district="selectDistrict"
      @select-outline="selectOutline"
      @error="mapError = $event"
      @ready="onMapReady"
    />

    <header ref="header" class="top">
      <div class="top__row">
        <RouterLink to="/profile" class="me" aria-label="Профиль">
          <PlayerAvatar
            class="me__avatar"
            :url="profile.profile?.avatarUrl ?? null"
            :figure="profile.profile?.avatarKey ?? null"
            :name="profile.profile?.username ?? '?'"
            :size="48"
            :letters="2"
          />
          <LevelProgress class="me__level" :level="profile.profile?.level ?? null" :xp="profile.profile?.xp ?? 0" stacked />
        </RouterLink>
        <WalletStreak class="wallet" :coins="profile.profile?.coins ?? 0" :streak="streak" />
      </div>

      <CategoryChips v-model="mapCategory" class="top__cats" :items="PLACE_CHIPS" />

      <div class="chips" aria-live="polite">
        <span v-if="map.geoError" class="chip chip--warn">{{ GEO_TEXT[map.geoError.code] }}</span>
      </div>
    </header>

    <Transition name="fade">
      <FigureLoader
        v-if="map.loading || outlines.loading"
        class="map-loader"
        tiles
        :size="22"
        label="Загрузка зданий"
        :style="{ top: `${headerHeight + 12}px` }"
      />
    </Transition>

    <template v-if="!cardOpen">
      <button class="sheet-btn sheet-btn--clan" :class="{ 'sheet-btn--raised': routeCard }" aria-label="Клан" @click="sheet = 'clan'">
        <ClanAvatar v-if="clan.membership" :url="clan.membership.clan.avatarUrl" :tag="clan.membership.clan.tag" :size="44" />
        <AppIcon v-else name="shield" :size="26" />
      </button>
      <button class="sheet-btn sheet-btn--tasks" :class="{ 'sheet-btn--raised': routeCard }" :aria-label="tasks.ready ? `Задания: наград к получению — ${tasks.ready}` : 'Задания'" @click="sheet = 'tasks'">
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M9 2.5h6a1.5 1.5 0 0 1 1.5 1.5H18a2 2 0 0 1 2 2v13.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1.5A1.5 1.5 0 0 1 9 2.5Zm-1 9.5a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H8Zm0 4a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2H8Z"
          />
        </svg>
        <span v-if="tasks.ready" class="sheet-btn__badge" aria-hidden="true">{{ tasks.ready }}</span>
      </button>
    </template>

    <div class="bottom">
      <div
        class="chips chips--bottom"
        :class="{ 'chips--beside-buttons': !cardOpen }"
        aria-live="polite"
      >
        <div v-if="fogHint" class="chip chip--hint" role="status">
          <span>{{
            showExploredState === 'none'
              ? 'Вы ещё ничего не открыли — пройдитесь, туман рассеется по пути'
              : showExploredState === 'error'
                ? 'Не удалось найти открытые места'
                : 'Здесь туман — пройдитесь, чтобы открыть улицы'
          }}</span>
          <button v-if="showExploredState !== 'none'" type="button" :disabled="showExploredState === 'loading'" @click="showExplored">
            {{ showExploredState === 'loading' ? 'Ищем…' : showExploredState === 'error' ? 'Повторить' : 'Показать открытое' }}
          </button>
        </div>
        <button v-if="map.error || outlines.error" class="chip chip--error" @click="retry">
          {{ (map.error ?? outlines.error)?.code === 'offline' ? 'Нет сети' : 'Ошибка загрузки' }} · повторить
        </button>
        <span v-else-if="outlines.truncated" class="chip chip--warn">Показаны не все здания — приблизьте карту</span>
        <span v-if="mapError" class="chip chip--warn">Карта загружается с ошибками</span>
        <button
          v-if="exploreChip"
          type="button"
          class="chip"
          :class="{ 'chip--warn': exploreChip.warn }"
          :aria-expanded="diagnosticsOpen"
          @click="diagnosticsOpen = !diagnosticsOpen"
        >
          {{ exploreChip.text }}
        </button>
        <button
          v-if="otherArea && !cardOpen"
          type="button"
          class="chip"
          @click="goToArea(otherArea.id)"
        >
          {{ otherArea.label }} ›
        </button>
        <button v-if="isAdmin" class="chip" :aria-pressed="fogOn" @click="fogLifted = !fogLifted">
          Туман: {{ fogOn ? 'вкл' : 'выкл' }} (админ)
        </button>
      </div>
      <ExplorationDiagnostics v-if="diagnosticsOpen && exploration.enabled" @close="diagnosticsOpen = false" />
      <BuildingCard
        v-else-if="map.selectedBuilding"
        :building="map.selectedBuilding"
        :position="map.position"
        @close="map.select(null)"
        @scan="openScanner"
        @memory="memoryFor = map.selectedBuilding"
      />
      <OutlineCard
        v-else-if="outlines.selected"
        :outline="outlines.selected"
        :can-publish="isAdmin"
        :publishing="publishing"
        :publish-error="publishError"
        @close="outlines.select(null)"
        @publish="publishOutline"
      />
      <DistrictCard v-else-if="map.selectedDistrict" :district="map.selectedDistrict" @close="selectDistrict(null)" />
      <RouteCard
        v-else-if="route.target"
        :place="route.target"
        :photo="placePhoto(route.target)"
        :route="route.route"
        :state="route.state"
        :error-code="route.errorCode"
        :no-location="!map.position && !!map.geoError"
        @open="router.push(route.returnTo ?? `/locations/${route.target.id}`)"
        @retry="route.retry()"
      />
    </div>

    <Transition name="sheet">
      <ClanSheet v-if="sheet === 'clan'" @close="sheet = null" />
    </Transition>
    <Transition name="sheet">
      <TasksSheet v-if="sheet === 'tasks'" @close="sheet = null" />
    </Transition>

    <MemoryEditor
      v-if="memoryFor"
      :building-id="memoryFor.id"
      :place="{ buildingName: memoryFor.name, address: memoryFor.address, rarity: memoryFor.rarity }"
      @close="memoryFor = null"
    />

    <PermissionSheet
      v-if="map.locationPrompt"
      kind="location"
      @allow="map.startTracking('confirmed')"
      @later="map.dismissLocationPrompt()"
    />
  </main>
</template>

<style scoped lang="scss">
.map-view {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: var(--c-map-bg);
}

.top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  padding: calc(var(--safe-top) + 16px) 16px 24px;
  // sky over the map, as in the mockup; the map shows through below
  background: linear-gradient(180deg, rgb(140 200 255 / 85%) 0%, rgb(190 225 255 / 55%) 55%, rgb(255 255 255 / 0%) 100%);
  // the gradient's lower part must not block the map
  pointer-events: none;
  > * {
    pointer-events: auto;
  }
}
.top__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.top__cats {
  margin-top: 16px;
}
.me {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  text-decoration: none;
}
.me__avatar {
  border: 2px solid #fff;
  background: #fff;
  color: #000;
}
.me__level {
  flex: 1;
  max-width: 130px;
}
.wallet {
  flex: none;
  background: #fff;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  &:not(:empty) {
    margin-top: 10px;
  }
  &--bottom:not(:empty) {
    margin: 0 0 8px;
  }
  &--bottom .chip {
    box-shadow: var(--shadow-card);
  }
  // keep clear of the clan (left) and tasks (right) buttons on the same row
  &--beside-buttons {
    padding: 0 60px;
  }
  // the row spans the whole width: only the chips themselves take taps, the gaps let them through
  &--bottom {
    pointer-events: none;
    > * {
      pointer-events: auto;
    }
  }
}
.chip {
  border: 0;
  padding: 6px 12px;
  border-radius: var(--r-pill);
  background: var(--c-surface-2);
  font-size: 13px;
  &--error {
    background: var(--c-danger-soft);
    color: var(--c-danger);
  }
  &--warn {
    background: var(--c-warning-soft);
    color: #7a4d00;
  }
  &--hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    background: var(--c-surface);
    box-shadow: var(--shadow-card);
    border-radius: 16px;
    button {
      border: 0;
      padding: 6px 12px;
      border-radius: var(--r-pill);
      background: var(--c-accent);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
    }
  }
}

.map-loader {
  position: absolute;
  left: 50%;
  z-index: 9;
  transform: translateX(-50%);
  pointer-events: none;
  :deep(.loader__tile) {
    font-size: 18px;
    box-shadow: var(--shadow-card);
  }
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

// clan (left) and tasks (right) buttons, as in the mockup (карта.png)
.sheet-btn {
  position: absolute;
  z-index: 5;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 3px solid #e3eefd;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-card);
  color: #1c1c1e;
}
.sheet-btn--clan {
  left: 16px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 38px);
  overflow: hidden;
}
.sheet-btn--tasks {
  right: 16px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 38px);
}
.sheet-btn--raised {
  // the route card: 105 high, 16 above the tab bar, the buttons 10 above it (mockup)
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 16px + 105px + 10px);
}
.sheet-btn__badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: 2px solid #fff;
  border-radius: 10px;
  background: #ff3b30;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
}

.bottom {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 16px);
  z-index: 6;
  // it lies over the clan and tasks buttons: its empty area must not swallow their taps
  pointer-events: none;
  // cards take taps; the chips row decides for itself (only its chips do)
  > :not(.chips) {
    pointer-events: auto;
  }
}
</style>
