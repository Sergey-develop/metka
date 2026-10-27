<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import CoinIcon from '@/components/ui/CoinIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { services } from '@/app/providers/services'
import { CameraError } from '@/services/camera/types'
import { useAreaQuestsStore, type StepOutcome } from '@/stores/areaQuests'
import { useMapStore } from '@/stores/map'
import { useRouteStore } from '@/stores/route'
import type { RouteStep } from '@/types/game'
import { distanceMeters, formatDistance } from '@/utils/geo'
import { message, rewardLines } from './outcome'
import { routePhoto, stepPhoto } from './photos'
import { doneCount, hasPoint, KIND_LABEL, nextStep, placeTarget, stepsXp } from './routes'

/** A quest route: its steps in order, each done on site (check-in, photo or a question). */
const props = defineProps<{ slug: string }>()
const router = useRouter()
const quests = useAreaQuestsStore()
const map = useMapStore()
const walk = useRouteStore()

const route = computed(() => quests.routes.find((r) => r.slug === props.slug) ?? null)
const openStep = ref<string | null>(null)
const answers = ref<Record<string, number>>({})
const outcomes = ref<Record<string, StepOutcome>>({})
/** the final screen of the route, shown once when its last step is done */
const finished = ref(false)
/** the reward of the step just done: the step folds as the next one opens, so it is shown on top */
const toast = ref<{ title: string; lines: string[] } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(title: string, lines: string[]): void {
  clearTimeout(toastTimer)
  toast.value = { title, lines }
  toastTimer = setTimeout(() => (toast.value = null), 4500)
}
onBeforeUnmount(() => clearTimeout(toastTimer))

// the suggested step is open until the player picks another one
watch(
  route,
  (r) => {
    if (r && (openStep.value === null || !r.steps.some((s) => s.id === openStep.value))) openStep.value = nextStep(r)?.id ?? null
  },
  { immediate: true },
)

function distance(step: RouteStep): string | null {
  if (!map.position || !hasPoint(step.place)) return null
  return formatDistance(distanceMeters(map.position, step.place))
}

async function send(step: RouteStep): Promise<void> {
  const wasCompleted = !!route.value?.completedAt
  const outcome = await quests.complete(step, step.kind === 'question' ? (answers.value[step.id] ?? null) : null)
  if (!outcome) return
  outcomes.value = { ...outcomes.value, [step.id]: outcome }
  if (outcome.kind !== 'done') return
  if (outcome.routeCompleted && !wasCompleted) finished.value = true
  else {
    if (outcome.xp > 0) showToast(step.title, rewardLines(outcome))
    const next = route.value && nextStep(route.value)
    if (next) openStep.value = next.id
  }
}

function takePhoto(step: RouteStep): void {
  // called straight from the tap: browsers drop a file-input click after an await
  services()
    .camera.takePhoto()
    .then((photo) => {
      if (photo.previewUrl) quests.setPhoto(step.id, photo.previewUrl)
      return send(step)
    })
    .catch((e: unknown) => {
      if (e instanceof CameraError && e.code === 'cancelled') return
      outcomes.value = { ...outcomes.value, [step.id]: { kind: 'camera' } }
    })
}

/** dev with mocks only: puts the mock GPS at the step's place, so a route can be walked from the desk */
const devTools = services().devTools
function teleport(step: RouteStep): void {
  if (devTools && hasPoint(step.place)) devTools.teleport(step.place.lat, step.place.lng)
}

function walkTo(step: RouteStep): void {
  if (!hasPoint(step.place)) return
  map.select(null)
  walk.start(placeTarget(step.place), `/routes/${props.slug}`)
  void router.push('/map')
}

onMounted(() => void quests.load())
</script>

