<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSwipeBack } from '@/features/locations/swipeBack'
import AppIcon from '@/components/ui/AppIcon.vue'
import CoinIcon from '@/components/ui/CoinIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import StateBlock from '@/components/ui/StateBlock.vue'
import { services } from '@/app/providers/services'
import { CameraError } from '@/services/camera/types'
import { useAreaQuestsStore, type StepOutcome } from '@/stores/areaQuests'
import { useMapStore } from '@/stores/map'
import { useRouteStore } from '@/stores/route'
import artifactBadge from '@/assets/collections/rare.webp'
import type { RouteStep, StepKind } from '@/types/game'
import { distanceMeters, formatDistance } from '@/utils/geo'
import { plural } from '@/utils/plural'
import { message, rewardLines } from './outcome'
import { routePhoto, stepPhoto } from './photos'
import { doneCount, hasPoint, nextStep, placeTarget } from './routes'

/**
 * A quest route (mockup «Страница Квеста»): the cover with the quest and its rewards, the progress line,
 * the steps as cards that open to the task, its condition, reward and artifact, then the final.
 * Each step is done on site (check-in, photo or a question); «Открыть карту» walks there.
 */
const props = defineProps<{ slug: string }>()
const router = useRouter()
const quests = useAreaQuestsStore()
const map = useMapStore()
const walk = useRouteStore()
/** swipe right: back to the map it lies over, or to the routes */
const swipeBack = useSwipeBack('/routes')

const route = computed(() => quests.routes.find((r) => r.slug === props.slug) ?? null)
const done = computed(() => (route.value ? doneCount(route.value) : 0))
/** share of the progress line between the first and the last node */
const fill = computed(() => {
  const n = route.value?.steps.length ?? 0
  return n > 1 ? Math.max(0, done.value - 1) / (n - 1) : done.value > 0 ? 1 : 0
})
const stepsLabel = (n: number) => `${n} ${plural(n, ['задание', 'задания', 'заданий'])}`
const CONDITION: Record<Exclude<StepKind, 'question'>, string> = {
  checkin: 'Чек-ин в точке',
  photo: 'Сделать фотографию на месте',
}
const condition = (s: RouteStep) => (s.kind === 'question' ? (s.question ?? '') : CONDITION[s.kind])

