<script setup lang="ts">
import { useRoute } from 'vue-router'
import logo from '@/assets/brand/logo.png'
import RegistrationSteps from '@/features/auth/RegistrationSteps.vue'

const route = useRoute()
</script>

<template>
  <main class="auth">
    <header class="auth__brand">
      <img :src="logo" alt="метка" width="697" height="116" />
    </header>
    <section class="auth__sheet">
      <RegistrationSteps v-if="route.meta.step" :step="route.meta.step" />
      <RouterView />
    </section>
  </main>
</template>

<style scoped lang="scss">
.auth {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-accent);
  // mockup typeface is SF Pro: system font on Apple devices, Inter elsewhere (SF Pro can't be bundled)
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', var(--font);
}
.auth__brand {
  flex: 1 0 auto;
  min-height: 200px;
  display: grid;
  place-items: center;
  padding: calc(var(--safe-top) + 32px) 24px 32px;
  img {
    width: min(66vw, 300px);
    height: auto;
  }
}
.auth__sheet {
  flex: none;
  // floating card: inset from the screen edges, all corners rounded
  width: calc(100% - 24px);
  max-width: 560px;
  margin: 0 auto calc(var(--safe-bottom) + 12px);
  padding: 30px 22px 28px;
  background: var(--c-surface);
  border-radius: 32px;
}
</style>
