<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FigureIcon from './FigureIcon.vue'
import { FIGURE_KEYS, type FigureKey } from './figures'

/**
 * Brand loader: the runner, scooter, skater and cyclist take turns. Colour follows `currentColor`.
 * `tiles` puts each figure in a pill whose colour changes with the figure (splash screen).
 * Figures travel the way they face: the old one rides out to the right, the next one rides in from the left.
 */
withDefaults(defineProps<{ size?: number; label?: string; tiles?: boolean }>(), {
  size: 44,
  label: 'Загрузка',
  tiles: false,
})

// brand palette: each figure has its own tile and ink colour
const TILE_COLORS: Record<FigureKey, { bg: string; ink: string }> = {
  runner: { bg: '#0540f2', ink: '#ffffff' },
  scooter: { bg: '#000000', ink: '#ffffff' },
  skater: { bg: '#f4f4f4', ink: '#000000' },
  cyclist: { bg: '#d0fdb0', ink: '#000000' },
}

const index = ref(0)
const figure = computed(() => FIGURE_KEYS[index.value % FIGURE_KEYS.length] ?? 'runner')
const tile = computed(() => TILE_COLORS[figure.value])
const tileEl = ref<HTMLElement>()
let reduced = false
let timer: ReturnType<typeof setInterval> | undefined

// a soft squash on every swap, as if the pill absorbed the new rider
watch(figure, () => {
  if (reduced || typeof tileEl.value?.animate !== 'function') return
  tileEl.value.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(0.94, 0.9)', offset: 0.35 }, { transform: 'scale(1)' }],
    { duration: 420, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
  )
})

onMounted(() => {
  reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  timer = setInterval(() => (index.value = (index.value + 1) % FIGURE_KEYS.length), reduced ? 1200 : 480)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="loader" role="status" :aria-label="label">
    <span
      v-if="tiles"
      ref="tileEl"
      class="loader__tile"
      :style="{ background: tile.bg, color: tile.ink }"
    >
      <span class="loader__stage">
        <Transition name="ride">
          <FigureIcon :key="figure" class="loader__figure" :figure="figure" :size="size" />
        </Transition>
      </span>
    </span>
    <span v-else class="loader__stage">
      <Transition name="ride">
        <FigureIcon :key="figure" class="loader__figure" :figure="figure" :size="size" />
      </Transition>
    </span>
  </div>
</template>

<style scoped lang="scss">
.loader {
  display: grid;
  place-items: center;
  color: var(--c-accent);
}
.loader__tile {
  display: grid;
  place-items: center;
  // pill proportions from the brand tile (~2.3 : 1)
  padding: 0.35em 1.4em;
  font-size: 32px;
  border-radius: var(--r-pill);
  transition:
    background-color 0.36s var(--ease),
    color 0.36s var(--ease);
}
// figures are stacked in one cell so the outgoing and incoming ones overlap mid-swap
.loader__stage {
  display: grid;
  place-items: center;
  // soft edges instead of a hard clip as figures ride in and out
  mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent);
}
.loader__figure {
  grid-area: 1 / 1;
}

.ride-enter-active {
  transition:
    transform 0.42s cubic-bezier(0.34, 1.45, 0.5, 1),
    opacity 0.28s ease-out,
    filter 0.3s ease-out;
}
.ride-leave-active {
  transition:
    transform 0.3s cubic-bezier(0.5, 0, 0.75, 0),
    opacity 0.26s ease-in,
    filter 0.26s ease-in;
}
.ride-enter-from {
  opacity: 0;
  transform: translateX(-70%) scale(0.85);
  filter: blur(3px);
}
.ride-leave-to {
  opacity: 0;
  transform: translateX(70%) scale(0.9);
  filter: blur(3px);
}

@media (prefers-reduced-motion: reduce) {
  .ride-enter-active,
  .ride-leave-active {
    transition: opacity 0.3s ease;
  }
  .ride-enter-from,
  .ride-leave-to {
    transform: none;
    filter: none;
  }
}
</style>
