<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { MapBuilding, Rarity } from '@/types/game'

const props = defineProps<{
  places: MapBuilding[]
  photo: (b: MapBuilding) => string | null
  isFavorite: (b: MapBuilding) => boolean
  favBusy: string | null
  /** a tag of its own instead of the rarity (Zavidovo places show their category) */
  tagOf?: (b: MapBuilding) => string | null
}>()
/** `seen`: the card was swiped away; the parent drops it from `places` */
const emit = defineEmits<{ open: [b: MapBuilding]; favorite: [b: MapBuilding]; seen: [b: MapBuilding] }>()

// buildings_in_bbox has no category yet: the tag shows the rarity, coloured like on the location page
const RARITY: Record<Rarity, string> = { common: 'Обычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное' }
/** how far a card must be dragged to count as a swipe */
const THRESHOLD = 90
const TAP = 6

const current = computed(() => props.places[0] ?? null)
const upcoming = computed(() => props.places[1] ?? null)

const dx = ref(0)
const dragging = ref(false)
const leaving = ref<-1 | 1 | 0>(0)
let startX = 0
let pointerId: number | null = null

/** what letting go would do: shown on the card while it is dragged, fully lit once past the threshold */
const hint = computed(() => {
  const x = leaving.value ? leaving.value * THRESHOLD : dx.value
  if (Math.abs(x) < TAP) return null
  return { dir: x > 0 ? ('go' as const) : ('skip' as const), strength: Math.min(1, Math.abs(x) / THRESHOLD) }
})

const cardStyle = computed(() => {
  const x = leaving.value ? leaving.value * 600 : dx.value
  return { transform: `translateX(${x}px) rotate(${x / 18}deg)` }
})

function onDown(e: PointerEvent): void {
  if (leaving.value) return
  pointerId = e.pointerId
  startX = e.clientX
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onMove(e: PointerEvent): void {
  if (dragging.value && e.pointerId === pointerId) dx.value = e.clientX - startX
}
function onUp(e: PointerEvent): void {
  if (!dragging.value || e.pointerId !== pointerId) return
  dragging.value = false
  pointerId = null
  const b = current.value
  if (!b) return
  if (Math.abs(dx.value) < TAP) {
    dx.value = 0
    emit('open', b)
  } else if (Math.abs(dx.value) >= THRESHOLD) swipe(dx.value > 0 ? 1 : -1)
  else dx.value = 0
}

/** left: skip; right: "want to go" — opens the place page */
function swipe(dir: -1 | 1): void {
  const b = current.value
  if (!b || leaving.value) return
  leaving.value = dir
  window.setTimeout(() => {
    leaving.value = 0
    dx.value = 0
    emit('seen', b)
    if (dir === 1) emit('open', b)
  }, 220)
}
</script>

<template>
  <div class="deck">
    <article v-if="upcoming" :key="upcoming.id" class="card card--under" aria-hidden="true">
      <img v-if="photo(upcoming)" :src="photo(upcoming)!" alt="" />
    </article>
    <article
      v-if="current"
      :key="current.id"
      class="card"
      :class="{ 'card--drag': dragging }"
      :style="cardStyle"
      tabindex="0"
      role="group"
      :aria-label="`${current.name}. Вправо — хочу сходить, влево — дальше`"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown.left.prevent="swipe(-1)"
      @keydown.right.prevent="swipe(1)"
      @keydown.enter="emit('open', current)"
    >
      <img v-if="photo(current)" :src="photo(current)!" alt="" draggable="false" />
      <div class="card__shade" aria-hidden="true" />
      <div
        v-if="hint"
        class="card__hint"
        :class="[`card__hint--${hint.dir}`, { ready: hint.strength === 1 }]"
        :style="{ opacity: hint.strength }"
        aria-hidden="true"
      >
        <span class="card__stamp">
          <template v-if="hint.dir === 'go'">Хочу сходить<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12h15m-5-5 5 5-5 5" /></svg></template>
          <template v-else><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12h-15m5-5-5 5 5 5" /></svg>Дальше</template>
        </span>
      </div>
      <span v-if="tagOf?.(current)" class="card__tag card__tag--own">{{ tagOf(current) }}</span>
      <span v-else class="card__tag" :class="`r-${current.rarity}`">{{ RARITY[current.rarity] }}</span>
      <button
        v-if="current.discoveredAt"
        class="card__fav"
        :class="{ on: isFavorite(current) }"
        :aria-pressed="isFavorite(current)"
        :aria-label="isFavorite(current) ? 'Убрать из избранного' : 'В избранное'"
        :disabled="favBusy === current.id"
        @pointerdown.stop
        @pointerup.stop
        @click="emit('favorite', current)"
      >
        <AppIcon name="heart" :size="22" />
      </button>
      <div class="card__text">
        <h2>{{ current.name }}</h2>
        <p v-if="current.description">{{ current.description }}</p>
      </div>
    </article>
  </div>
</template>

<style scoped lang="scss">
// measured on the 390pt mockup (свайп2.png, 3x)
.deck {
  position: relative;
  // from below the mode switch down to the tab bar
  height: max(360px, calc(100dvh - var(--safe-top) - 156px - var(--nav-height) - var(--safe-bottom)));
}
.card {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  overflow: hidden;
  background: #d5d1d1;
  touch-action: pan-y;
  user-select: none;
  cursor: grab;
  transition: transform 0.22s ease-out;
  &--drag {
    transition: none;
    cursor: grabbing;
  }
  &--under {
    transform: scale(0.95);
    transition: none;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
}
.card__shade {
  position: absolute;
  inset: 45% 0 0;
  background: linear-gradient(180deg, rgb(0 0 0 / 0%), rgb(0 0 0 / 55%));
}
.card__hint {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  &--go {
    background: rgb(1 137 255 / 35%);
  }
  &--skip {
    background: rgb(0 0 0 / 35%);
  }
}
.card__stamp {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 999px;
  font-size: 17px;
  font-weight: 600;
  transition: transform 0.15s ease-out;
  .card__hint--go & {
    background: #0189ff;
    color: #fff;
  }
  .card__hint--skip & {
    background: #fff;
    color: #000;
  }
  .ready & {
    transform: scale(1.08);
  }
}
.card__tag {
  position: absolute;
  top: 16px;
  left: 16px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 15px;
  color: #000;
  background: #ffe27e;
  &.r-common {
    background: #ebebeb;
  }
  &.r-rare {
    background: #cfe6ff;
  }
  &.r-epic {
    background: #f9b7fd;
  }
  &--own {
    background: #c9f0dc;
  }
}
.card__fav {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #c7c7cc;
  &.on {
    color: #ff3b6b;
    :deep(path) {
      fill: currentColor;
    }
  }
}
.card__text {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  color: #fff;
  h2 {
    font-size: 20px;
    font-weight: 600;
    line-height: 22px;
  }
  p {
    margin-top: 4px;
    font-size: 13px;
    line-height: 16px;
    color: rgb(255 255 255 / 70%);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
