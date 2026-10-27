<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import FigureLoader from '@/components/ui/FigureLoader.vue'
import PermissionSheet from '@/components/ui/PermissionSheet.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { useMapStore } from '@/stores/map'
import { useScanStore } from '@/stores/scan'
import { formatDistance } from '@/utils/geo'
import { failureMessage, recognitionMessage, rejectMessage } from './messages'

const props = defineProps<{ buildingId: string }>()
const scan = useScanStore()
const map = useMapStore()
const router = useRouter()
const { mocked, devTools } = services()

const PHASE_TEXT = {
  locating: 'Определяем местоположение…',
  capturing: 'Камера открыта',
  analyzing: 'Распознаём здание…',
  submitting: 'Проверяем на сервере…',
} as const

const failure = computed(() => (scan.failure ? failureMessage(scan.failure) : null))
const recognitionNote = computed(() => (scan.recognition ? recognitionMessage(scan.recognition) : null))
const distance = computed(() => (scan.building ? map.distanceTo(scan.building) : null))
const busyText = computed(() => (scan.phase in PHASE_TEXT ? PHASE_TEXT[scan.phase as keyof typeof PHASE_TEXT] : ''))

onMounted(() => {
  scan.start(props.buildingId)
  // no recognition model yet: find out early whether this account may scan by location (test mode)
  if (!services().recognition.isAvailable()) void scan.checkLocationTester()
  void scan.warmUp()
})
onBeforeUnmount(() => {
  scan.cancel()
  scan.coolDown()
})

function close(): void {
  scan.cancel()
  void router.replace('/map')
}

function teleport(): void {
  if (devTools && scan.building) devTools.teleport(scan.building.lat, scan.building.lng)
}
</script>

