<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import AppButton from '@/components/ui/AppButton.vue'
import FigureLoader from '@/components/ui/FigureLoader.vue'
import MemoryEditor from '@/features/album/MemoryEditor.vue'
import { MATCH } from '@/services/scan/candidates'
import { useArScanStore, type ArScanFailure } from '@/stores/arScan'
import { useBuildingInfoStore } from '@/stores/buildingInfo'
import type { BuildingOutline } from '@/types/game'
import BuildingInfoSheet from './BuildingInfoSheet.vue'

const scan = useArScanStore()
const info = useBuildingInfoStore()
const router = useRouter()

const video = ref<HTMLVideoElement | null>(null)
const expanded = ref(false)
const memoryOpen = ref(false)

const FAILURES: Record<ArScanFailure, string> = {
  camera_denied: 'Нет доступа к камере. Разрешите его в настройках телефона.',
  camera_unavailable: 'Камера недоступна на этом устройстве.',
  camera_failed: 'Не удалось включить камеру.',
  location_denied: 'Нет доступа к геолокации. Разрешите его в настройках телефона.',
  gps_disabled: 'Геолокация выключена. Включите её в настройках телефона.',
}

/** one line about what the screen is doing / why it cannot decide */
const status = computed<{ text: string; warn?: boolean } | null>(() => {
  if (scan.phase === 'starting') return { text: 'Включаем камеру…' }
  if (scan.phase !== 'running') return null
  if (scan.gps === 'waiting') return { text: 'Определяем местоположение…' }
  if (scan.gps === 'lost' && !scan.position) return { text: 'Нет сигнала GPS. Выйдите на открытое место.', warn: true }
  if (scan.outlinesState === 'loading') return { text: 'Ищем здания рядом…' }
  if (scan.outlinesState === 'error')
    return { text: scan.outlinesError?.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить здания', warn: true }
  // the open card is self-explanatory (search is paused until it is closed), as in the mockup
  if (scan.selection.id !== null) return null
  const m = scan.match
  if (m?.status === 'inaccurate')
    return { text: `Точность GPS ±${Math.round(scan.position?.accuracyM ?? 0)} м — выйдите на открытое место`, warn: true }
  if (scan.headingState === 'needs_permission') return { text: 'Нужен доступ к компасу', warn: true }
  if (scan.headingState === 'flat') return { text: 'Держите телефон вертикально' }
  if (scan.headingState === 'unavailable') return { text: 'Компас недоступен — здание не определить', warn: true }
  if (scan.headingState === 'waiting') return { text: 'Ждём данные компаса…' }
  if (scan.selection.id !== null) return { text: 'Похоже, это здание (по GPS и компасу)' }
  if (m?.status === 'likely') return { text: 'Уточняем…' }
  if (m?.status === 'ambiguous') return { text: 'В кадре несколько зданий — выберите нужное' }
  if (m?.status === 'none') return { text: 'Здание не определено. Наведите камеру на здание.' }
  return null
})

/**
 * manual choice only between the buildings competing in the frame («Какое здание?»); the «Здания рядом»
 * list was removed at the owner's request (2026-10-27)
 */
const options = computed(() => {
  const m = scan.match
  if (!m || scan.selection.id !== null || scan.outlinesState !== 'ready' || m.status !== 'ambiguous') return []
  const precise = (scan.position?.accuracyM ?? Infinity) <= 20
  return m.candidates.slice(0, 4).map((c) => ({ outline: c.outline, distanceM: precise ? c.distanceM : null }))
})

const noBuildingsNearby = computed(
  () => scan.outlinesState === 'ready' && scan.match !== null && scan.match.nearby.length === 0 && scan.match.candidates.length === 0,
)

function label(o: BuildingOutline): string {
  return o.game?.name ?? o.name ?? 'Здание'
}

const aimed = computed(() => scan.selection.id !== null && !scan.selection.manual)
const outline = computed(() => scan.selectedOutline)
const entry = computed(() => (outline.value ? info.get(outline.value.id) : null))
const orgEntry = computed(() => (outline.value ? info.organizations(outline.value.id) : null))

function choose(id: number): void {
  expanded.value = false
  scan.choose(id)
}

function closeCard(): void {
  expanded.value = false
  scan.close()
}

function openScan(gameBuildingId: string): void {
  void router.push({ name: 'scan', params: { buildingId: gameBuildingId } })
}

function close(): void {
  if (window.history.length > 1) router.back()
  else void router.replace('/map')
}

function startCamera(): void {
  if (video.value) void scan.start(video.value)
}

let unlisten: (() => void) | null = null
onMounted(() => {
  startCamera()
  // release the camera and sensors in the background; restart on return
  unlisten = services().lifecycle.onActiveChange((active) => {
    if (!active) scan.stop()
    else if (scan.phase === 'idle') startCamera()
  })
})
onBeforeUnmount(() => {
  unlisten?.()
  scan.stop()
})
</script>

<template>
  <main class="ar">
    <video ref="video" class="ar__video" playsinline muted autoplay aria-hidden="true" />

    <header v-if="status" class="ar__top">
      <p class="ar__status" :class="{ 'ar__status--warn': status.warn }" role="status">{{ status.text }}</p>
    </header>

    <!-- aiming aid only: it marks the centre of view, it does not "recognise" anything -->
    <div v-if="scan.phase === 'running'" class="ar__reticle" :class="{ 'ar__reticle--on': aimed }" aria-hidden="true">
      <span /><span /><span /><span />
    </div>

    <!-- tapping the camera view closes the card and resumes the search -->
    <button v-if="outline" type="button" class="ar__dismiss" aria-label="Закрыть карточку" @click="closeCard" />

    <section v-if="scan.phase === 'failed' && scan.failure" class="ar__failure card" role="alert">
      <p>{{ FAILURES[scan.failure] }}</p>
      <AppButton block @click="startCamera">Попробовать снова</AppButton>
      <AppButton block variant="secondary" @click="close">Назад к карте</AppButton>
    </section>

    <div v-else class="ar__bottom">
      <div v-if="scan.phase === 'starting'" class="ar__loader"><FigureLoader :size="36" /></div>

      <AppButton v-if="scan.headingState === 'needs_permission'" @click="scan.enableCompass()">Включить компас</AppButton>
      <AppButton v-if="scan.outlinesState === 'error'" variant="secondary" @click="scan.retryOutlines()">Повторить</AppButton>

      <BuildingInfoSheet
        v-if="outline"
        v-model:expanded="expanded"
        :outline="outline"
        :info="entry"
        :organizations="orgEntry?.state === 'ready' ? orgEntry.data : null"
        :organizations-loading="orgEntry?.state === 'loading'"
        :distance-m="scan.distanceM"
        @retry="info.load(outline.id, true)"
        @scan="openScan"
        @memory="memoryOpen = true"
        @close="closeCard"
      />

      <section v-else-if="options.length" class="ar__choice card" aria-label="Выберите здание">
        <h2>Какое здание?</h2>
        <button v-for="o in options" :key="o.outline.id" type="button" class="ar__option" @click="choose(o.outline.id)">
          <span>{{ label(o.outline) }}</span>
          <small v-if="o.distanceM !== null">≈{{ Math.round(o.distanceM / 5) * 5 }} м</small>
        </button>
      </section>
      <p v-else-if="noBuildingsNearby && scan.outsideGame" class="ar__empty card">Здесь игры пока нет — она идёт в Завидово.</p>
      <p v-else-if="noBuildingsNearby" class="ar__empty card">
        В радиусе {{ MATCH.nearbyRadiusM }} м нет зданий из нашей базы.
      </p>
    </div>

    <MemoryEditor
      v-if="memoryOpen && outline?.game"
      :building-id="outline.game.id"
      :place="{ buildingName: outline.game.name, address: outline.address, rarity: outline.game.rarity }"
      :fallback-photo="outline.game.imageUrl"
      @close="memoryOpen = false"
    />
  </main>
</template>

<style scoped lang="scss">
.ar {
  position: fixed;
  inset: 0;
  background: #000;
  color: #fff;
  overflow: hidden;
}
.ar__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ar__top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  justify-content: center;
  padding: calc(var(--safe-top, 0px) + 12px) 16px 0;
}
.ar__status {
  margin: 0;
  padding: 10px 14px;
  border-radius: 18px;
  background: rgb(0 0 0 / 55%);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  &--warn {
    background: rgb(160 60 0 / 75%);
  }
}
// viewfinder from the mockup: 200pt square, four rounded corners, a thin cross in the centre
.ar__reticle {
  $size: 200px;
  $arm: 34px;
  position: absolute;
  left: 50%;
  top: 45%;
  width: $size;
  height: $size;
  margin: calc($size / -2) 0 0 calc($size / -2);
  border-radius: 18px;
  background: rgb(255 255 255 / 12%);
  color: #fff;
  transition: color 0.2s var(--ease), transform 0.2s var(--ease);
  // the centre cross
  &::before,
  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    background: currentColor;
  }
  &::before {
    width: 20px;
    height: 1.5px;
    margin: -0.75px 0 0 -10px;
  }
  &::after {
    width: 1.5px;
    height: 20px;
    margin: -10px 0 0 -0.75px;
  }
  span {
    position: absolute;
    width: $arm;
    height: $arm;
    border: 4px solid currentColor;
    &:nth-child(1) {
      top: 0;
      left: 0;
      border-width: 4px 0 0 4px;
      border-top-left-radius: 18px;
    }
    &:nth-child(2) {
      top: 0;
      right: 0;
      border-width: 4px 4px 0 0;
      border-top-right-radius: 18px;
    }
    &:nth-child(3) {
      bottom: 0;
      left: 0;
      border-width: 0 0 4px 4px;
      border-bottom-left-radius: 18px;
    }
    &:nth-child(4) {
      bottom: 0;
      right: 0;
      border-width: 0 4px 4px 0;
      border-bottom-right-radius: 18px;
    }
  }
  &--on {
    color: var(--c-accent);
    transform: scale(1.04);
  }
}
.ar__dismiss {
  position: absolute;
  inset: 0;
  z-index: 1;
  padding: 0;
  border: 0;
  background: none;
}
.ar__bottom {
  // above the tab bar (it sits at max(safe-bottom - 13px, 12px), see BottomNav)
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(var(--nav-height) + max(var(--safe-bottom, 0px) - 13px, 12px) + 4px);
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--c-text);
}
.ar__loader {
  display: grid;
  place-items: center;
  color: #fff;
}
.ar__choice {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
  h2 {
    font-size: 15px;
    font-weight: 700;
    margin: 0 0 4px;
  }
}
.ar__option {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  padding: 12px;
  border: 0;
  border-radius: 12px;
  background: var(--c-surface-2);
  color: var(--c-text);
  font-size: 15px;
  text-align: left;
  small {
    flex: none;
    color: var(--c-text-2);
  }
}
.ar__empty {
  padding: 14px;
  font-size: 14px;
}
.ar__failure {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(var(--nav-height) + max(var(--safe-bottom, 0px) - 13px, 12px) + 4px);
  z-index: 3;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--c-text);
}
</style>
