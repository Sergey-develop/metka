<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { services } from '@/app/providers/services'
import type { Cell } from '@/services/exploration/grid'
import type { GeoFix } from '@/services/geolocation/types'
import type { MapScene, MapService, MapTarget, MapViewport } from '@/services/map/types'
import type { BuildingOutline, DistrictOverview, MapBuilding } from '@/types/game'
import { bounds, MOSCOW_BOUNDS } from '@/utils/mapGeometry'

const props = defineProps<{
  buildings: MapBuilding[]
  districts: DistrictOverview[]
  outlines: BuildingOutline[]
  /** game buildings already drawn as footprints: their fallback points are hidden */
  buildingsWithOutline: ReadonlySet<string>
  position: GeoFix | null
  selectedBuildingId: string | null
  selectedDistrictId: string | null
  selectedOutlineId: number | null
  exploredCells: readonly Cell[]
  recentCells: readonly Cell[]
  /** Fog of War over unexplored land */
  fog: boolean
  /** px covered by overlays (header, tab bar) so fitting keeps content visible */
  padding: { top: number; bottom: number }
}>()

const emit = defineEmits<{
  viewport: [viewport: MapViewport]
  selectBuilding: [id: string]
  selectDistrict: [id: string | null]
  selectOutline: [id: number | null]
  error: [message: string]
}>()

const container = ref<HTMLDivElement | null>(null)
const failed = ref(false)
const failReason = ref('')
let map: MapService | null = null
const origin = typeof location === 'undefined' ? '' : location.host

const margin = (): [number, number, number, number] => [props.padding.top + 8, 8, props.padding.bottom + 8, 8]

function scene(): MapScene {
  return {
    districts: props.districts,
    selectedDistrictId: props.selectedDistrictId,
    buildings: props.buildings,
    selectedBuildingId: props.selectedBuildingId,
    buildingsWithOutline: props.buildingsWithOutline,
    outlines: props.outlines,
    selectedOutlineId: props.selectedOutlineId,
    position: props.position,
    exploredCells: props.exploredCells,
    recentCells: props.recentCells,
    fog: props.fog,
  }
}

function onSelect(target: MapTarget): void {
  if (!target) {
    emit('selectOutline', null)
    emit('selectDistrict', null)
  } else if (target.kind === 'outline') emit('selectOutline', target.id)
  else if (target.kind === 'building') emit('selectBuilding', target.id)
  else emit('selectDistrict', target.id !== props.selectedDistrictId ? target.id : null)
}

function showCity(animate = true): void {
  map?.fitBounds(MOSCOW_BOUNDS, 19, animate)
}

async function mount(): Promise<void> {
  if (!container.value) return
  failed.value = false
  map?.destroy()
  const instance = services().createMap()
  map = instance
  instance.onViewport((v) => emit('viewport', v))
  instance.onSelect(onSelect)
  try {
    await instance.mount(container.value, { center: [37.615, 55.74], zoom: 10, margin: margin() })
    if (map !== instance) return
    instance.render(scene())
    showCity(false)
  } catch (e) {
    if (map !== instance) return
    failed.value = true
    const message = e instanceof Error ? e.message : String(e)
    failReason.value = message
    console.error('[map] mount failed:', e)
    emit('error', message)
  }
}

onMounted(() => void mount())

onBeforeUnmount(() => {
  map?.destroy()
  map = null
})

watch(
  () =>
    [
      props.buildings,
      props.districts,
      props.outlines,
      props.buildingsWithOutline,
      props.position,
      props.selectedBuildingId,
      props.selectedDistrictId,
      props.selectedOutlineId,
      props.exploredCells,
      props.recentCells,
      props.fog,
    ] as const,
  () => map?.render(scene()),
)
watch(
  () => [props.padding.top, props.padding.bottom] as const,
  () => map?.setMargin(margin()),
)

function flyTo(lng: number, lat: number, zoom = 16): void {
  map?.flyTo([lng, lat], zoom)
}

function fitDistrict(districtId: string): void {
  const district = props.districts.find((d) => d.id === districtId)
  if (district) map?.fitBounds(bounds(district.boundary), 13.5)
}

/** fit a [[minLng, minLat], [maxLng, maxLat]] box, not closer than maxZoom */
function fitArea(box: [[number, number], [number, number]], maxZoom = 17): void {
  map?.fitBounds(box, maxZoom)
}

