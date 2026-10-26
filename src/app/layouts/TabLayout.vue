<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import BottomNav from '@/components/ui/BottomNav.vue'
import { type PageTransition, transitionFor } from '@/app/pageTransition'
import { services } from '@/app/providers/services'

const mocked = services().mocked

/** chosen per navigation: a sheet hands over to its page, sheet-like pages rise, the rest fade in (pageTransition.ts) */
const transition = ref<PageTransition>('none')
const stopWatching = useRouter().beforeEach((to) => {
  transition.value = transitionFor(to)
})
onBeforeUnmount(stopWatching)

/**
 * Hand-over: the leaving page stays exactly where it is on screen while it fades — pinned at its
 * current scroll (the profile is scrolled; the new page starts at its top), above the new page — and
 * lets touches through, so the new page scrolls at once instead of after the fade.
 */
function pinLeaving(el: Element): void {
  if (transition.value !== 'handoff') return
  const page = el as HTMLElement
  page.style.position = 'fixed'
  page.style.top = `${-window.scrollY}px`
  page.style.left = '0'
  page.style.right = '0'
  page.style.pointerEvents = 'none'
}
</script>

<template>
  <div class="layout">
    <div v-if="mocked" class="dev-badge" role="note">DEV · моки камеры, GPS и распознавания</div>
    <RouterView v-slot="{ Component, route }">
      <Transition :name="transition" :css="transition !== 'none'" @before-leave="pinLeaving">
        <!-- keyed by path: a page opened over itself (my profile → a clanmate's, a place → a nearby
             place) is a new page with its transition, not the old one silently refilled -->
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
    <div class="nav-fade" aria-hidden="true" />
    <BottomNav />
  </div>
</template>

<style scoped lang="scss">
.layout {
  // a column, so a short page still fills the screen (min-height: 100% on the page alone resolves to auto)
  display: flex;
  flex-direction: column;
  min-height: 100%;
  > :deep(main) {
    flex: 1 0 auto;
  }
}
// a sheet expanded into its page: its backdrop already shows the page's header and it stops where the
// page's body starts, so a short cross-fade only blends what differs between the two mockups
$handoff-fade: 0.18s;
.handoff-leave-active {
  transition: opacity $handoff-fade ease;
}
.handoff-leave-to {
  opacity: 0;
}
// sheet-like pages (clan, tasks, diary) rise softly; the previous page goes at once
.rise-enter-active {
  transition:
    transform 0.42s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.28s ease;
}
.rise-enter-from {
  transform: translateY(48px);
  opacity: 0;
}
// every other section: the new page fades in; the previous page goes at once (enter only, so the two
// pages never stack up in the column). Opacity only: a transform would make the page the containing
// block of its position: fixed parts (map header, sheets) for the length of the animation.
.fade-enter-active {
  transition: opacity 0.28s ease;
}
.fade-enter-from {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .handoff-leave-active,
  .rise-enter-active,
  .fade-enter-active {
    transition-duration: 0.01s;
  }
}
.nav-fade {
  // blue wash behind the glass tab bar, sampled from the mockup (rgb 20 148 231 fading in)
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 19;
  height: calc(max(var(--safe-bottom), 20px) + 86px);
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgb(20 148 231 / 0%) 0%,
    rgb(20 148 231 / 10%) 7%,
    rgb(20 148 231 / 24%) 14%,
    rgb(20 148 231 / 35%) 28%,
    rgb(20 148 231 / 44%) 42%,
    rgb(20 148 231 / 59%) 55%,
    rgb(20 148 231 / 72%) 69%,
    rgb(20 148 231 / 85%) 83%,
    rgb(20 148 231 / 97%) 97%,
    rgb(20 148 231) 100%
  );

  // the content under the wash is softly blurred, fading in from the top edge
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    mask-image: linear-gradient(180deg, transparent 0%, #000 30%);
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 30%);
  }
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
