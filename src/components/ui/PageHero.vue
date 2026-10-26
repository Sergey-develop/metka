<script setup lang="ts">
import AppIcon from './AppIcon.vue'

/**
 * The coloured header of the sheet-like pages — clan (клан.png), tasks (задания.png), diary
 * (дневник.png): background, «Назад», an optional title and an optional right button (slot `right`).
 * Used by the page itself and, behind its sheet, by the sheet that expands into it (the header
 * appears there as the sheet is dragged up), so both are the same pixels.
 *   tone   — sky: gradient standing in for the mockups' illustrations (none without the status bar yet);
 *            blue: the tasks page's solid blue.
 *   height — px below the safe area; rowY — where the buttons and the title are centred.
 */
withDefaults(defineProps<{ tone: 'sky' | 'blue'; height: number; rowY: number; title?: string; backLabel?: string }>(), {
  title: undefined,
  backLabel: 'Назад',
})
defineEmits<{ back: [] }>()
</script>

<template>
  <header class="hero" :class="`hero--${tone}`" :style="{ height: `calc(var(--safe-top) + ${height}px)`, '--row': `${rowY}px` }">
    <button class="hero__btn hero__btn--left" :aria-label="backLabel" @click="$emit('back')"><AppIcon name="back" /></button>
    <h1 v-if="title" class="hero__title">{{ title }}</h1>
    <span v-if="$slots.right" class="hero__right"><slot name="right" /></span>
  </header>
</template>

<style scoped lang="scss">
.hero {
  position: relative;
  color: #fff;
}
.hero--sky {
  background: linear-gradient(180deg, #49a8ff 0%, #8ccaff 58%, #cfe8ff 100%);
}
.hero--blue {
  background: #0189ff;
}
.hero__btn,
.hero__right {
  position: absolute;
  top: calc(var(--safe-top) + var(--row));
  transform: translateY(-50%);
}
.hero__btn {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 50%;
  color: #fff;
}
.hero--sky .hero__btn,
.hero__right :deep(button) {
  border: 1px solid rgb(255 255 255 / 45%);
  background: rgb(255 255 255 / 30%);
  backdrop-filter: blur(8px);
}
.hero--blue .hero__btn {
  border: 0;
  background: rgb(255 255 255 / 25%);
}
.hero__btn--left {
  left: 16px;
}
.hero__right {
  right: 16px;
  :deep(button) {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 50%;
    color: #fff;
  }
}
.hero__title {
  position: absolute;
  left: 64px;
  right: 64px;
  top: calc(var(--safe-top) + var(--row));
  transform: translateY(-50%);
  font-size: 21px;
  font-weight: 600;
  text-align: center;
}
.hero--sky .hero__title {
  text-shadow: 0 1px 8px rgb(0 0 0 / 15%);
}
</style>
