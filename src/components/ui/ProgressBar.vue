<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ value: number; max: number; label?: string }>()
const ratio = computed(() => (props.max > 0 ? Math.min(1, Math.max(0, props.value / props.max)) : 0))
</script>

<template>
  <div
    class="progress"
    role="progressbar"
    :aria-valuenow="value"
    :aria-valuemin="0"
    :aria-valuemax="max"
    :aria-label="label"
  >
    <div class="progress__fill" :style="{ transform: `scaleX(${ratio})` }" />
  </div>
</template>

<style scoped lang="scss">
.progress {
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--c-surface-2);
  overflow: hidden;
}
.progress__fill {
  height: 100%;
  background: var(--c-accent);
  border-radius: inherit;
  transform-origin: left;
  transition: transform 0.4s var(--ease);
}
</style>
