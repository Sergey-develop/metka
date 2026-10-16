<script setup lang="ts">
import logo from '@/assets/brand/logo.png'
import FigureLoader from './FigureLoader.vue'
</script>

<template>
  <div class="splash" role="status" aria-label="Загрузка «Метки»">
    <div class="splash__center">
      <img :src="logo" alt="метка" class="splash__logo" width="697" height="116" />
      <FigureLoader class="splash__loader" :size="40" tiles aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.splash {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: var(--c-accent);
}
// the logo stays exactly centred; the figures hang below it
.splash__center {
  position: relative;
}
.splash__loader {
  position: absolute;
  top: calc(100% + 40px);
  left: 50%;
  transform: translateX(-50%);
}
.splash__logo {
  display: block;
  width: min(78vw, 360px);
  height: auto;
}
</style>
