<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import SplashScreen, { SPLASH_MS } from '@/components/ui/SplashScreen.vue'
import AchievementUnlocked from '@/features/profile/AchievementUnlocked.vue'
import { mapCategory } from '@/features/routes/routes'
import { useAchievementAlertsStore } from '@/stores/achievementAlerts'
import { useAreaQuestsStore } from '@/stores/areaQuests'
import { useAuthStore } from '@/stores/auth'
import { useClanStore } from '@/stores/clan'
import { useEventsStore } from '@/stores/events'
import { useCollectionStore } from '@/stores/collection'
import { useMapStore } from '@/stores/map'
import { useRouteStore } from '@/stores/route'
import { useExplorationStore } from '@/stores/exploration'
import { useMemoriesStore } from '@/stores/memories'
import { useOutlinesStore } from '@/stores/outlines'
import { useProfileStore } from '@/stores/profile'
import { useQuestsStore } from '@/stores/quests'
import { useScanStore } from '@/stores/scan'
import { useTasksStore } from '@/stores/tasks'

const auth = useAuthStore()
const router = useRouter()
const profile = useProfileStore()

// brand splash while the stored session is restored; it stays until its animation has played
const minSplashDone = ref(false)
// dev only: `?splash` keeps the splash on screen to inspect the loader animation
const holdSplash = import.meta.env.DEV && new URLSearchParams(location.search).has('splash')
onMounted(() => {
  if (!holdSplash) setTimeout(() => (minSplashDone.value = true), SPLASH_MS)
})

watch(
  () => auth.userId,
  (userId, previous) => {
    if (userId && userId !== previous) void profile.load()
    if (!userId && previous) {
      // signed out or session expired: drop all per-user state
      profile.reset()
      useMapStore().reset()
      useRouteStore().stop()
      useOutlinesStore().reset()
      useMemoriesStore().reset()
      void useExplorationStore().reset()
      useCollectionStore().reset()
      useQuestsStore().reset()
      useAchievementAlertsStore().reset()
      useClanStore().reset()
      useEventsStore().reset()
      useTasksStore().reset()
      useScanStore().reset()
      useAreaQuestsStore().reset()
      mapCategory.value = null
      void router.replace({ name: 'login' })
    }
  },
  { immediate: true },
)

watch(
  () => auth.recoveryMode,
  (recovery) => {
    if (recovery) void router.replace({ name: 'update-password' })
  },
)
</script>

<template>
  <RouterView />
  <!-- «Новое достижение» over any page, right after a scan completes one -->
  <AchievementUnlocked v-if="auth.status === 'signed_in'" />
  <Transition name="splash">
    <SplashScreen v-if="auth.status === 'loading' || !minSplashDone" />
  </Transition>
</template>

<style lang="scss">
.splash-leave-active {
  transition: opacity 0.35s var(--ease);
}
.splash-leave-to {
  opacity: 0;
}
</style>
