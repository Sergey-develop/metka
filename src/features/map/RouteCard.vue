<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import FilledIcon from '@/components/ui/FilledIcon.vue'
import type { RoutingErrorCode, WalkingRoute } from '@/services/routing/types'
import type { RouteState } from '@/stores/route'
import type { MapBuilding, Rarity } from '@/types/game'
import { walkRange } from '@/utils/geo'

// mockup «карта с меткой»: the place the player walks to, under the clan and tasks buttons
const props = defineProps<{
  place: MapBuilding
  photo: string | null
  route: WalkingRoute | null
  state: RouteState
  errorCode: RoutingErrorCode | null
  /** location is off or denied: the route cannot start */
  noLocation: boolean
}>()
defineEmits<{ open: []; retry: [] }>()

// buildings_in_bbox has no category yet: the tag shows the rarity, coloured as on the locations pages
const RARITY: Record<Rarity, string> = { common: 'Обычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное' }

const ERRORS: Record<RoutingErrorCode, string> = {
  no_route: 'Пешеходный маршрут не найден',
  too_far: 'Слишком далеко для пешего маршрута',
  network: 'Нет связи с сервером маршрутов',
  unavailable: 'Сервис маршрутов недоступен',
}

const status = computed(() => {
  switch (props.state) {
    case 'ready':
      return props.route ? walkRange(props.route.durationS) : ''
    case 'arrived':
      return 'Вы на месте'
    case 'error':
      return ERRORS[props.errorCode ?? 'unavailable']
    case 'waiting_position':
      return props.noLocation ? 'Включите геолокацию' : 'Ищем вас на карте…'
    default:
      return 'Строим маршрут…'
  }
})
</script>

<template>
  <article
    class="route"
    role="link"
    tabindex="0"
    :aria-label="`${place.name}: подробнее`"
    aria-live="polite"
    @click="$emit('open')"
    @keydown.enter="$emit('open')"
  >
    <div class="route__photo">
      <img v-if="photo" :src="photo" alt="" />
    </div>
    <div class="route__body">
      <span class="route__tag" :class="`r-${place.rarity}`">{{ RARITY[place.rarity] }}</span>
      <h2 class="route__name">{{ place.name }}</h2>
      <p v-if="place.address" class="route__address">{{ place.address }}</p>
      <p class="route__meta" :class="{ 'route__meta--error': state === 'error', 'route__meta--done': state === 'arrived' }">
        <FilledIcon v-if="state === 'ready'" name="runner" :size="16" />
        <span>{{ status }}</span>
        <button v-if="state === 'error'" type="button" class="route__retry" @click.stop="$emit('retry')">Повторить</button>
      </p>
    </div>
    <AppIcon class="route__chev" name="chevron" :size="20" />
  </article>
</template>

<style scoped lang="scss">
// measured on the mockup (@2x): card 358×105, photo 90, padding 8, tag 19 high
.route {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 105px;
  padding: 8px 16px 8px 8px;
  border-radius: 12px;
  background: #fff;
  box-shadow: var(--shadow-card);
  cursor: pointer;
  animation: rise 0.25s var(--ease);
  // swiped away on the map (useSwipeAway): no page scroll under the finger, a smooth way back
  touch-action: none;
  transition:
    transform 0.2s var(--ease),
    opacity 0.2s var(--ease);
}
.route__photo {
  flex: none;
  width: 90px;
  height: 90px;
  border-radius: 6px;
  overflow: hidden;
  background: #eef1f6;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}
.route__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.route__tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 15px;
  color: #000;
  background: #ffe27e;
  &.r-common {
    background: #ebebeb;
  }
  &.r-rare {
    background: #cfe6ff;
  }
  &.r-epic {
    background: #f9b7fd;
  }
}
.route__name {
  margin-top: 4px;
  max-width: 100%;
  font-size: 17px;
  font-weight: 600;
  line-height: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.route__address {
  font-size: 13px;
  line-height: 15px;
  color: #85858c;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.route__meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  line-height: 18px;
  color: #000;
  svg {
    flex: none;
    color: #0189ff;
  }
  &--error {
    color: var(--c-danger);
  }
  &--done {
    color: var(--c-success);
    font-weight: 600;
  }
}
.route__retry {
  margin-left: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: #0189ff;
  font: inherit;
  font-weight: 600;
}
.route__chev {
  flex: none;
  color: #b8b8be;
}
@keyframes rise {
  from {
    transform: translateY(16px);
    opacity: 0;
  }
}
</style>
