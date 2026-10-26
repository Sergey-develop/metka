<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    loading?: boolean
    disabled?: boolean
    block?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'primary', loading: false, disabled: false, block: false, type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[`btn--${variant}`, { 'btn--block': block, 'btn--loading': loading }]"
    :disabled="disabled || loading"
    :aria-busy="loading"
  >
    <span v-if="loading" class="btn__spinner" aria-hidden="true" />
    <span class="btn__label"><slot /></span>
  </button>
</template>

<style scoped lang="scss">
.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  // as in the mockups: saturated blue, 50pt high, slightly rounded (theme: --c-button, --r-button)
  height: 50px;
  padding: 0 22px;
  border: 0;
  border-radius: var(--r-button);
  font-weight: 500;
  font-size: 17px;
  transition: transform 0.12s var(--ease), opacity 0.15s var(--ease), background 0.15s var(--ease);

  &:active:not(:disabled) {
    transform: scale(0.97);
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
  &--block {
    width: 100%;
  }
  &--primary {
    background: var(--c-button);
    color: #fff;
  }
  &--secondary {
    background: var(--c-button-soft);
    color: #000;
  }
  &--ghost {
    background: transparent;
    color: var(--c-accent);
  }
  &--danger {
    background: var(--c-danger-soft);
    color: var(--c-danger);
  }
  &--loading .btn__label {
    opacity: 0.7;
  }
}

.btn__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