<template>
  <main class="page rd">
    <header class="rd__head">
      <button class="rd__back" aria-label="Назад" @click="router.back()"><AppIcon name="back" /></button>
      <h1>Маршрут</h1>
    </header>

    <StateBlock
      v-if="quests.error && !quests.data"
      kind="error"
      :title="quests.error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
      action-label="Повторить"
      @action="quests.load(true)"
    />
    <StateBlock v-else-if="!quests.data" kind="loading" title="Загружаем маршрут…" />
    <StateBlock v-else-if="!route" kind="empty" title="Маршрут не найден" action-label="Все маршруты" @action="router.replace('/routes')" />

    <template v-else>
      <img v-if="routePhoto(route)" class="rd__cover" :src="routePhoto(route)!" alt="" />
      <section class="rd__intro">
        <p class="rd__meta"><FilledIcon name="runner" :size="16" />{{ route.duration }} · {{ route.audience }}</p>
        <h2 class="rd__title">{{ route.title }}</h2>
        <p class="rd__quest">Квест «{{ route.questTitle }}»</p>
        <p class="rd__text">{{ route.description }}</p>
        <p v-if="route.note" class="rd__note">{{ route.note }}</p>
        <div class="rd__progress">
          <span class="rd__bar" aria-hidden="true"><span :style="{ width: `${(doneCount(route) / Math.max(route.steps.length, 1)) * 100}%` }" /></span>
          <span>{{ doneCount(route) }}/{{ route.steps.length }}</span>
        </div>
      </section>

      <ol class="steps">
        <li v-for="step in route.steps" :key="step.id" class="st" :class="{ 'st--done': step.doneAt, 'st--open': openStep === step.id }">
          <button class="st__row" :aria-expanded="openStep === step.id" @click="openStep = openStep === step.id ? null : step.id">
            <span class="st__num" aria-hidden="true">
              <AppIcon v-if="step.doneAt" name="check" :size="16" />
              <template v-else>{{ step.ord }}</template>
            </span>
            <span class="st__head">
              <span class="st__title">{{ step.title }}</span>
              <span class="st__sub">
                {{ KIND_LABEL[step.kind] }}<template v-if="step.place"> · {{ step.place.name }}</template>
                <template v-if="distance(step) && !step.doneAt"> · {{ distance(step) }}</template>
              </span>
            </span>
            <span class="st__xp">+{{ step.rewardXp }}</span>
          </button>

          <div v-if="openStep === step.id" class="st__body">
            <p class="st__task">{{ step.task }}</p>
            <p v-if="step.safety" class="st__safety">{{ step.safety }}</p>
            <p v-if="step.artifact" class="st__artifact">Артефакт «{{ step.artifact.title }}»</p>
            <img v-if="quests.photos[step.id]" class="st__photo" :src="quests.photos[step.id]" alt="Твоё фото" />
            <img v-else-if="stepPhoto(step)" class="st__photo st__photo--place" :src="stepPhoto(step)!" :alt="step.place?.name ?? ''" loading="lazy" />

            <template v-if="!step.doneAt">
              <fieldset v-if="step.kind === 'question' && step.options" class="st__options">
                <legend>{{ step.question }}</legend>
                <label v-for="(o, i) in step.options" :key="i" class="st__option" :class="{ on: answers[step.id] === i }">
                  <input v-model="answers[step.id]" type="radio" :name="step.id" :value="i" />{{ o }}
                </label>
              </fieldset>

              <div class="st__actions">
                <button
                  v-if="step.kind === 'photo'"
                  class="st__primary"
                  :disabled="quests.busyStep !== null"
                  @click="takePhoto(step)"
                >
                  <AppIcon name="camera" :size="20" />{{ quests.busyStep === step.id ? 'Проверяем…' : 'Сделать фото' }}
                </button>
                <button
                  v-else
                  class="st__primary"
                  :disabled="quests.busyStep !== null || (step.kind === 'question' && answers[step.id] === undefined)"
                  @click="send(step)"
                >
                  {{ quests.busyStep === step.id ? 'Проверяем…' : step.kind === 'question' ? 'Ответить' : 'Я на месте' }}
                </button>
                <button v-if="hasPoint(step.place)" class="st__walk" :aria-label="`Как дойти: ${step.place.name}`" @click="walkTo(step)">
                  <FilledIcon name="pin" :size="20" />
                </button>
              </div>
              <button v-if="devTools && hasPoint(step.place)" class="st__dev" @click="teleport(step)">
                Переместиться к точке (dev)
              </button>
            </template>

            <p
              v-if="outcomes[step.id]"
              class="st__result"
              :class="{ 'st__result--ok': outcomes[step.id]!.kind === 'done' }"
              role="status"
            >
              {{ message(outcomes[step.id]!) }}
              <template v-for="line in rewardLines(outcomes[step.id]!)" :key="line"><br />{{ line }}</template>
            </p>
          </div>
        </li>
      </ol>

      <section class="fin" :class="{ 'fin--done': route.completedAt }">
        <p class="fin__label">Финал</p>
        <h2>{{ route.finalTitle }}</h2>
        <p class="fin__text">{{ route.completedAt ? route.finalText : `Выполни все задания маршрута (${route.steps.length}).` }}</p>
        <ul class="fin__rewards">
          <li>+{{ route.rewardXp }} опыта</li>
          <li><CoinIcon :size="16" />{{ route.rewardCoins }}</li>
          <li v-if="route.artifact">«{{ route.artifact.title }}»</li>
        </ul>
        <p class="fin__total">Всего за маршрут: {{ stepsXp(route) + route.rewardXp }} опыта</p>
      </section>
    </template>

    <Transition name="fade">
      <div v-if="toast" class="toast" role="status">
        <p class="toast__title">«{{ toast.title }}» — выполнено</p>
        <p v-for="line in toast.lines" :key="line">{{ line }}</p>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="finished && route" class="done" role="dialog" aria-modal="true" aria-labelledby="done-title">
        <div class="done__card">
          <p class="done__label">Маршрут пройден</p>
          <h2 id="done-title">{{ route.finalTitle }}</h2>
          <p>+{{ route.rewardXp }} опыта · +{{ route.rewardCoins }} монет</p>
          <p v-if="route.artifact">Артефакт «{{ route.artifact.title }}»</p>
          <button class="st__primary" @click="finished = false">Отлично</button>
          <RouterLink to="/routes" class="done__more">Другие маршруты</RouterLink>
        </div>
      </div>
    </Transition>
  </main>
</template>

