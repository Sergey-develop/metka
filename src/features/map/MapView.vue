<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import AppIcon from '@/components/ui/AppIcon.vue'
import FigureAvatar from '@/components/ui/FigureAvatar.vue'
import FigureLoader from '@/components/ui/FigureLoader.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import PermissionSheet from '@/components/ui/PermissionSheet.vue'
import { useExplorationStore } from '@/stores/exploration'
import { useMemoriesStore } from '@/stores/memories'
import { useMapStore } from '@/stores/map'
import { useOutlinesStore } from '@/stores/outlines'
import { useProfileStore } from '@/stores/profile'
import { useQuestsStore } from '@/stores/quests'
import type { ExplorationStatus } from '@/services/exploration/explorationTracker'
import { DEFAULT_FILTER } from '@/services/exploration/trackFilter'
import { toApiError } from '@/services/api/errors'
import type { MapViewport } from '@/services/map/types'
import type { MapBuilding } from '@/types/game'
import BuildingCard from './BuildingCard.vue'
import DistrictCard from './DistrictCard.vue'
import MapCanvas from './MapCanvas.vue'
import OutlineCard from './OutlineCard.vue'
import MemoryEditor from '@/features/album/MemoryEditor.vue'

const map = useMapStore()
const outlines = useOutlinesStore()
const exploration = useExplorationStore()
const memories = useMemoriesStore()
/** unlocked building whose memory is being edited */
const memoryFor = ref<MapBuilding | null>(null)
const profile = useProfileStore()
const quests = useQuestsStore()
const router = useRouter()
const canvas = ref<InstanceType<typeof MapCanvas> | null>(null)
const header = ref<HTMLElement | null>(null)
const headerHeight = ref(180)
const mapError = ref<string | null>(null)
const query = ref('')
const searchFocused = ref(false)

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 5) return 'Доброй ночи!'
  if (h < 12) return 'Доброе утро!'
  if (h < 18) return 'Добрый день!'
  return 'Добрый вечер!'
})
const initials = computed(() => (profile.profile?.username ?? '?').slice(0, 2).toUpperCase())
const hasReward = computed(() => quests.quests.some((q) => q.completedAt && !q.claimedAt))

type SearchHit = { kind: 'district' | 'building'; id: string; title: string; subtitle: string }
const hits = computed<SearchHit[]>(() => {
  const q = query.value.trim().toLocaleLowerCase('ru')
  if (q.length < 2) return []
  const districts = map.districts
    .filter((d) => d.name.toLocaleLowerCase('ru').includes(q) || d.shortName.toLocaleLowerCase('ru').includes(q))
    .map((d) => ({ kind: 'district' as const, id: d.id, title: d.shortName, subtitle: d.name }))
  const buildings = map.buildingList
    .filter((b) => b.name.toLocaleLowerCase('ru').includes(q))
    .map((b) => ({ kind: 'building' as const, id: b.id, title: b.name, subtitle: b.discoveredAt ? 'Открыто' : 'Здание' }))
  return [...districts, ...buildings].slice(0, 6)
})

const GEO_TEXT = {
  permission_denied: 'Нет доступа к геолокации',
  disabled: 'Геолокация выключена',
  timeout: 'Не удаётся определить местоположение',
  unavailable: 'Местоположение недоступно',
} as const

