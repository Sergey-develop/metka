<script setup lang="ts">
import { FILLED_ICON_PATHS, type FilledIconName } from './icons'

withDefaults(defineProps<{ name: FilledIconName; size?: number }>(), { size: 22 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path :d="FILLED_ICON_PATHS[name]" />
  </svg>
</template>
