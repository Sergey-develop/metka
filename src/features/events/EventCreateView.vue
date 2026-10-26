<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { services } from '@/app/providers/services'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import type { ApiErrorCode } from '@/services/api/errors'
import { toApiError } from '@/services/api/errors'
import type { LngLatPair } from '@/services/map/types'
import { useAuthStore } from '@/stores/auth'
import { useEventsStore } from '@/stores/events'
import { EVENT_KINDS, type EventKind } from '@/types/game'
import { AvatarImageFailure, prepareMemoryPhoto } from '@/utils/avatarImage'
import EventDateSheet from './EventDateSheet.vue'
import EventPlacePicker from './EventPlacePicker.vue'
import EventTimeSheet from './EventTimeSheet.vue'
import { type DayValue, KIND_INFO, moscowDay, moscowInstant } from './eventKinds'

/**
 * «Создать событие», 4 steps (mockups 123/ивенты): -6 type → -5 meeting point → -1 date, time, limit
 * (-2 date sheet, -3 time sheet) → -4 title, description, cover. The server validates everything again.
 */
const router = useRouter()
const auth = useAuthStore()
const events = useEventsStore()

const STEPS = 4
const step = ref(1)
/** which way the last step change went, for the slide */
const stepDir = ref<'fwd' | 'back'>('fwd')
watch(step, (to, from) => {
  stepDir.value = to > from ? 'fwd' : 'back'
  // each step starts at the top: a step scrolled down would otherwise jump when a shorter one replaces it
  window.scrollTo({ top: 0 })
})

// step 1
const kind = ref<EventKind | null>(null)

// step 2: Moscow centre until the player's position is known (never asks for permission here)
const MOSCOW_CENTER: LngLatPair = [37.6176, 55.7558]
const startCenter = ref<LngLatPair>(MOSCOW_CENTER)
const center = ref<LngLatPair>(MOSCOW_CENTER)