const canShare = typeof navigator !== 'undefined' && (!!navigator.share || !!navigator.clipboard)
const copied = ref(false)
async function share(): Promise<void> {
  const url = window.location.href
  try {
    if (navigator.share) await navigator.share({ title: route.value?.questTitle ?? 'Квест', url })
    else {
      await navigator.clipboard.writeText(url)
      copied.value = true
      setTimeout(() => (copied.value = false), 2000)
    }
  } catch {
    // cancelled by the user or not allowed: nothing to report
  }
}
const openStep = ref<string | null>(null)
/** a step opens and closes smoothly: its height runs from 0 to the content's and back */
function expandEnter(el: Element): void {
  const box = el as HTMLElement
  box.style.height = '0px'
  void box.offsetHeight // start from 0
  box.style.height = `${box.scrollHeight}px`
}
function expandDone(el: Element): void {
  ;(el as HTMLElement).style.height = '' // free to grow (an answer, a result line)
}
function expandLeave(el: Element): void {
  const box = el as HTMLElement
  box.style.height = `${box.scrollHeight}px`
  void box.offsetHeight
  box.style.height = '0px'
}
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
  <main class="rd" v-on="swipeBack.handlers">
    <div v-if="!route" class="rd__state">
      <button class="round" aria-label="Назад" @click="router.back()"><AppIcon name="back" :size="22" /></button>
      <StateBlock
        v-if="quests.error && !quests.data"
        kind="error"
        :title="quests.error.code === 'offline' ? 'Нет сети' : 'Не удалось загрузить'"
        action-label="Повторить"
        @action="quests.load(true)"
      />
      <StateBlock v-else-if="!quests.data" kind="loading" title="Загружаем маршрут…" />
      <StateBlock v-else kind="empty" title="Маршрут не найден" action-label="Все маршруты" @action="router.replace('/routes')" />
    </div>

    <template v-else>
      <!-- mockup «Страница Квеста»: the cover with the quest's name and what it gives -->
      <header class="hero" :style="routePhoto(route) ? { backgroundImage: `url(${routePhoto(route)})` } : undefined">
        <div class="hero__bar">
          <button class="round" aria-label="Назад" @click="router.back()"><AppIcon name="back" :size="22" /></button>
          <button v-if="canShare" class="round round--glass" :aria-label="copied ? 'Ссылка скопирована' : 'Поделиться'" @click="share">
            <svg v-if="!copied" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="m15.5 8.5-6.4 6.4a1.9 1.9 0 0 0 2.7 2.7l7-7a3.8 3.8 0 0 0-5.4-5.4l-7 7a5.7 5.7 0 0 0 8 8l5.2-5.2" />
            </svg>
            <AppIcon v-else name="check" :size="20" />
          </button>
        </div>
        <div class="hero__text">
          <span class="hero__tag">Квест</span>
          <h1 class="hero__title">{{ route.questTitle }}</h1>
          <p class="hero__desc">{{ route.description }}</p>
          <p class="hero__chips">
            <span class="chip chip--steps">{{ stepsLabel(route.steps.length) }}</span>
            <span class="chip"><CoinIcon :size="16" />+{{ route.rewardCoins }}</span>
            <span v-if="route.artifact" class="chip"><img class="chip__badge" :src="artifactBadge" alt="" />Артефакт «{{ route.artifact.title }}»</span>
          </p>
        </div>
      </header>

      <div class="rd__body">
        <section class="prog" aria-label="Прогресс квеста">
          <header class="prog__head">
            <h2>Прогресс квеста</h2>
            <span class="prog__count">{{ done }}/{{ route.steps.length }}</span>
          </header>
          <ol class="prog__line" :style="{ '--fill': fill }" aria-hidden="true">
            <li v-for="step in route.steps" :key="step.id" :class="{ on: step.doneAt }" />
          </ol>
        </section>

        <h2 class="rd__h2">Задания</h2>
        <ol class="steps">
          <li v-for="step in route.steps" :key="step.id" class="st" :class="{ 'st--done': step.doneAt, 'st--open': openStep === step.id }">
            <button class="st__row" :aria-expanded="openStep === step.id" @click="openStep = openStep === step.id ? null : step.id">
              <img v-if="stepPhoto(step)" class="st__thumb" :src="stepPhoto(step)!" alt="" loading="lazy" />
              <span v-else class="st__thumb" />
              <span class="st__head">
                <span class="st__tags">
                  <span class="tag tag--num">Задание {{ step.ord }}</span>
                  <span class="tag" :class="step.doneAt ? 'tag--done' : 'tag--todo'">{{ step.doneAt ? 'Выполнено' : 'Не выполнено' }}</span>
                </span>
                <span class="st__title">{{ step.title }}</span>
                <span class="st__xp">+{{ step.rewardXp }} опыта</span>
              </span>
              <AppIcon class="st__chev" name="chevron" :size="20" />
            </button>

            <Transition name="expand" @enter="expandEnter" @after-enter="expandDone" @leave="expandLeave">
              <div v-if="openStep === step.id" class="st__wrap">
                <div class="st__body">
                  <p class="st__task">{{ step.task }}</p>
                  <div class="info">
                    <p class="info__row">
                      <FilledIcon class="info__icon" name="pin" :size="22" />
                      <span>
                        <small>{{ step.kind === 'question' ? 'Вопрос:' : 'Условия выполнения' }}</small>
                        {{ condition(step) }}
                      </span>
                    </p>
                    <p v-if="step.safety" class="info__row">
                      <span class="info__icon info__icon--warn" aria-hidden="true">!</span>
                      <span><small>Важно</small>{{ step.safety }}</span>
                    </p>
                    <div class="info__pair">
                      <p class="info__row">
                        <CoinIcon class="info__icon" :size="26" />
                        <span><small>Награда</small>+{{ step.rewardXp }} опыта</span>
                      </p>
                      <p v-if="step.artifact" class="info__row">
                        <img class="info__icon info__badge" :src="artifactBadge" alt="" />
                        <span><small>Артефакт</small>{{ step.artifact.title }}</span>
                      </p>
                    </div>
                  </div>
                  <img v-if="quests.photos[step.id]" class="st__photo" :src="quests.photos[step.id]" alt="Твоё фото" />

                  <template v-if="!step.doneAt">
                    <fieldset v-if="step.kind === 'question' && step.options" class="st__options">
                      <legend>{{ step.question }}</legend>
                      <label v-for="(o, i) in step.options" :key="i" class="st__option" :class="{ on: answers[step.id] === i }">
                        <input v-model="answers[step.id]" type="radio" :name="step.id" :value="i" />{{ o }}
                      </label>
                    </fieldset>
                    <button v-if="step.kind === 'photo'" class="st__primary" :disabled="quests.busyStep !== null" @click="takePhoto(step)">
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
                  </template>
                  <button v-if="hasPoint(step.place)" class="st__map" :class="{ 'st__map--main': step.doneAt }" @click="walkTo(step)">
                    Открыть карту<template v-if="distance(step) && !step.doneAt"> · {{ distance(step) }}</template>
                  </button>
                  <button v-if="devTools && hasPoint(step.place) && !step.doneAt" class="st__dev" @click="teleport(step)">
                    Переместиться к точке (dev)
                  </button>

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
              </div>
            </Transition>
          </li>
        </ol>

        <section class="fin" :class="{ 'fin--done': route.completedAt }">
          <svg class="fin__cup" width="44" height="44" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M7 3h10v2h3a1 1 0 0 1 1 1v1.5a4.5 4.5 0 0 1-4.1 4.48A5 5 0 0 1 13 14.9V17h3a1 1 0 0 1 1 1v2H7v-2a1 1 0 0 1 1-1h3v-2.1a5 5 0 0 1-3.9-2.92A4.5 4.5 0 0 1 3 7.5V6a1 1 0 0 1 1-1h3V3Zm0 4H5v.5a2.5 2.5 0 0 0 2 2.45V7Zm10 0v2.95A2.5 2.5 0 0 0 19 7.5V7h-2Z"
            />
          </svg>
          <div class="fin__text">
            <span class="tag tag--final">Финал</span>
            <h2>{{ route.finalTitle }}</h2>
            <p v-if="route.completedAt">{{ route.finalText }}</p>
          </div>
          <span class="fin__lock" :aria-label="route.completedAt ? 'Квест пройден' : `Откроется после всех заданий (${route.steps.length})`">
            <AppIcon v-if="route.completedAt" name="check" :size="22" />
            <svg v-else width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3Zm0 9.5a1.5 1.5 0 0 0-.8 2.77V18h1.6v-1.73A1.5 1.5 0 0 0 12 13.5Z" />
            </svg>
          </span>
        </section>
      </div>
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
// mockup «Страница Квеста» (390pt)
$blue: #0189ff;
$card: #f8f8fe;
$panel: #efeff6;

