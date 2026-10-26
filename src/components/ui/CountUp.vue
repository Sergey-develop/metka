<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * A number that counts up to its value (ease-out) when it appears or changes, e.g. stats arriving
 * from the server. `format` turns the running value into text (the same formatter as the final one,
 * so the width barely changes). Reduced motion: the value is shown at once.
 */
const props = withDefaults(defineProps<{ value: number; format?: (n: number) => string; duration?: number }>(), {
  format: (n: number) => Math.round(n).toLocaleString('ru-RU'),
  duration: 700,
})

const shown = ref(0)
let frame = 0

function stop(): void {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}

function run(from: number, to: number): void {
  stop()
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || from === to || typeof requestAnimationFrame !== 'function') {
    shown.value = to
    return
  }
  const start = performance.now()
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / props.duration)
    const eased = 1 - Math.pow(1 - t, 3)
    shown.value = t < 1 ? from + (to - from) * eased : to
    frame = t < 1 ? requestAnimationFrame(step) : 0
  }
  frame = requestAnimationFrame(step)
}

onMounted(() => run(0, props.value))
watch(
  () => props.value,
  (to) => run(shown.value, to),
)
onBeforeUnmount(stop)
</script>

<template>
  <span>{{ format(shown) }}</span>
</template>
