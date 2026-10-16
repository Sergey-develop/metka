<script setup lang="ts">
import { computed } from 'vue'
import { FIGURES, type FigureKey } from './figures'

const props = withDefaults(defineProps<{ figure: FigureKey; size?: number }>(), { size: 32 })
const shape = computed(() => FIGURES[props.figure])
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" stroke="currentColor" aria-hidden="true">
    <rect :x="shape.head.x + 0.5" :y="shape.head.y + 0.5" width="4" height="4" fill="currentColor" stroke="none" />
    <path :d="shape.body" stroke-width="3" stroke-linejoin="miter" />
    <path v-if="shape.gear" :d="shape.gear" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    <circle v-for="(w, i) in shape.wheels" :key="i" :cx="w.cx" :cy="w.cy" :r="w.r" stroke-width="1.6" />
  </svg>
</template>