.rd {
  // swiped right back (useSwipeBack); vertical scrolling stays the browser's
  touch-action: pan-y;
  min-height: 100%;
  padding-bottom: calc(var(--nav-height) + var(--safe-bottom) + 24px);
  background: #fff;
}
.rd__state {
  padding: calc(var(--safe-top) + 12px) 16px 0;
}
.round {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #000;
  &--glass {
    background: rgb(255 255 255 / 45%);
    color: #fff;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
}

.hero {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: calc(var(--safe-top) + 380px);
  padding: calc(var(--safe-top) + 12px) 16px 48px;
  background: #2d7fd6 center / cover no-repeat;
  color: #fff;
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgb(0 0 0 / 10%) 0%, rgb(0 0 0 / 0%) 30%, rgb(1 50 110 / 65%) 100%);
  }
  > * {
    position: relative;
  }
}
.hero__bar {
  display: flex;
  justify-content: space-between;
}
.hero__tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgb(255 255 255 / 30%);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-size: 13px;
}
.hero__title {
  margin-top: 8px;
  font-size: 26px;
  font-weight: 600;
  line-height: 30px;
}
.hero__desc {
  max-width: 300px;
  margin-top: 8px;
  font-size: 13px;
  line-height: 17px;
}
.hero__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  line-height: 16px;
  color: #000;
  &--steps {
    background: #ffe27e;
    font-size: 13px;
  }
}
.chip__badge {
  width: 16px;
  height: 16px;
}

