<script setup lang="ts">
import BottomNav from '@/components/ui/BottomNav.vue'
import { services } from '@/app/providers/services'

const mocked = services().mocked
</script>

<template>
  <div class="layout">
    <div v-if="mocked" class="dev-badge" role="note">DEV · моки камеры, GPS и распознавания</div>
    <RouterView />
    <BottomNav />
  </div>
</template>

<style scoped lang="scss">
.layout {
  min-height: 100%;
}
.dev-badge {
  position: fixed;
  top: calc(var(--safe-top) + 4px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  padding: 2px 10px;
  border-radius: var(--r-pill);
  background: var(--c-warning-soft);
  color: #7a4d00;
  font-size: 11px;
  font-weight: 600;
  pointer-events: none;
}
</style>
