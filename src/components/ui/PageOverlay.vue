<script setup lang="ts">
/**
 * A page lying over its parent page (child routes): the map or the locations list stays mounted, scrolled
 * and as it was under it, and shows through when the page is swiped away (useSwipeBack). The page scrolls
 * by itself; a new path is a new page, opened at its top.
 */
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="over">
      <div v-if="Component" :key="route.path" class="page-over">
        <component :is="Component" />
      </div>
    </Transition>
  </RouterView>
</template>

<style scoped lang="scss">
// full screen, its own scroll; transparent itself, so the parent shows through where the page is swiped
// away. Under the tab bar (z 20) like every page
.page-over {
  position: fixed;
  inset: 0;
  z-index: 15;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  > :deep(main) {
    min-height: 100%;
  }
}
// opened: slides in from the right like an iOS page; closed by the back button: slides out
.over-enter-active {
  transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.over-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 1, 1);
}
.over-enter-from,
.over-leave-to {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .over-enter-active,
  .over-leave-active {
    transition-duration: 0.01s;
  }
}
</style>