<template>
  <main class="scanner">
    <header class="scanner__head">
      <button class="icon-btn" aria-label="Назад" @click="close"><AppIcon name="back" /></button>
      <div class="scanner__title">
        <h1>{{ scan.building?.name ?? 'Сканирование' }}</h1>
        <p v-if="distance !== null" class="muted">{{ formatDistance(distance) }} от вас</p>
      </div>
    </header>

    <!-- every player since migration 030: the building counts by location, the photo goes to the album -->
    <p v-if="scan.locationTestMode" class="notice scanner__dev">
      Подойдите к зданию и сделайте снимок — оно откроется по вашему местоположению.
    </p>
    <p v-if="mocked" class="notice notice--warning scanner__dev">
      Режим разработки: распознавание симулируется, проверка на сервере — настоящая.
      <button class="link" @click="teleport">Переместиться к зданию</button>
    </p>

    <section v-if="!scan.building" class="card scanner__panel">
      <StateBlock kind="error" title="Здание не найдено" text="Вернитесь на карту и выберите здание." action-label="На карту" @action="close" />
    </section>

    <template v-else>
      <section class="viewfinder" :class="{ 'viewfinder--busy': scan.busy }">
        <img v-if="scan.photo?.previewUrl" :src="scan.photo.previewUrl" alt="Снимок здания" class="viewfinder__img" />
        <div v-else class="viewfinder__hint">
          <AppIcon name="camera" :size="40" />
          <p>Встаньте так, чтобы фасад был виден целиком, и сделайте снимок</p>
        </div>
        <div v-if="scan.busy" class="viewfinder__overlay" role="status">
          <FigureLoader class="viewfinder__loader" aria-hidden="true" />
          {{ busyText }}
        </div>
      </section>

      <section class="card scanner__panel" aria-live="polite">
        <!-- server verdict -->
        <template v-if="scan.phase === 'done' && scan.decision">
          <div v-if="scan.decision.status === 'accepted'" class="result result--ok">
            <AppIcon name="check" :size="32" />
            <h2>Здание открыто!</h2>
            <p v-if="scan.decision.reward">
              +{{ scan.decision.reward.xp }} XP · +{{ scan.decision.reward.coins }} ◎ · +{{ scan.decision.reward.influence }} влияния
            </p>
            <p v-for="q in scan.decision.completedQuests" :key="q.questId" class="muted">Задание выполнено: {{ q.title }}</p>
            <AppButton block @click="close">На карту</AppButton>
          </div>
          <div v-else-if="scan.decision.status === 'already_discovered'" class="result">
            <h2>Уже в коллекции</h2>
            <p class="muted">Это здание уже открыто, повторная награда не начисляется.</p>
            <AppButton block variant="secondary" @click="close">На карту</AppButton>
          </div>
          <div v-else class="result result--bad">
            <h2>Не засчитано</h2>
            <p>{{ rejectMessage(scan.decision.reason) }}</p>
            <AppButton block @click="scan.capture()">Снять ещё раз</AppButton>
          </div>
        </template>

        <!-- recognition outcome that was not sent to the server -->
        <div v-else-if="scan.phase === 'done' && recognitionNote" class="result result--bad">
          <h2>{{ recognitionNote.title }}</h2>
          <p>{{ recognitionNote.text }}</p>
          <AppButton block @click="scan.capture()">Снять ещё раз</AppButton>
        </div>

        <div v-else-if="scan.phase === 'failed' && failure" class="result result--bad" role="alert">
          <h2>{{ failure.title }}</h2>
          <p>{{ failure.text }}</p>
          <p v-if="failure.detail" class="result__detail">{{ failure.detail }}</p>
          <AppButton v-if="failure.retryable" block @click="scan.retry()">
            <AppIcon name="retry" :size="18" /> {{ scan.pendingSubmission ? 'Отправить снова' : 'Повторить' }}
          </AppButton>
          <AppButton v-else block variant="secondary" @click="close">На карту</AppButton>
        </div>

        <div v-else class="result">
          <p class="muted">Подойдите к зданию, наведите камеру на фасад и сделайте снимок. Награду подтверждает сервер.</p>
          <AppButton block :loading="scan.busy" @click="scan.capture()">
            <AppIcon name="camera" :size="18" /> Сделать снимок
          </AppButton>
          <AppButton
            v-if="scan.phase === 'analyzing' || scan.phase === 'locating' || scan.phase === 'capturing'"
            block
            variant="ghost"
            @click="scan.cancel()"
            >Отменить</AppButton
          >
        </div>
      </section>
    </template>

    <PermissionSheet v-if="scan.cameraPrompt" kind="camera" @allow="scan.confirmCamera()" @later="scan.dismissCameraPrompt()" />
  </main>
</template>

<style scoped lang="scss">
.scanner {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: calc(var(--safe-top) + 12px) 16px calc(var(--safe-bottom) + 16px);
}
.scanner__head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.scanner__title {
  min-width: 0;
  h1 {
    font-size: 20px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  p {
    font-size: 13px;
  }
}
.icon-btn {
  flex: none;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: var(--c-surface);
  box-shadow: var(--shadow-card);
  display: grid;
  place-items: center;
}
.scanner__dev {
  font-size: 12px;
}
.link {
  border: 0;
  background: none;
  padding: 0;
  color: inherit;
  font-weight: 700;
  text-decoration: underline;
}
.viewfinder {
  position: relative;
  flex: 1 1 auto;
  min-height: 260px;
  border-radius: var(--r-lg);
  background: #1b1d22;
  color: #c9ccd2;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.viewfinder__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.viewfinder__hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  font-size: 14px;
  max-width: 280px;
}
.viewfinder__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgb(17 19 23 / 55%);
  color: #fff;
  font-weight: 600;
}
.viewfinder__loader {
  color: #fff;
}
.scanner__panel {
  padding: 18px;
}
.result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  h2 {
    font-size: 20px;
    font-weight: 700;
  }
  &--ok {
    align-items: center;
    text-align: center;
    color: var(--c-success);
    h2,
    p {
      color: var(--c-text);
    }
  }
}
.result__detail {
  margin-top: 6px;
  font-size: 12px;
  line-height: 16px;
  color: #8e8e93;
  word-break: break-word;
}
</style>
