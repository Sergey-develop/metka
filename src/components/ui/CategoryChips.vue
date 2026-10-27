<script lang="ts">
/** the place tags (mockup Теги.png, 2026-10-28) and, without icons, the event types (иветы.png) */
export type ChipTone = 'fun' | 'nature' | 'history' | 'sport' | 'food' | 'hotel' | 'culture' | 'kids' | 'free'
export interface ChipItem {
  id: string
  label: string
  tone: ChipTone
  /** draw the tag's icon (the place tags have one) */
  icon?: boolean
}
</script>

<script setup lang="ts">
import FilledIcon from './FilledIcon.vue'

/**
 * Category chips (mockups Теги.png, карта.jpg), scrolling off the right edge: a single-choice filter
 * (v-model = the chosen id, null — none; a second tap on the chosen chip clears it).
 */
defineProps<{ items: ChipItem[]; modelValue?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [id: string | null] }>()

/** 24×24 icons drawn after the mockup; sport uses the runner of the tab bar */
const ICON: Partial<Record<ChipTone, string>> = {
  // a ticket
  fun: 'M3.6 8.3 15.8 3.9a1 1 0 0 1 1.3.6l.8 2.2a2 2 0 0 0-1.3 2.6 2 2 0 0 0 2.5 1.2l.8 2.2a1 1 0 0 1-.6 1.3L7.1 18.4a1 1 0 0 1-1.3-.6L5 15.6a2 2 0 0 0 1.3-2.6 2 2 0 0 0-2.5-1.2L3 9.6a1 1 0 0 1 .6-1.3Zm6.2 1.6-.8.3.4 1-1 .3.3.8 1-.3.3 1 .8-.3-.3-1 1-.4-.3-.8-1 .4-.4-1Zm3 .8.7 2 .9-.3-.7-2-.9.3ZM21 19H7l13-4.7V18a1 1 0 0 1-1 1Z',
  // a tree
  nature: 'M12 2a5 5 0 0 1 4.9 4.1A4.5 4.5 0 0 1 16.5 15H13v5h2.5v2h-7v-2H11v-5H7.5a4.5 4.5 0 0 1-.4-8.9A5 5 0 0 1 12 2Z',
  // a museum
  history: 'M12 2 2.5 6.8V9h19V6.8L12 2ZM4.5 10.5v7h2.5v-7H4.5Zm4.7 0v7h2.5v-7H9.2Zm3.1 0v7h2.5v-7h-2.5Zm4.7 0v7h2.5v-7H17ZM2.5 19v2.5h19V19h-19Z',
  // a fork and a knife
  food: 'M6.5 2v6.5a2.5 2.5 0 0 0 2 2.45V22h2V10.95a2.5 2.5 0 0 0 2-2.45V2H11v5.5h-1V2H9v5.5H8V2H6.5Zm10 0C14.6 2 13.5 4.3 13.5 7.5V13H16v9h2V2h-1.5Z',
  // a hotel building
  hotel: 'M4.5 2h15v20h-5.5v-4h-4v4H4.5V2Zm3 3v2.5H10V5H7.5Zm6.5 0v2.5h2.5V5H14ZM7.5 9.5V12H10V9.5H7.5Zm6.5 0V12h2.5V9.5H14ZM7.5 14v2.5H10V14H7.5Zm6.5 0v2.5h2.5V14H14Z',
}
</script>

<template>
  <div class="cats" role="group" aria-label="Категории">
    <button
      v-for="c in items"
      :key="c.id"
      type="button"
      class="cat"
      :class="[`cat--${c.tone}`, { 'cat--off': modelValue && modelValue !== c.id }]"
      :aria-pressed="modelValue === c.id"
      @click="emit('update:modelValue', modelValue === c.id ? null : c.id)"
    >
      <template v-if="c.icon">
        <FilledIcon v-if="c.tone === 'sport'" name="runner" :size="18" />
        <svg v-else-if="ICON[c.tone]" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" :d="ICON[c.tone]" /></svg>
      </template>
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
  &:active {
    transform: scale(0.96);
  }
  // another chip is chosen
  &--off {
    opacity: 0.45;
  }
  &[aria-pressed='true'] {
    box-shadow: inset 0 0 0 2px rgb(0 0 0 / 18%);
  }
  // colours sampled from Теги.png; the same as the kind badges on the place cards
  &--fun {
    background: #f9b7fd;
    color: #000;
  }
  &--nature {
    background: #c5df4f;
    color: #000;
  }
  &--history {
    background: #ffe27e;
    color: #000;
  }
  &--sport {
    background: #0189ff;
    color: #fff;
  }
  &--food {
    background: #ff9447;
    color: #fff;
  }
  &--hotel {
    background: #8d5ec8;
    color: #fff;
  }
  // event types
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
}
</style>
