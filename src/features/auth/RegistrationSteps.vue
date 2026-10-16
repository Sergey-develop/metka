<script setup lang="ts">
// Progress through registration: account → confirmation → game profile.
// (Splash and intro come before, permissions are asked later, in context.)
const props = defineProps<{ step: number }>()
const STEPS = ['Аккаунт', 'Подтверждение', 'Профиль'] as const
</script>

<template>
  <nav class="steps" :aria-label="`Регистрация: шаг ${props.step} из ${STEPS.length}`">
    <ol class="steps__bar">
      <li
        v-for="(name, i) in STEPS"
        :key="name"
        class="steps__item"
        :class="{ 'steps__item--done': i + 1 < props.step, 'steps__item--now': i + 1 === props.step }"
        :aria-current="i + 1 === props.step ? 'step' : undefined"
      >
        <span class="visually-hidden">{{ name }}</span>
      </li>
    </ol>
    <p class="steps__label">Шаг {{ props.step }} из {{ STEPS.length }} · {{ STEPS[props.step - 1] }}</p>
  </nav>
</template>

<style scoped lang="scss">
.steps {
  margin-bottom: 18px;
}
.steps__bar {
  display: flex;
  gap: 6px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}
.steps__item {
  flex: 1;
  height: 4px;
  border-radius: var(--r-pill);
  background: var(--c-surface-2);
  transition: background-color 0.3s var(--ease);
  &--done,
  &--now {
    background: var(--c-accent);
  }
}
.steps__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-2);
}
</style>
