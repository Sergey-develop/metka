<script setup lang="ts">
/** Game coin (gold, with the Метка pin), as drawn in the mockups. */
withDefaults(defineProps<{ size?: number }>(), { size: 22 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="#feb210" />
    <circle cx="12" cy="12" r="8.4" fill="#ffc83d" stroke="#f29e00" stroke-width="1" />
    <path fill="#f29e00" d="M12 6.5a3.6 3.6 0 0 0-3.6 3.6c0 2.6 3 5.6 3.2 5.8a.6.6 0 0 0 .8 0c.2-.2 3.2-3.2 3.2-5.8A3.6 3.6 0 0 0 12 6.5Zm0 2.3a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z" />
  </svg>
</template>
