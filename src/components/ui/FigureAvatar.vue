<script setup lang="ts">
import { computed } from 'vue'
import FigureIcon from './FigureIcon.vue'
import { FIGURE_TONES, type FigureKey } from './figures'

/** Preset avatar: a brand pictogram on its tile, clipped by the parent's shape. */
const props = withDefaults(defineProps<{ figure: FigureKey; size?: number }>(), { size: 40 })
const tone = computed(() => FIGURE_TONES[props.figure])
</script>

<template>
  <span class="figure-avatar" :style="{ background: tone.bg, color: tone.fg }">
    <FigureIcon :figure="figure" :size="Math.round(size * 0.62)" />
  </span>
</template>

<style scoped lang="scss">
.figure-avatar {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}
</style>