<style scoped lang="scss">
$blue: #0189ff;
$card: #f3f3f9;

.rd {
  padding-bottom: calc(var(--nav-height) + var(--safe-bottom) + 24px);
  background: #fff;
}
.rd__head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  margin: 8px 0 16px;
  h1 {
    font-size: 17px;
    font-weight: 600;
    color: #000;
  }
}
.rd__back {
  position: absolute;
  left: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #eeeef0;
  color: #000;
}
.rd__cover {
  display: block;
  width: 100%;
  height: 200px;
  margin-bottom: 16px;
  border-radius: 16px;
  object-fit: cover;
}
.rd__intro {
  margin-bottom: 20px;
}
.rd__meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #8e8e93;
}
.rd__title {
  margin-top: 6px;
  font-size: 24px;
  font-weight: 600;
  line-height: 28px;
  color: #000;
}
.rd__quest {
  margin-top: 4px;
  font-size: 15px;
  color: $blue;
}
.rd__text {
  margin-top: 10px;
  font-size: 15px;
  line-height: 21px;
  color: #3c3c43;
}
.rd__note {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff6d6;
  font-size: 13px;
  line-height: 18px;
  color: #5c4a00;
}
.rd__progress {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  font-size: 14px;
  color: #8e8e93;
}
.rd__bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #e5e5ea;
  overflow: hidden;
  span {
    display: block;
    height: 100%;
    background: $blue;
    transition: width 0.4s ease;
  }
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  list-style: none;
}
.st {
  border-radius: 14px;
  background: $card;
  &--open {
    background: #eaf4ff;
  }
}
.st__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 0;
  background: transparent;
  text-align: left;
  color: #000;
}
.st__num {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #fff;
  font-size: 14px;
  font-weight: 600;
  color: $blue;
  .st--done & {
    background: $blue;
    color: #fff;
  }
}
.st__head {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.st__title {
  font-size: 16px;
  font-weight: 500;
}
.st__sub {
  font-size: 13px;
  color: #8e8e93;
}
.st__xp {
  flex: none;
  font-size: 13px;
  font-weight: 500;
  color: $blue;
}
.st__body {
  padding: 0 12px 14px 54px;
}
.st__photo--place {
  margin: 0 0 10px;
}
.st__task {
  font-size: 15px;
  line-height: 21px;
  color: #000;
}
.st__safety {
  margin-top: 8px;
  font-size: 13px;
  line-height: 18px;
  color: #b4441c;
}
.st__artifact {
  margin-top: 6px;
  font-size: 13px;
  color: #8e8e93;
}
.st__photo {
  display: block;
  width: 100%;
  max-height: 220px;
  margin-top: 10px;
  border-radius: 10px;
  object-fit: cover;
}
.st__options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  border: 0;
  legend {
    margin-bottom: 6px;
    font-size: 15px;
    font-weight: 500;
    color: #000;
  }
}
.st__option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  background: #fff;
  font-size: 15px;
  color: #000;
  &.on {
    outline: 2px solid $blue;
  }
  input {
    accent-color: $blue;
  }
}
.st__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.st__primary {
  flex: 1;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 14px;
  background: $blue;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  &:disabled {
    opacity: 0.5;
  }
}
.st__walk {
  flex: none;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 14px;
  background: #fff;
  color: $blue;
}
.st__dev {
  margin-top: 8px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: #8e8e93;
  font-size: 13px;
  text-decoration: underline;
}
.st__result {
  margin-top: 10px;
  font-size: 14px;
  line-height: 19px;
  color: #b4441c;
  &--ok {
    color: #1a7f37;
  }
}

.fin {
  margin-top: 20px;
  padding: 16px;
  border-radius: 14px;
  background: $card;
  h2 {
    font-size: 20px;
    font-weight: 600;
    color: #000;
  }
  &--done {
    background: $blue;
    color: #fff;
    h2,
    .fin__label,
    .fin__text,
    .fin__total {
      color: #fff;
    }
  }
}
.fin__label {
  font-size: 13px;
  color: #8e8e93;
}
.fin__text {
  margin-top: 4px;
  font-size: 14px;
  color: #3c3c43;
}
.fin__rewards {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 8px;
    background: #fff;
    font-size: 13px;
    font-weight: 500;
    color: #000;
  }
}
.fin__total {
  margin-top: 8px;
  font-size: 13px;
  color: #8e8e93;
}

.done {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(0 0 0 / 45%);
}
.done__card {
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
  border-radius: 20px;
  background: #fff;
  text-align: center;
  color: #3c3c43;
  h2 {
    font-size: 22px;
    font-weight: 600;
    color: #000;
  }
  .st__primary {
    margin-top: 8px;
    flex: none;
  }
}
.done__label {
  font-size: 13px;
  color: $blue;
}
.done__more {
  padding: 8px;
  font-size: 14px;
  color: $blue;
}
.toast {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 12px);
  z-index: 40;
  padding: 12px 16px;
  border-radius: 14px;
  background: #1c1c1e;
  color: #fff;
  font-size: 14px;
  line-height: 20px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 20%);
}
.toast__title {
  font-weight: 600;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
