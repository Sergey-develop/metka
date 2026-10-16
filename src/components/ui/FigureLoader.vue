<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FigureIcon from './FigureIcon.vue'
import { FIGURE_KEYS, type FigureKey } from './figures'

/**
 * Brand loader: the runner, scooter, skater and cyclist take turns. Colour follows `currentColor`.
 * `tiles` puts each figure in a pill whose colour changes with the figure (splash screen).
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
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  timer = setInterval(() => (index.value = (index.value + 1) % FIGURE_KEYS.length), reduced ? 1200 : 480)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="loader" role="status" :aria-label="label">
    <span v-if="tiles" class="loader__tile" :style="{ background: tile.bg, color: tile.ink }">
      <FigureIcon :figure="figure" :size="size" />
    </span>
    <FigureIcon v-else :figure="figure" :size="size" />
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
    background-color 0.2s var(--ease),
    color 0.2s var(--ease);
}
</style>
