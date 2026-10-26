<script setup lang="ts">
import { computed } from 'vue'
import type { AvatarKey } from '@/types/game'
import FigureAvatar from './FigureAvatar.vue'

/**
 * A player's round avatar: the uploaded photo, else the preset figure, else the first letter(s) of the name.
 * The parent sizes and colours it through its class (width, height, background, colour, border).
 */
const props = withDefaults(
  defineProps<{ url: string | null; figure: AvatarKey | null; name: string; size: number; letters?: 1 | 2 }>(),
  { letters: 1 },
)

const initials = computed(() => {
  const parts = props.name.split(/[_\s]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  if (props.letters === 1) return first.toUpperCase()
  return (first + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase()
})
</script>

<template>
  <span class="avatar" :style="{ width: `${size}px`, height: `${size}px` }">
    <img v-if="url" :src="url" alt="" />
    <FigureAvatar v-else-if="figure" :figure="figure" :size="size" />
    <span v-else aria-hidden="true">{{ initials }}</span>
  </span>
</template>

<style scoped lang="scss">
.avatar {
  flex: none;
  overflow: hidden;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e0eefc;
  color: #0189ff;
  font-weight: 700;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