// step 3: defaults — tomorrow at the next full hour, 10 people
const now = new Date()
const tomorrow = new Date(now.getTime() + 86_400_000)
const MIN_LEAD_MS = 15 * 60_000 // same as create_event
const MAX_DAYS = 90
const day = ref<DayValue>(moscowDay(tomorrow))
const hour = ref(Math.min(23, Number(tomorrow.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit' })) + 1))
const minute = ref(0)
const MIN_PEOPLE = 2
const MAX_PEOPLE = 100
const limit = ref(10)
const sheet = ref<'date' | 'time' | null>(null)
const minDay = moscowDay(now)
const maxDay = moscowDay(new Date(now.getTime() + MAX_DAYS * 86_400_000))

const startsAt = computed(() => moscowInstant(day.value, hour.value, minute.value))
const tooSoon = computed(() => startsAt.value.getTime() < Date.now() + MIN_LEAD_MS)
const pad = (n: number) => String(n).padStart(2, '0')
const dateText = computed(() => `${pad(day.value.day)}.${pad(day.value.month)}.${day.value.year}`)
const timeText = computed(() => `${pad(hour.value)}:${pad(minute.value)}`)

// step 4
const TITLE_MAX = 80
const DESCRIPTION_MAX = 500
const title = ref('')
const description = ref('')
const cover = ref<Blob | null>(null)
const coverPreview = ref<string | null>(null)
const coverError = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const saving = ref(false)
const saveError = ref<string | null>(null)

const canNext = computed(() => {
  if (step.value === 1) return kind.value !== null
  if (step.value === 3) return !tooSoon.value
  if (step.value === 4) return title.value.trim().length >= 3 && !saving.value
  return true
})

function back(): void {
  if (step.value > 1) step.value--
  else router.back()
}

async function next(): Promise<void> {
  if (!canNext.value) return
  if (step.value < STEPS) {
    // a title to start from: the type, which the player may keep
    if (step.value === 3 && !title.value && kind.value) title.value = KIND_INFO[kind.value].label
    step.value++
    return
  }
  await create()
}

async function onCoverPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow picking the same file again
  if (!file) return
  coverError.value = null
  try {
    // re-encoded: drops EXIF, including where the photo was taken
    const image = await prepareMemoryPhoto(file)
    cover.value = image
    if (coverPreview.value) URL.revokeObjectURL(coverPreview.value)
    coverPreview.value = URL.createObjectURL(image)
  } catch (e) {
    const code = e instanceof AvatarImageFailure ? e.code : null
    coverError.value = code === 'too_large' ? 'Картинка слишком большая.' : code === 'not_image' ? 'Выберите картинку.' : 'Не удалось прочитать картинку.'
  }
}

function removeCover(): void {
  if (coverPreview.value) URL.revokeObjectURL(coverPreview.value)
  cover.value = null
  coverPreview.value = null
}

const ERRORS: Partial<Record<ApiErrorCode, string>> = {
  invalid_event: 'Проверьте данные события: время — не раньше чем через 15 минут.',
  invalid_location: 'Место встречи должно быть в Москве.',
  invalid_photo: 'Не удалось загрузить обложку. Попробуйте другую.',
  too_many_events: 'У вас уже 5 предстоящих событий — это максимум.',
  offline: 'Нет подключения к сети.',
}

async function create(): Promise<void> {
  const userId = auth.userId
  if (!userId || !kind.value) return
  saving.value = true
  saveError.value = null
  try {
    const id = await services().api.createEvent(userId, {
      kind: kind.value,
      title: title.value.trim(),
      description: description.value.trim(),
      lat: center.value[1],
      lng: center.value[0],
      startsAt: startsAt.value,
      maxParticipants: limit.value,
      cover: cover.value,
    })
    void events.load()
    await router.replace(`/events/${id}`)
  } catch (e) {
    const code = toApiError(e).code
    saveError.value = ERRORS[code] ?? 'Не удалось создать событие.'
    if (code === 'invalid_location') step.value = 2
    else if (code === 'invalid_event' && tooSoon.value) step.value = 3
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    const geo = services().geolocation
    if ((await geo.checkPermission()) !== 'granted') return
    const fix = await geo.getCurrentPosition()
    // only before the player has moved the map
    if (step.value < 2) startCenter.value = center.value = [fix.lng, fix.lat]
  } catch {
    // stays on the Moscow centre
  }
})

onBeforeUnmount(() => {
  if (coverPreview.value) URL.revokeObjectURL(coverPreview.value)
})
</script>

<template>
  <main class="page wiz">
    <header class="wiz__head">
      <button class="wiz__back" aria-label="Назад" @click="back"><AppIcon name="back" /></button>
      <h1>Создать событие</h1>
    </header>
    <div class="wiz__progress">
      <span v-for="i in STEPS" :key="i" class="wiz__seg" :class="{ on: i <= step }" />
      <span class="wiz__step">Шаг {{ step }} из {{ STEPS }}</span>
    </div>

    <!-- steps slide the way the wizard moves: forward from the right, back from the left -->
    <Transition :name="stepDir === 'fwd' ? 'step-fwd' : 'step-back'" mode="out-in">
      <section v-if="step === 1" class="wiz__body">
        <h2>Выберите тип события</h2>
        <div class="kinds" role="radiogroup" aria-label="Тип события">
          <button
            v-for="k in EVENT_KINDS"
            :key="k"
            class="kind"
            role="radio"
            :aria-checked="kind === k"
            @click="kind = k"
          >
            <img class="kind__art" :src="KIND_INFO[k].art" alt="" />
            <span class="kind__foot">
              <span>{{ KIND_INFO[k].label }}</span>
              <span class="kind__check" :class="{ on: kind === k }" aria-hidden="true"><AppIcon v-if="kind === k" name="check" :size="16" /></span>
            </span>
          </button>
        </div>
      </section>

      <section v-else-if="step === 2" class="wiz__body wiz__body--fill">
        <h2>Укажите место встречи</h2>
        <p class="wiz__sub">Подвиньте карту так, чтобы метка стояла на месте встречи участников</p>
        <EventPlacePicker class="wiz__map" :center="startCenter" @change="center = $event" />
      </section>

      <section v-else-if="step === 3" class="wiz__body">
        <h2>Когда встречаемся?</h2>
        <p class="wiz__sub">Выберите дату, время<br />и количество участников</p>
        <div class="rows">
          <button class="row" @click="sheet = 'date'">
            <FilledIcon name="calendar" :size="26" class="row__icon" />
            <span class="row__text"><small>Дата</small><b>{{ dateText }}</b></span>
            <AppIcon name="chevron" :size="22" class="row__chev" />
          </button>
          <button class="row" @click="sheet = 'time'">
            <svg class="row__icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" fill-rule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm.9 4.5a.9.9 0 0 0-1.8 0V12c0 .3.1.5.3.7l3 2.5a.9.9 0 1 0 1.2-1.4l-2.7-2.2V7.5Z" />
            </svg>
            <span class="row__text"><small>Время</small><b>{{ timeText }}</b></span>
            <AppIcon name="chevron" :size="22" class="row__chev" />
          </button>
          <div class="row">
            <svg class="row__icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm7.5 2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6ZM9 13c3.6 0 6 1.7 6 4v1.2c0 .5-.4.8-.8.8H3.8a.8.8 0 0 1-.8-.8V17c0-2.3 2.4-4 6-4Zm7.5.4c2.6.1 4.5 1.4 4.5 3.3v1.5c0 .4-.4.8-.8.8H16.6c.2-.3.4-.6.4-1V17c0-1.4-.5-2.6-1.5-3.6h1Z" />
            </svg>
            <span class="row__text"><small>Лимит людей</small><b>{{ limit }}</b></span>
            <span class="stepper">
              <button aria-label="Меньше" :disabled="limit <= MIN_PEOPLE" @click="limit--">−</button>
              <button aria-label="Больше" :disabled="limit >= MAX_PEOPLE" @click="limit++">+</button>
            </span>
          </div>
        </div>
        <p v-if="tooSoon" class="wiz__warn" role="alert">Выберите время не раньше чем через 15 минут.</p>
      </section>

      <section v-else class="wiz__body">
        <h2>Добавьте описание<br />и обложку</h2>
        <div class="field">
          <label for="event-title">Название</label>
          <input id="event-title" v-model="title" :maxlength="TITLE_MAX" />
        </div>
        <div class="note">
          <textarea
            v-model="description"
            class="note__input"
            :maxlength="DESCRIPTION_MAX"
            aria-label="Описание"
            placeholder="Расскажите, что вас ждет, какие планы, что взять с собой"
          />
          <div class="note__foot">
            <input ref="fileInput" type="file" accept="image/*" class="visually-hidden" tabindex="-1" @change="onCoverPicked" />
            <span v-if="coverPreview" class="note__cover">
              <img :src="coverPreview" alt="Обложка" />
              <button aria-label="Убрать обложку" @click="removeCover"><AppIcon name="close" :size="14" /></button>
            </span>
            <button v-else class="note__camera" aria-label="Добавить обложку" @click="fileInput?.click()"><AppIcon name="camera" :size="24" /></button>
            <span class="note__count">{{ description.length }}/{{ DESCRIPTION_MAX }}</span>
          </div>
        </div>
        <p v-if="coverError" class="notice notice--error" role="alert">{{ coverError }}</p>
      </section>
    </Transition>

    <p v-if="saveError" class="notice notice--error wiz__error" role="alert">{{ saveError }}</p>

    <footer class="wiz__foot">
      <AppButton variant="secondary" @click="back">Назад</AppButton>
      <AppButton :disabled="!canNext" :loading="saving" @click="next">{{ step < STEPS ? 'Далее' : 'Создать' }}</AppButton>
    </footer>

    <Transition name="sheet">
      <EventDateSheet v-if="sheet === 'date'" :value="day" :min="minDay" :max="maxDay" @close="sheet = null" @apply="(d) => ((day = d), (sheet = null))" />
    </Transition>
    <Transition name="sheet">
      <EventTimeSheet
        v-if="sheet === 'time'"
        :hour="hour"
        :minute="minute"
        @close="sheet = null"
        @apply="(h, m) => ((hour = h), (minute = m), (sheet = null))"
      />
    </Transition>
  </main>
</template>

<style scoped lang="scss">
// measured on the 390pt mockups (Страница локации-1…-6)
$blue: #0189ff;
$card: #f2f2f7;

.wiz {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  // the steps slide sideways; no horizontal scroll while they move
  overflow-x: clip;
  padding-top: calc(var(--safe-top) + 40px);
  // the same gap above the tab bar as the sticky footer's: the buttons stay put on short and long steps
  padding-bottom: calc(var(--nav-height) + var(--safe-bottom) + 8px);
  background: #fff;
}
.wiz__head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  h1 {
    font-size: 17px;
    font-weight: 600;
    color: #000;
  }
}
.wiz__back {
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
.wiz__progress {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 24px;
}
.wiz__seg {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: #efeff1;
  transition: background-color 0.3s var(--ease);
  &.on {
    background: $blue;
  }
}
// step change: the old step slides out and fades, the new one comes in from the side the wizard moves to
.step-fwd-enter-active,
.step-back-enter-active {
  transition:
    opacity 0.24s ease,
    transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}
.step-fwd-leave-active,
.step-back-leave-active {
  transition:
    opacity 0.14s ease-in,
    transform 0.14s ease-in;
}
.step-fwd-enter-from,
.step-back-leave-to {
  opacity: 0;
  transform: translateX(28px);
}
.step-fwd-leave-to,
.step-back-enter-from {
  opacity: 0;
  transform: translateX(-28px);
}
@media (prefers-reduced-motion: reduce) {
  .wiz__seg,
  .step-fwd-enter-active,
  .step-back-enter-active,
  .step-fwd-leave-active,
  .step-back-leave-active {
    transition-duration: 0.01s;
  }
}
.wiz__step {
  margin-left: 8px;
  font-size: 12px;
  // equal-width digits: the progress bar does not twitch from «Шаг 1» to «Шаг 4»
  font-variant-numeric: tabular-nums;
  color: #6d6d6e;
  white-space: nowrap;
}
.wiz__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 36px;
  h2 {
    font-size: 20px;
    font-weight: 600;
    line-height: 24px;
    color: #000;
  }
}
.wiz__body--fill {
  flex: 1;
}
.wiz__sub {
  margin-bottom: 8px;
  font-size: 15px;
  line-height: 18px;
  color: #8e8e93;
}
.wiz__map {
  flex: 1;
  min-height: 320px;
}
.wiz__warn,
.wiz__error {
  margin-top: 8px;
  font-size: 13px;
}
.wiz__warn {
  color: #d93025;
}
.wiz__foot {
  position: sticky;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 8px);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: auto;
  padding-top: 16px;
  :deep(button) {
    height: 50px;
  }
}

