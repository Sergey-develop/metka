<script setup lang="ts">
import type { Impression } from '@/types/game'

/** Album stickers: blue = liked, pink = wow, black-and-white = meh, heart = favourite place. */
defineProps<{ impression: Impression | null; favorite?: boolean; size?: number }>()

const LABEL: Record<Impression, string> = { liked: 'Понравилось', wow: 'Вау', meh: 'Не впечатлило' }
</script>

<template>
  <span class="stickers">
    <span
      v-if="impression"
      class="sticker"
      :class="`sticker--${impression}`"
      :style="size ? { width: `${size}px`, height: `${size}px` } : undefined"
      role="img"
      :aria-label="LABEL[impression]"
    />
    <span v-if="favorite" class="sticker sticker--heart" role="img" aria-label="Любимое место">♥</span>
  </span>
</template>

<style scoped lang="scss">
.stickers {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.sticker {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgb(0 0 0 / 15%);
  &--liked {
    background: #4db1fa;
  }
  &--wow {
    background: #ff94de;
  }
  &--meh {
    background: linear-gradient(135deg, #111 50%, #e6e6e6 50%);
  }
  &--heart {
    display: grid;
    place-items: center;
    background: #fff;
    color: #ff4f7b;
    font-size: 13px;
    line-height: 1;
  }
}
</style>
