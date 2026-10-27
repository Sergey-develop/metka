<script lang="ts">
export type ChipTone = 'sport' | 'culture' | 'kids' | 'free' | 'food' | 'rest'
export type ChipIcon = 'runner' | 'cap' | 'people'
export interface ChipItem {
  id: string
  label: string
  tone: ChipTone
  icon?: ChipIcon
}
</script>

<script setup lang="ts">
import FilledIcon from './FilledIcon.vue'

/**
 * Category chips of the mockups (иветы.png, карта.jpg), scrolling off the right edge.
 * Without `items`: Спорт · Культура · С детьми · Бесплатно, inactive (the map has no categories yet).
 * With `items`: a working single-choice filter (v-model = the chosen id, null — none; a second tap
 * on the chosen chip clears it); `tone` picks one of the four colours.
 */
defineProps<{ items?: ChipItem[]; modelValue?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [id: string | null] }>()

const CATEGORIES: { id: ChipTone; label: string; icon: 'runner' | 'cap' | 'people' | null }[] = [
  { id: 'sport', label: 'Спорт', icon: 'runner' },
  { id: 'culture', label: 'Культура', icon: 'cap' },
  { id: 'kids', label: 'С детьми', icon: 'people' },
  { id: 'free', label: 'Бесплатно', icon: null },
]
</script>

<template>
  <div v-if="items" class="cats" role="group" aria-label="Категории">
    <button
      v-for="c in items"
      :key="c.id"
      type="button"
      class="cat"
      :class="[`cat--${c.tone}`, { 'cat--off': modelValue && modelValue !== c.id }]"
      :aria-pressed="modelValue === c.id"
      @click="emit('update:modelValue', modelValue === c.id ? null : c.id)"
    >
      <FilledIcon v-if="c.icon === 'runner'" name="runner" :size="18" />
      <svg v-else-if="c.icon === 'cap'" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M11.5 4.2a1.2 1.2 0 0 1 1 0l9 4.2a.7.7 0 0 1 0 1.2l-9 4.3a1.2 1.2 0 0 1-1 0l-9-4.3a.7.7 0 0 1 0-1.2l9-4.2ZM6 12.6l5.5 2.6a1.2 1.2 0 0 0 1 0l5.5-2.6v3.6c0 1.6-2.7 3.3-6 3.3s-6-1.7-6-3.3v-3.6Z" />
      </svg>
      <svg v-else-if="c.icon === 'people'" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm7.5 2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6ZM9 13c3.6 0 6 1.7 6 4v1.2c0 .5-.4.8-.8.8H3.8a.8.8 0 0 1-.8-.8V17c0-2.3 2.4-4 6-4Zm7.5.4c2.6.1 4.5 1.4 4.5 3.3v1.5c0 .4-.4.8-.8.8H16.6c.2-.3.4-.6.4-1V17c0-1.4-.5-2.6-1.5-3.6h1Z" />
      </svg>
      {{ c.label }}
    </button>
  </div>
  <div v-else class="cats" role="group" aria-label="Категории">
    <button v-for="c in CATEGORIES" :key="c.id" class="cat" :class="`cat--${c.id}`" disabled>
      <FilledIcon v-if="c.icon === 'runner'" name="runner" :size="18" />
      <svg v-else-if="c.icon === 'cap'" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M11.5 4.2a1.2 1.2 0 0 1 1 0l9 4.2a.7.7 0 0 1 0 1.2l-9 4.3a1.2 1.2 0 0 1-1 0l-9-4.3a.7.7 0 0 1 0-1.2l9-4.2ZM6 12.6l5.5 2.6a1.2 1.2 0 0 0 1 0l5.5-2.6v3.6c0 1.6-2.7 3.3-6 3.3s-6-1.7-6-3.3v-3.6Z" />
      </svg>
      <svg v-else-if="c.icon === 'people'" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm7.5 2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6ZM9 13c3.6 0 6 1.7 6 4v1.2c0 .5-.4.8-.8.8H3.8a.8.8 0 0 1-.8-.8V17c0-2.3 2.4-4 6-4Zm7.5.4c2.6.1 4.5 1.4 4.5 3.3v1.5c0 .4-.4.8-.8.8H16.6c.2-.3.4-.6.4-1V17c0-1.4-.5-2.6-1.5-3.6h1Z" />
      </svg>
      {{ c.label }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.cats {
  display: flex;
  gap: 5px;
  // runs off the right edge of the page, as in the mockups
  margin-right: -16px;
  padding-right: 16px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
.cat {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 100px;
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  transition:
    opacity 0.2s var(--ease),
    transform 0.15s var(--ease);
  &:disabled {
    opacity: 1;
  }
  &:active:not(:disabled) {
    transform: scale(0.96);
  }
  // another chip is chosen
  &--off {
    opacity: 0.45;
  }
  &[aria-pressed='true'] {
    box-shadow: inset 0 0 0 2px rgb(0 0 0 / 18%);
  }
  &--sport {
    background: #0189ff;
    color: #fff;
  }
  &--culture {
    background: #f9b7fd;
    color: #2a1630;
  }
  &--kids {
    background: #fdf0cf;
    color: #2b2410;
  }
  &--free {
    background: #fdcfcd;
    color: #301312;
  }
  &--food {
    background: #ffe27e;
    color: #2b2410;
  }
  &--rest {
    background: #c9f0dc;
    color: #0f2a1c;
  }
}
</style>
