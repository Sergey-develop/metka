<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import AppIcon from '@/components/ui/AppIcon.vue'
import FigureAvatar from '@/components/ui/FigureAvatar.vue'
import FigureLoader from '@/components/ui/FigureLoader.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import PermissionSheet from '@/components/ui/PermissionSheet.vue'
import { useMapStore } from '@/stores/map'
import { useProfileStore } from '@/stores/profile'
import { useQuestsStore } from '@/stores/quests'
import type { Bbox } from '@/types/game'
import BuildingCard from './BuildingCard.vue'
import DistrictCard from './DistrictCard.vue'
import MapCanvas from './MapCanvas.vue'

const map = useMapStore()
const profile = useProfileStore()
const quests = useQuestsStore()
const router = useRouter()
const canvas = ref<InstanceType<typeof MapCanvas> | null>(null)
const header = ref<HTMLElement | null>(null)
const headerHeight = ref(180)
const mapError = ref<string | null>(null)
const query = ref('')
const searchFocused = ref(false)
const tilesUrl = services().config.mapTilesUrl

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
function onViewport(bbox: Bbox): void {
  clearTimeout(viewportTimer)
  viewportTimer = setTimeout(() => void map.loadViewport(bbox), 250)
}

function selectDistrict(id: string | null): void {
  map.selectDistrict(id)
  if (id) canvas.value?.fitDistrict(id)
}

function selectBuilding(id: string): void {
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
  mapError.value = null
  void map.loadDistricts()
}

let resize: ResizeObserver | null = null
onMounted(() => {
  void map.startTracking()
  void map.loadDistricts()
  void quests.load()
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
      :tiles-url="tilesUrl"
      :buildings="map.buildingList"
      :districts="map.districts"
      :position="map.position"
      :selected-building-id="map.selectedBuildingId"
      :selected-district-id="map.selectedDistrictId"
      :padding="{ top: headerHeight, bottom: 110 }"
      @viewport="onViewport"
      @select-building="selectBuilding"
      @select-district="selectDistrict"
      @error="mapError = $event"
    />

    <header ref="header" class="top">
      <div class="top__row">
        <h1 class="top__title">{{ greeting }}</h1>
        <div class="top__actions">
          <RouterLink to="/quests" class="round round--gray" :aria-label="hasReward ? 'Есть награда за задание' : 'Задания'">
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
        v-if="map.loading"
        class="map-loader"
        tiles
        :size="22"
        label="Загрузка зданий"
        :style="{ top: `${headerHeight + 12}px` }"
      />
    </Transition>

    <button
      v-if="!map.selectedBuilding && !map.selectedDistrict"
      class="locate"
      aria-label="Моё местоположение"
      @click="locate"
    >
      <AppIcon name="locate" />
    </button>

    <div class="bottom">
      <div
        class="chips chips--bottom"
        :class="{ 'chips--beside-locate': !map.selectedBuilding && !map.selectedDistrict }"
        aria-live="polite"
      >
        <button v-if="map.error" class="chip chip--error" @click="retry">
          {{ map.error.code === 'offline' ? 'Нет сети' : 'Ошибка загрузки' }} · повторить
        </button>
        <span v-if="mapError" class="chip chip--warn">Карта загружается с ошибками</span>
      </div>
      <BuildingCard
        v-if="map.selectedBuilding"
        :building="map.selectedBuilding"
        :position="map.position"
        @close="map.select(null)"
        @scan="openScanner"
      />
      <DistrictCard v-else-if="map.selectedDistrict" :district="map.selectedDistrict" @close="selectDistrict(null)" />
    </div>

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

.bottom {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 16px);
  z-index: 6;
}
</style>
