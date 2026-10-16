<script setup lang="ts">
import AppButton from './AppButton.vue'
import FigureLoader from './FigureLoader.vue'

defineProps<{
  kind: 'loading' | 'empty' | 'error'
  title?: string
  text?: string
  actionLabel?: string
}>()
defineEmits<{ action: [] }>()
</script>

<template>
  <div class="state" :class="`state--${kind}`" :role="kind === 'error' ? 'alert' : 'status'">
    <FigureLoader v-if="kind === 'loading'" aria-hidden="true" />
    <p v-if="title" class="state__title">{{ title }}</p>
    <p v-if="text" class="state__text">{{ text }}</p>
    <AppButton v-if="actionLabel" variant="secondary" @click="$emit('action')">{{ actionLabel }}</AppButton>
  </div>
</template>

<style scoped lang="scss">
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 24px;
  text-align: center;
}
.state__title {
  font-weight: 600;
  font-size: 17px;
}
.state__text {
  color: var(--c-text-2);
  font-size: 14px;
  max-width: 300px;
}
</style>