.rd__body {
  position: relative;
  margin-top: -24px;
  padding: 16px 16px 0;
  border-radius: 24px 24px 0 0;
  background: #fff;
}
.prog {
  padding: 16px;
  border-radius: 12px;
  background: $card;
}
.prog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  h2 {
    font-size: 15px;
    font-weight: 600;
    color: #000;
  }
}
.prog__count {
  min-width: 66px;
  padding: 3px 12px;
  border-radius: 6px;
  background: #dcecfc;
  font-size: 15px;
  text-align: center;
  color: #5d9ad8;
}
// the quest's steps as nodes on a line, filled up to the share of steps done
.prog__line {
  position: relative;
  display: flex;
  justify-content: space-between;
  margin: 18px 0 2px;
  padding: 0;
  list-style: none;
  &::before,
  &::after {
    content: '';
    position: absolute;
    left: 8px;
    top: 50%;
    height: 4px;
    margin-top: -2px;
    border-radius: 2px;
  }
  &::before {
    right: 8px;
    background: #dcecfc;
  }
  &::after {
    width: calc((100% - 16px) * var(--fill));
    background: $blue;
  }
  li {
    position: relative;
    z-index: 1;
    width: 16px;
    height: 16px;
    border: 2px solid #b9d7f5;
    border-radius: 50%;
    background: #fff;
    &.on {
      border: 4px solid $blue;
    }
  }
}

.rd__h2 {
  margin: 32px 0 14px;
  font-size: 22px;
  font-weight: 600;
  color: #000;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.st {
  border-radius: 12px;
  background: $card;
}
.st__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 8px 8px;
  border: 0;
  background: none;
  text-align: left;
  color: inherit;
}
.st__thumb {
  flex: none;
  width: 90px;
  height: 90px;
  border-radius: 6px;
  object-fit: cover;
  background: #dcecfc;
}
.st__head {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.st__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag {
  padding: 1px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 18px;
  color: #000;
  &--num {
    background: #ffe27e;
  }
  &--todo {
    background: #f25f5c;
    color: #fff;
  }
  &--done {
    background: #c5df4f;
  }
  &--final {
    background: $blue;
    color: #fff;
  }
}
.st__title {
  font-size: 16px;
  font-weight: 600;
  line-height: 20px;
  color: #000;
}
.st__xp {
  padding: 2px 8px;
  border-radius: 6px;
  background: #dcecfc;
  font-size: 12px;
  line-height: 18px;
  color: #000;
}
.st__chev {
  flex: none;
  color: #b0b0b8;
  transition: transform 0.2s var(--ease);
  .st--open & {
    transform: rotate(90deg);
  }
}
.st__wrap {
  overflow: hidden;
}
.expand-enter-active,
.expand-leave-active {
  transition:
    height 0.32s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.25s ease;
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .expand-enter-active,
  .expand-leave-active {
    transition-duration: 0.01s;
  }
}
.st__body {
  margin: 4px 8px 8px;
  padding: 12px;
  border-radius: 10px;
  background: $panel;
}
.st__task {
  font-size: 14px;
  line-height: 19px;
  color: #000;
}
.info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
}
.info__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.info__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #e4e4ee;
  font-size: 14px;
  line-height: 18px;
  color: #000;
  small {
    display: block;
    font-size: 13px;
    color: #8e8e93;
  }
}
.info__icon {
  flex: none;
  color: $blue;
  &--warn {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: #e5484d;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
  }
}
.info__badge {
  width: 28px;
  height: 28px;
}
.st__map {
  width: 100%;
  height: 48px;
  margin-top: 12px;
  border: 0;
  border-radius: 10px;
  background: #dcecfc;
  font-size: 16px;
  font-weight: 500;
  color: $blue;
  &--main {
    background: $blue;
    color: #fff;
  }
}
.st__primary {
  width: 100%;
  height: 48px;
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 10px;
  background: $blue;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  &:disabled {
    opacity: 0.5;
  }
}

.fin {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
  padding: 16px 20px;
  border-radius: 12px;
  background: #dcecfc;
  &--done {
    background: #e3f6ec;
  }
}
.fin__cup {
  flex: none;
  color: $blue;
}
.fin__text {
  flex: 1;
  h2 {
    margin-top: 6px;
    font-size: 17px;
    font-weight: 600;
    line-height: 21px;
    color: #000;
  }
  p {
    margin-top: 4px;
    font-size: 13px;
    color: #3c3c43;
  }
}
.fin__lock {
  flex: none;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #c6dff8;
  color: $blue;
  .fin--done & {
    background: #c5ecd6;
    color: #1a7f37;
  }
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
