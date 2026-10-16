<script setup lang="ts">
import { ICON_PATHS as PATHS, type IconName } from './icons'

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 22 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>