.kinds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: 8px;
}
.kind {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 8px 10px;
  border: 0;
  border-radius: 8px;
  background: #f0f4fc;
  text-align: left;
}
.kind__art {
  width: 100%;
  aspect-ratio: 161 / 125;
  border-radius: 6px;
  object-fit: cover;
}
.kind__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
  font-size: 15px;
  font-weight: 500;
  color: #000;
}
.kind__check {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1px solid #9ec5ef;
  border-radius: 50%;
  background: #d9eafd;
  &.on {
    border-color: $blue;
    background: $blue;
    color: #fff;
  }
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 54px;
  padding: 0 8px 0 14px;
  border: 0;
  border-radius: 8px;
  background: $card;
  text-align: left;
  color: inherit;
}
.row__icon {
  flex: none;
  color: $blue;
}
.row__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  small {
    font-size: 12px;
    color: #6d6d6e;
  }
  b {
    font-size: 16px;
    font-weight: 500;
    color: #000;
  }
}
.row__chev {
  color: #8e8e93;
}
.stepper {
  display: flex;
  gap: 4px;
  button {
    width: 38px;
    height: 38px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: #e1e7ef;
    font-size: 20px;
    color: #000;
    &:disabled {
      color: #c7c7cc;
    }
  }
}

.note {
  display: flex;
  flex-direction: column;
  min-height: 168px;
  padding: 12px 14px 8px;
  border-radius: 8px;
  background: #f8f8fa;
}
.note__input {
  flex: 1;
  min-height: 110px;
  padding: 0;
  border: 0;
  background: none;
  resize: none;
  font: inherit;
  font-size: 15px;
  color: #000;
  &::placeholder {
    color: #b3b3b8;
  }
  &:focus {
    outline: none;
  }
}
.note__foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}
.note__camera {
  padding: 0;
  border: 0;
  background: none;
  color: #8e8e93;
}
.note__cover {
  position: relative;
  img {
    width: 64px;
    height: 48px;
    border-radius: 6px;
    object-fit: cover;
  }
  button {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 2px solid #fff;
    border-radius: 50%;
    background: #3c3c43;
    color: #fff;
  }
}
.note__count {
  font-size: 10px;
  color: #b3b3b8;
}
</style>
