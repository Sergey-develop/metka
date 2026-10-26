<script setup lang="ts">
import AppButton from '@/components/ui/AppButton.vue'
import { useScrollLock } from '@/utils/scrollLock'

// the page behind stays still while this is open
useScrollLock()

/** Bottom sheet of the event wizard's pickers (Страница локации-2/-3): title, picker, «Сбросить» / «Применить». */
defineProps<{ title: string; canReset: boolean }>()
defineEmits<{ close: []; reset: []; apply: [] }>()
</script>

<template>
  <div class="sheet" role="dialog" aria-modal="true" :aria-label="title" @keydown.esc="$emit('close')" @click.self="$emit('close')">
    <div class="sheet__body">
      <span class="sheet__grip" aria-hidden="true" />
      <h2 class="sheet__title">{{ title }}</h2>
      <div class="sheet__card"><slot /></div>
      <div class="sheet__row">
        <AppButton variant="secondary" :disabled="!canReset" @click="$emit('reset')">Сбросить</AppButton>
        <AppButton @click="$emit('apply')">Применить</AppButton>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.sheet {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(17 19 23 / 40%);
}

// <Transition name="sheet"> in the wizard: backdrop fades, the panel slides up from the bottom edge
.sheet-enter-active,
.sheet-leave-active {
  transition: background-color 0.32s var(--ease);
  .sheet__body {
    transition: transform 0.32s var(--ease);
  }
}
.sheet-leave-active {
  transition-duration: 0.24s;
  .sheet__body {
    transition: transform 0.24s cubic-bezier(0.4, 0, 1, 1);
  }
}
.sheet-enter-from,
.sheet-leave-to {
  background-color: rgb(17 19 23 / 0%);
  .sheet__body {
    transform: translateY(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active,
  .sheet-enter-active .sheet__body,
  .sheet-leave-active .sheet__body {
    transition-duration: 0.01s;
  }
}

.sheet__body {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 10px 16px calc(var(--safe-bottom) + 20px);
  border-radius: 24px 24px 0 0;
  background: #f2f2f7;
}
.sheet__grip {
  align-self: center;
  width: 36px;
  height: 5px;
  border-radius: 3px;
  background: #c7c7cc;
}
.sheet__title {
  font-size: 20px;
  font-weight: 600;
  text-align: center;
  color: #000;
}
.sheet__card {
  padding: 12px;
  border-radius: 12px;
  background: #fff;
}
.sheet__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
</style>