let viewportTimer: ReturnType<typeof setTimeout> | undefined
let lastViewport: MapViewport | null = null
function onViewport({ bbox, zoom }: MapViewport): void {
  lastViewport = { bbox, zoom }
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
  if (exploration.enabled && exploration.paused) {
    const saving = exploration.sync === 'syncing' ? ' · сохраняем…' : exploration.pending ? ` · не отправлено ${exploration.pending}` : ''
    return { text: `Исследование на паузе — GPS выключен${saving}`, warn: false }
  }
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

function selectBuilding(id: string): void {
  outlines.select(null)
  map.select(id)
  const b = map.buildings.get(id)
  if (b) canvas.value?.flyTo(b.lng, b.lat, 16)
}

function pick(hit: SearchHit): void {
  query.value = ''
  searchFocused.value = false
  if (hit.kind === 'district') selectDistrict(hit.id)
  else selectBuilding(hit.id)
}

function locate(): void {
  if (map.position) canvas.value?.flyTo(map.position.lng, map.position.lat)
  else void map.startTracking('user')
}

function openScanner(): void {
  if (map.selectedBuildingId) void router.push({ name: 'scan', params: { buildingId: map.selectedBuildingId } })
}

function retry(): void {
  map.invalidate()
  outlines.invalidate()
  mapError.value = null
  void map.loadDistricts()
}

let resize: ResizeObserver | null = null
onMounted(() => {
  services()
    .api.isAdmin()
    .then((v) => (isAdmin.value = v))
    .catch(() => (isAdmin.value = false))
  void map.startTracking()
  void map.loadDistricts()
  void quests.load()
  void memories.load()
  if (header.value) {
    resize = new ResizeObserver(([entry]) => {
      if (entry) headerHeight.value = entry.target.getBoundingClientRect().height
    })
    resize.observe(header.value)
  }
})
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
      :buildings="map.buildingList"
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
      :padding="{ top: headerHeight, bottom: 110 }"
      @viewport="onViewport"
      @select-building="selectBuilding"
      @select-district="selectDistrict"
      @select-outline="selectOutline"
      @error="mapError = $event"
    />

    <header ref="header" class="top">
      <div class="top__row">
        <h1 class="top__title">{{ greeting }}</h1>
        <div class="top__actions">
          <RouterLink to="/profile" class="round round--gray" :aria-label="hasReward ? 'Есть награда за задание' : 'Задания'">
            <FilledIcon name="bell" :size="22" />
            <span v-if="hasReward" class="round__dot" />
          </RouterLink>
          <RouterLink to="/profile" class="round round--avatar" aria-label="Профиль">
            <img v-if="profile.profile?.avatarUrl" :src="profile.profile.avatarUrl" alt="" />
            <FigureAvatar v-else-if="profile.profile?.avatarKey" :figure="profile.profile.avatarKey" :size="46" />
            <span v-else>{{ initials }}</span>
          </RouterLink>
        </div>
      </div>

      <div class="search" :class="{ 'search--open': searchFocused && hits.length > 0 }">
        <FilledIcon name="search" :size="20" class="search__icon" />
        <label for="map-search" class="visually-hidden">Поиск района или здания</label>
        <input
          id="map-search"
          v-model="query"
          type="search"
          placeholder="Поиск"
          autocomplete="off"
          enterkeyhint="search"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
          @keydown.enter="hits[0] && pick(hits[0])"
        />
        <ul v-if="searchFocused && hits.length > 0" class="search__results" role="listbox">
          <li v-for="hit in hits" :key="hit.kind + hit.id" role="option" @mousedown.prevent="pick(hit)">
            <strong>{{ hit.title }}</strong>
            <span>{{ hit.subtitle }}</span>
          </li>
        </ul>
      </div>

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

    <button
      v-if="!map.selectedBuilding && !map.selectedDistrict && !outlines.selected"
      class="explore"
      :class="{ 'explore--on': exploration.enabled }"
      :aria-pressed="exploration.enabled"
      title="Открывает пройденные улицы. Работает, только пока приложение открыто."
      @click="exploration.toggle()"
    >
      <span class="explore__dot" aria-hidden="true" />
      Исследование
    </button>
    <button
      v-if="exploration.enabled && !map.selectedBuilding && !map.selectedDistrict && !outlines.selected"
      class="explore-pause"
      :aria-pressed="exploration.paused"
      :aria-label="exploration.paused ? 'Продолжить исследование' : 'Пауза исследования'"
      @click="exploration.paused ? exploration.resumeByPlayer() : exploration.pauseByPlayer()"
    >
      {{ exploration.paused ? '▶' : '❚❚' }}
    </button>

    <RouterLink
      v-if="!map.selectedBuilding && !map.selectedDistrict && !outlines.selected"
      to="/scan"
      class="ar-scan"
      aria-label="Сканировать здание камерой"
    >
      <AppIcon name="camera" />
    </RouterLink>

    <button
      v-if="!map.selectedBuilding && !map.selectedDistrict && !outlines.selected"
      class="locate"
      aria-label="Моё местоположение"
      @click="locate"
    >
      <AppIcon name="locate" />
    </button>

    <div class="bottom">
      <div
        class="chips chips--bottom"
        :class="{ 'chips--beside-locate': !map.selectedBuilding && !map.selectedDistrict && !outlines.selected }"
        aria-live="polite"
      >
        <button v-if="map.error || outlines.error" class="chip chip--error" @click="retry">
          {{ (map.error ?? outlines.error)?.code === 'offline' ? 'Нет сети' : 'Ошибка загрузки' }} · повторить
        </button>
        <span v-else-if="outlines.truncated" class="chip chip--warn">Показаны не все здания — приблизьте карту</span>
        <span v-if="mapError" class="chip chip--warn">Карта загружается с ошибками</span>
        <span v-if="exploreChip" class="chip" :class="{ 'chip--warn': exploreChip.warn }">{{ exploreChip.text }}</span>
        <button v-if="isAdmin" class="chip" :aria-pressed="fogOn" @click="fogLifted = !fogLifted">
          Туман: {{ fogOn ? 'вкл' : 'выкл' }} (админ)
        </button>
      </div>
      <BuildingCard
        v-if="map.selectedBuilding"
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
    </div>

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
  padding: calc(var(--safe-top) + 18px) 16px 18px;
  background: var(--c-surface);
  border-radius: 0 0 36px 36px;
}
.top__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.top__title {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.top__actions {
  display: flex;
  gap: 10px;
}
.round {
  position: relative;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  text-decoration: none;
  overflow: hidden;
  &--gray {
    background: #e6e6e7;
    color: var(--c-text);
    overflow: visible;
  }
  &--avatar {
    background: var(--c-text);
    color: #fff;
    font-weight: 700;
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
}
.round__dot {
  position: absolute;
  top: 9px;
  right: 10px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--c-brand-pink);
  box-shadow: 0 0 0 2px #e6e6e7;
}

.search {
  position: relative;
  input {
    width: 100%;
    height: 46px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--c-field);
    padding: 0 16px 0 46px;
    font-size: 17px;
    outline: none;
    &::placeholder {
      color: #8e8e93;
    }
  }
}
.search__icon {
  position: absolute;
  left: 16px;
  top: 13px;
  color: #8e8e93;
  pointer-events: none;
}
.search__results {
  position: absolute;
  top: 52px;
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
  background: var(--c-surface);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-card);
  li {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border-radius: 14px;
    cursor: pointer;
    &:hover {
      background: var(--c-surface-2);
    }
    span {
      font-size: 13px;
      color: var(--c-text-2);
    }
  }
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
  // keep clear of the locate button, which sits at the same right edge
  &--beside-locate {
    padding-right: 60px;
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

.locate {
  position: absolute;
  right: 16px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 40px);
  z-index: 5;
  width: 48px;
  height: 48px;
  border: 0;
  border-radius: 50%;
  background: var(--c-surface);
  box-shadow: var(--shadow-card);
  display: grid;
  place-items: center;
  color: var(--c-accent);
}

.ar-scan {
  position: absolute;
  right: 16px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 156px);
  z-index: 5;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--c-accent);
  box-shadow: var(--shadow-card);
  display: grid;
  place-items: center;
  color: #fff;
}
.explore-pause {
  position: absolute;
  right: 16px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 212px);
  z-index: 5;
  width: 48px;
  height: 48px;
  border: 0;
  border-radius: 50%;
  background: var(--c-surface);
  box-shadow: var(--shadow-card);
  color: var(--c-accent);
  font-size: 15px;
  font-weight: 700;
  &[aria-pressed='true'] {
    background: var(--c-accent);
    color: #fff;
  }
}
.explore {
  position: absolute;
  right: 16px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 100px);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 0;
  border-radius: var(--r-pill);
  background: var(--c-surface);
  box-shadow: var(--shadow-card);
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-2);
  &--on {
    background: var(--c-accent);
    color: #fff;
  }
}
.explore__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
  .explore--on & {
    opacity: 1;
    animation: pulse 1.6s ease-in-out infinite;
  }
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

.bottom {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 16px);
  z-index: 6;
}
</style>
