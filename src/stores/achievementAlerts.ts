import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export interface UnlockedAchievement {
  questId: string
  title: string
}

/**
 * Achievements just completed, waiting to be shown (AchievementUnlocked) — one at a time, in the order they
 * came. A scan reports the ones it completed (submit_building_scan: completedQuests); a quest step or a
 * check-in does not, so after one the achievements are fetched again (useQuestsStore().announceCompleted).
 */
export const useAchievementAlertsStore = defineStore('achievementAlerts', () => {
  const queue = ref<UnlockedAchievement[]>([])
  const current = computed(() => queue.value[0] ?? null)
  /** shown or waiting this session: an achievement is announced once */
  const announced = new Set<string>()

  function push(list: readonly UnlockedAchievement[]): void {
    const fresh = list.filter((a) => !announced.has(a.questId))
    for (const a of fresh) announced.add(a.questId)
    queue.value = [...queue.value, ...fresh]
  }
  function dismiss(): void {
    queue.value = queue.value.slice(1)
  }
  function reset(): void {
    queue.value = []
    announced.clear()
  }

  return { queue, current, push, dismiss, reset }
})
