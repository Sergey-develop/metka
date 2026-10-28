<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { GeoFix } from '@/services/geolocation/types'
import type { MapBuilding, Rarity } from '@/types/game'
import { allowedScanDistance, distanceMeters, formatDistance } from '@/utils/geo'

const props = defineProps<{ building: MapBuilding; position: GeoFix | null }>()
defineEmits<{ close: []; scan: []; memory: [] }>()

const RARITY: Record<Rarity, string> = { common: 'Обычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное' }

const distance = computed(() => (props.position ? distanceMeters(props.position, props.building) : null))
const inRange = computed(
  () =>
    props.position !== null &&
    distance.value !== null &&
    distance.value <= allowedScanDistance(props.building.scanRadiusM, props.position.accuracyM),
)
const status = computed(() => {
  if (props.building.discoveredAt) return { text: 'Открыто', cls: 'success' }
  if (!props.position) return { text: 'Местоположение неизвестно', cls: 'muted' }
  return inRange.value ? { text: 'Можно сканировать', cls: 'accent' } : { text: 'Подойдите ближе', cls: 'muted' }
})
</script>

<template>
  <article class="sheet card" aria-live="polite">
    <header class="sheet__head">
      <div>
        <p class="sheet__rarity" :class="`r-${building.rarity}`">{{ RARITY[building.rarity] }}</p>
        <h2 class="sheet__title">{{ building.name }}</h2>
      </div>
      <button class="sheet__close" aria-label="Закрыть" @click="$emit('close')"><AppIcon name="close" :size="16" /></button>
    </header>
    <p v-if="building.description" class="sheet__desc">{{ building.description }}</p>
    <dl class="sheet__facts">
      <div>
        <dt>Расстояние</dt>
        <dd>{{ distance === null ? '—' : formatDistance(distance) }}</dd>
      </div>
      <div>
        <dt>Радиус</dt>
        <dd>{{ building.scanRadiusM }} м</dd>
      </div>
      <div>
        <dt>Награда</dt>
        <dd>+{{ building.reward.xp }} XP · {{ building.reward.coins }} ◎</dd>
      </div>
    </dl>
    <p class="sheet__status" :class="`s-${status.cls}`">{{ status.text }}</p>
    <p v-if="building.isDevSeed" class="notice notice--warning sheet__dev">Тестовые данные: координаты приблизительные.</p>
    <AppButton v-if="building.discoveredAt" block variant="secondary" @click="$emit('memory')">
      Воспоминание
    </AppButton>
    <AppButton v-if="!building.discoveredAt" block @click="$emit('scan')">
      <AppIcon name="camera" :size="18" /> Сканировать
    </AppButton>
  </article>
</template>

<style scoped lang="scss">
.sheet {
  padding: 18px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: rise 0.25s var(--ease);
}
.sheet__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.sheet__rarity {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--c-text-2);
  &.r-rare {
    color: var(--c-accent);
  }
  &.r-epic {
    color: #8b5cf6;
  }
  &.r-legendary {
    color: #d6409f;
  }
}
.sheet__title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.sheet__close {
  flex: none;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 10px;
  background: var(--c-surface-2);
  display: grid;
  place-items: center;
}
.sheet__desc {
  color: var(--c-text-2);
  font-size: 14px;
}
.sheet__facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 0;
  dt {
    font-size: 11px;
    color: var(--c-text-3);
  }
  dd {
    margin: 2px 0 0;
    font-weight: 600;
    font-size: 14px;
  }
}
.sheet__status {
  font-size: 14px;
  font-weight: 600;
  &.s-success {
    color: var(--c-success);
  }
  &.s-accent {
    color: var(--c-accent);
  }
  &.s-muted {
    color: var(--c-text-2);
  }
}
.sheet__dev {
  font-size: 12px;
  padding: 8px 12px;
}
@keyframes rise {
  from {
    transform: translateY(16px);
    opacity: 0;
  }
}
</style>
