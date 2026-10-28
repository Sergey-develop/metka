<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { BuildingOutline } from '@/types/game'

/** Card for a footprint that cannot be scanned: plain geography or a temporarily unavailable game building. */
const props = defineProps<{
  outline: BuildingOutline
  /** admin only: turn this footprint into a published game building */
  canPublish?: boolean
  publishing?: boolean
  publishError?: string | null
}>()
defineEmits<{ close: []; publish: [] }>()

// buildings go by their names only, never by a street address
const title = computed(() => props.outline.game?.name ?? props.outline.name ?? 'Здание')
const status = computed(() =>
  props.outline.game?.status === 'unavailable'
    ? { text: 'Временно недоступно для сканирования', cls: 'muted' }
    : { text: 'Не участвует в игре', cls: 'muted' },
)
</script>

<template>
  <article class="sheet card" aria-live="polite">
    <header class="sheet__head">
      <div>
        <p class="sheet__kind">{{ outline.game ? 'Игровое здание' : 'Здание' }}</p>
        <h2 class="sheet__title">{{ title }}</h2>
      </div>
      <button class="sheet__close" aria-label="Закрыть" @click="$emit('close')"><AppIcon name="close" :size="16" /></button>
    </header>
    <p v-if="outline.game?.description" class="sheet__desc">{{ outline.game.description }}</p>
    <p class="sheet__status" :class="`s-${status.cls}`">{{ status.text }}</p>
    <template v-if="canPublish && !outline.game">
      <AppButton block :disabled="publishing" @click="$emit('publish')">
        {{ publishing ? 'Публикуем…' : 'Сделать игровым' }}
      </AppButton>
      <p v-if="publishError" class="sheet__error" role="alert">{{ publishError }}</p>
    </template>
    <p class="sheet__source">Контур здания: © OpenStreetMap</p>
  </article>
</template>

<style scoped lang="scss">
.sheet {
  padding: 18px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: rise 0.25s var(--ease);
}
.sheet__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.sheet__kind {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--c-text-2);
}
.sheet__title {
  font-size: 20px;
  font-weight: 700;
  margin-top: 2px;
}
.sheet__close {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--c-bg);
  color: var(--c-text-2);
}
.sheet__desc {
  font-size: 14px;
  line-height: 1.45;
}
.sheet__status {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-2);
}
.sheet__error {
  font-size: 13px;
  color: var(--c-danger);
}
.sheet__source {
  font-size: 11px;
  color: var(--c-text-3, var(--c-text-2));
}
</style>
