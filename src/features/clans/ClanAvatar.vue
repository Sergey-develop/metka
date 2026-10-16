<script setup lang="ts">
/** Clan picture: the uploaded avatar, or the clan tag on black when there is none. */
withDefaults(defineProps<{ url: string | null; tag: string; size?: number }>(), { size: 40 })
</script>

<template>
  <span class="clan-avatar" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.3)}px` }">
    <img v-if="url" :src="url" alt="" loading="lazy" decoding="async" />
    <span v-else aria-hidden="true">{{ tag }}</span>
  </span>
</template>

<style scoped lang="scss">
.clan-avatar {
  flex: none;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: #000;
  color: #fff;
  font-weight: 700;
  letter-spacing: 0.02em;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