defineExpose({ flyTo, fitDistrict, showCity, fitArea })
</script>

<template>
  <div class="map-canvas">
    <div ref="container" class="map-canvas__map" role="application" aria-label="Карта города" />
    <!-- ODbL: footprints come from OpenStreetMap — required by the data licence, kept when Yandex's are hidden -->
    <a
      v-if="outlines.length > 0"
      class="map-canvas__osm"
      href="https://www.openstreetmap.org/copyright"
      target="_blank"
      rel="noopener"
      >Контуры зданий © OpenStreetMap</a
    >
    <div v-if="failed" class="map-canvas__failed" role="alert">
      <p>Карта не загрузилась</p>
      <p v-if="failReason === 'script_failed'" class="map-canvas__hint">
        Яндекс отклонил ключ или нет сети. Ключ разрешён для адреса {{ origin }}?
      </p>
      <p v-else-if="failReason" class="map-canvas__hint">{{ failReason }}</p>
      <button class="map-canvas__retry" @click="mount">Повторить</button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.map-canvas {
  position: absolute;
  inset: 0;
  background: var(--c-map-bg);
}

/* ends above the tab bar */
.map-canvas__map {
  position: absolute;
  inset: 0 0 calc(var(--nav-height) + var(--safe-bottom));
}

/*
 * Yandex logo, copyrights and the terms link hidden at the owner's request (2026-10-26), against the
 * JS API terms of use — Yandex may revoke the key (PROJECT_STATUS.md, blockers).
 */
.map-canvas__map :deep([class^='ymaps3'][class*='copyrights']) {
  display: none !important;
}

.map-canvas__osm {
  position: absolute;
  right: 8px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 8px);
  padding: 2px 6px;
  border-radius: 4px;
  background: rgb(255 255 255 / 80%);
  color: var(--c-text-2);
  font-size: 10px;
  text-decoration: none;
}

.map-canvas__failed {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 12px;
  text-align: center;
  color: var(--c-text-2);
}

.map-canvas__hint {
  max-width: 280px;
  font-size: 13px;
}

.map-canvas__retry {
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--c-surface);
  color: var(--c-accent);
  font-weight: 600;
}

/* DOM markers created by services/map/yandexMap.ts; anchored at their centre / bottom */
:deep(.metka-point) {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: #b9bcc8;
  border: 2.5px solid #fff;
  box-shadow: 0 1px 4px rgb(23 61 102 / 25%);
  cursor: pointer;
  transition: transform 0.15s var(--ease);
}
:deep(.metka-point--rare) {
  background: #6e9cf2;
}
:deep(.metka-point--epic) {
  background: #9b8cf5;
}
:deep(.metka-point--legendary) {
  background: #ff94de;
}
:deep(.metka-point--found) {
  background: var(--c-accent);
}
:deep(.metka-point--selected) {
  transform: translate(-50%, -50%) scale(1.45);
  border-width: 3px;
}
:deep(.metka-zoom-far .metka-point) {
  display: none;
}

:deep(.metka-district-label) {
  transform: translate(-50%, -50%);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #5a7ee8;
  white-space: nowrap;
  text-shadow:
    0 0 3px #fff,
    0 0 3px #fff;
  cursor: pointer;
}
:deep(.metka-zoom-near .metka-district-label) {
  display: none;
}

:deep(.metka-me) {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--c-accent);
  border: 3px solid #fff;
  box-shadow: 0 1px 6px rgb(23 61 102 / 30%);
  pointer-events: none;
}

:deep(.metka-percent-pin) {
  position: relative;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  transform: translate(-50%, calc(-100% - 9px));
  background: var(--c-surface);
  display: grid;
  place-items: center;
  box-shadow: 0 6px 18px rgb(23 61 102 / 14%);
  pointer-events: none;

  &::after {
    content: '';
    position: absolute;
    bottom: -9px;
    left: 50%;
    width: 18px;
    height: 18px;
    background: var(--c-surface);
    transform: translateX(-50%) rotate(45deg);
    border-radius: 3px;
  }
}
:deep(.metka-percent-pin__value) {
  position: relative;
  z-index: 1;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--c-accent-soft);
  display: grid;
  place-items: center;
  color: var(--c-accent);
  font-weight: 800;
  font-size: 18px;
}
</style>
